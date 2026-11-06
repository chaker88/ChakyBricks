import threading
import time
from pathlib import Path

import duckdb
import pytest

from chakybricks.errors import ConflictError, InvalidInputError
from chakybricks.ingest import jobs, sources
from chakybricks.ingest.jobs import ImportRequest, ImportState
from chakybricks.ingest.sources import ColumnSpec, SourceFormat, SourceOptions
from chakybricks.services import Services
from tests.conftest import make_big_csv


def run_preview(path: Path, **kwargs: object) -> dict:  # type: ignore[type-arg]
    with duckdb.connect() as con:
        fmt = sources.detect_format(path)
        return sources.preview(con, path, fmt, SourceOptions(**kwargs), None)  # type: ignore[arg-type]


def request_for(path: Path, table: str, **overrides: object) -> ImportRequest:
    preview = run_preview(path)
    data = {
        "path": str(path),
        "format": preview["format"],
        "columns": preview["source_columns"],
        "schema_name": "main",
        "table": table,
        **overrides,
    }
    return ImportRequest.model_validate(data)


def import_ok(services: Services, request: ImportRequest) -> None:
    job = services.imports.wait(services.imports.submit(request).id)
    assert job.state == ImportState.SUCCEEDED, job.error


def test_detect_format_and_names() -> None:
    assert sources.detect_format(Path("a.CSV")) == SourceFormat.CSV
    assert sources.detect_format(Path("a.jsonl")) == SourceFormat.JSON
    with pytest.raises(InvalidInputError):
        sources.detect_format(Path("a.docx"))
    assert sources.sanitize_column_names(["Customer Name", "2nd", "a-b", "A B", ""]) == [
        "customer_name",
        "c_2nd",
        "a_b",
        "a_b_2",
        "column_5",
    ]
    assert sources.suggest_table_name(Path("Sales 2024.csv")) == "sales_2024"
    assert sources.suggest_table_name(Path("2024.csv")) == "t_2024"


def test_sanitize_keeps_unicode_letters() -> None:
    raw = [
        "الاسم",
        "اللقب",
        "Prénom",
        "Date de naissance",
        "الاسم الكامل",
        "\ufeffالعمر",
        "Ça va?",
        " (x) ",
        "a,b;c{d}e=f\tg\nh",
        "",
        "___",
        "الاسم",
        "PRÉNOM",
        "price?",
        "a--b__c",
        "€ total",
        "x²",
        "ﬁle",
        "مُحَمَّد",
        "١٢٣",
        "order",
        "Group",
        "class",
        "select",
    ]
    assert sources.sanitize_column_names(raw) == [
        "الاسم",
        "اللقب",
        "prénom",
        "date_de_naissance",
        "الاسم_الكامل",
        "العمر",
        "ça_va",
        "x",
        "a_b_c_d_e_f_g_h",
        "column_10",
        "column_11",
        "الاسم_2",
        "prénom_2",
        "price",
        "a_b_c",
        "total",
        "x2",
        "file",
        "مُحَمَّد",
        "c_١٢٣",
        "c_order",
        "c_group",
        "c_class",
        "c_select",
    ]


def test_sanitized_names_work_unquoted_in_sql_and_python() -> None:
    raw = ["Prénom", "Date de naissance", "الاسم الكامل", "مُحَمَّد", "a-b", "price?", "2nd", "order"]
    names = sources.sanitize_column_names(raw)
    with duckdb.connect() as con:
        select = ", ".join(f"{i} AS {name}" for i, name in enumerate(names))
        rel = con.sql(f"SELECT {', '.join(names)} FROM (SELECT {select})")
        assert rel.columns == names
        assert rel.fetchall() == [tuple(range(len(names)))]
    namespace: dict[str, object] = {}
    exec("\n".join(f"{name} = {i}" for i, name in enumerate(names)), namespace)
    assert [namespace[name] for name in names] == list(range(len(names)))


@pytest.mark.parametrize(
    ("name", "message"),
    [
        ("الاسم الكامل", "use letters"),
        ("a-b", "use letters"),
        ("2nd", "use letters"),
        ("price?", "use letters"),
        ("", "1 to 128"),
        ("order", "reserved"),
        ("Select", "reserved"),
        ("class", "reserved"),
    ],
)
def test_column_name_errors(name: str, message: str) -> None:
    error = sources.column_name_error(name)
    assert error is not None
    assert message in error


def test_column_name_accepts_unicode_identifiers() -> None:
    for name in ["الاسم", "Prénom", "مُحَمَّد", "_x", "c_2nd", "ça_va", "none"]:
        assert sources.column_name_error(name) is None, name


def test_unicode_column_names_validate(files: dict[str, Path]) -> None:
    with duckdb.connect() as con:
        rel = sources.open_source(con, files["arabic"], SourceFormat.CSV, SourceOptions())
        projected = sources.apply_columns(
            rel,
            [
                ColumnSpec(source="الاسم", name="الاسم", type="VARCHAR"),
                ColumnSpec(source="Prénom", name="Prénom", type="VARCHAR"),
            ],
        )
        assert projected.columns == ["الاسم", "Prénom"]
        with pytest.raises(InvalidInputError, match="use letters"):
            sources.apply_columns(
                rel, [ColumnSpec(source="الاسم", name="الاسم الكامل", type="VARCHAR")]
            )


def test_preview_arabic_csv_with_bom(files: dict[str, Path]) -> None:
    result = run_preview(files["arabic"])
    assert [(c["source"], c["name"], c["type"]) for c in result["source_columns"]] == [
        ("الاسم", "الاسم", "VARCHAR"),
        ("اللقب", "اللقب", "VARCHAR"),
        ("العمر", "العمر", "BIGINT"),
        ("الراتب", "الراتب", "DOUBLE"),
        ("المدينة", "المدينة", "VARCHAR"),
        ("Prénom", "prénom", "VARCHAR"),
        ("Date de naissance", "date_de_naissance", "DATE"),
        ("الاسم الكامل", "الاسم_الكامل", "VARCHAR"),
    ]
    assert result["sample"]["rows"][0][0] == "أحمد"


def test_import_arabic_columns_partitioned_and_queryable(
    services: Services, files: dict[str, Path]
) -> None:
    import_ok(services, request_for(files["arabic"], "employees", partition_by="المدينة"))
    table = services.catalog.get_table("main", "employees")
    assert [c.name for c in table.columns][:3] == ["الاسم", "اللقب", "العمر"]
    assert table.row_count == 3
    partitions = sorted(p.name for p in (services.workspace.warehouse / "main/employees").iterdir())
    assert [p for p in partitions if p.startswith("المدينة=")] and len(partitions) == 3

    with services.engine.cursor() as cur:
        unquoted = cur.sql(
            "SELECT الاسم, prénom, الاسم_الكامل FROM employees "
            "WHERE المدينة = 'تونس' ORDER BY العمر"
        ).fetchall()
        quoted = cur.sql(
            'SELECT "الاسم", sum("الراتب") FROM main."employees" '
            "WHERE \"المدينة\" = 'تونس' GROUP BY 1 ORDER BY 1"
        ).fetchall()
    assert unquoted == [
        ("أحمد", "Ahmed", "أحمد بن علي"),
        ("ليلى", "Leïla", "ليلى الطرابلسي"),
    ]
    assert quoted == [("أحمد", 1500.5), ("ليلى", 3100.0)]


@pytest.mark.parametrize("kind", ["csv", "tsv", "ndjson", "json", "parquet", "xlsx"])
def test_preview_every_format(files: dict[str, Path], kind: str) -> None:
    result = run_preview(files[kind])
    assert result["sample"]["rows"]
    assert result["estimated_rows"] >= 1
    assert [c["name"] for c in result["source_columns"]] == [
        c["name"] for c in result["sample"]["columns"]
    ]


def test_preview_infers_and_sanitizes_csv(files: dict[str, Path]) -> None:
    result = run_preview(files["csv"])
    columns = {c["name"]: c["type"] for c in result["source_columns"]}
    assert columns == {
        "order_id": "BIGINT",
        "customer_name": "VARCHAR",
        "order_date": "DATE",
        "amount": "DOUBLE",
        "region": "VARCHAR",
    }
    assert len(result["sample"]["rows"]) == 4


def test_unsigned_parquet_maps_to_delta_safe_type(files: dict[str, Path]) -> None:
    columns = {c["name"]: c["type"] for c in run_preview(files["parquet"])["source_columns"]}
    assert columns["big"] == "DECIMAL(20,0)"


def test_type_override_and_validation(files: dict[str, Path]) -> None:
    with duckdb.connect() as con:
        rel = sources.open_source(con, files["csv"], SourceFormat.CSV, SourceOptions())
        specs = [
            ColumnSpec(source="order_id", name="id", type="VARCHAR"),
            ColumnSpec(source="amount", name="amount", type="decimal(18, 2)"),
        ]
        projected = sources.apply_columns(rel, specs)
        assert [str(t) for t in projected.types] == ["VARCHAR", "DECIMAL(18,2)"]
        for bad in [
            [ColumnSpec(source="nope", name="x", type="VARCHAR")],
            [ColumnSpec(source="amount", name="bad name", type="DOUBLE")],
            [ColumnSpec(source="amount", name="a", type="DOUBLE; DROP")],
            [
                ColumnSpec(source="amount", name="a", type="DOUBLE"),
                ColumnSpec(source="region", name="A", type="VARCHAR"),
            ],
            [],
        ]:
            with pytest.raises(InvalidInputError):
                sources.apply_columns(rel, bad)


def test_excel_size_limit(files: dict[str, Path], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sources, "EXCEL_MAX_BYTES", 10)
    with pytest.raises(InvalidInputError, match="50 MB"):
        run_preview(files["xlsx"])


def test_import_csv_creates_queryable_delta_table(
    services: Services, files: dict[str, Path]
) -> None:
    import_ok(services, request_for(files["csv"], "sales"))
    table = services.catalog.get_table("main", "sales")
    assert table.row_count == 4
    assert table.size_bytes > 0
    assert (services.workspace.warehouse / "main" / "sales" / "_delta_log").is_dir()
    with services.engine.cursor() as cur:
        result = cur.sql(
            "SELECT region, sum(amount) FROM main.sales WHERE region = 'north' GROUP BY 1"
        ).fetchall()
    assert result == [("north", 17.75)]


@pytest.mark.parametrize("kind", ["tsv", "ndjson", "json", "parquet", "xlsx"])
def test_import_other_formats(services: Services, files: dict[str, Path], kind: str) -> None:
    import_ok(services, request_for(files[kind], f"t_{kind}"))
    assert services.catalog.get_table("main", f"t_{kind}").row_count >= 2


def test_import_partitioned(services: Services, files: dict[str, Path]) -> None:
    import_ok(services, request_for(files["csv"], "sales", partition_by="region"))
    partitions = sorted(p.name for p in (services.workspace.warehouse / "main/sales").iterdir())
    assert "region=north" in partitions


def test_create_conflict_then_append_and_overwrite(
    services: Services, files: dict[str, Path]
) -> None:
    import_ok(services, request_for(files["csv"], "sales"))
    with pytest.raises(ConflictError):
        services.imports.submit(request_for(files["csv"], "sales"))
    import_ok(services, request_for(files["csv"], "sales", mode="append"))
    assert services.catalog.get_table("main", "sales").row_count == 8
    assert services.catalog.get_table("main", "sales").version == 1
    import_ok(services, request_for(files["csv"], "sales", mode="overwrite"))
    table = services.catalog.get_table("main", "sales")
    assert (table.row_count, table.version) == (4, 2)


def test_failed_cast_marks_job_failed_and_cleans_up(
    services: Services, files: dict[str, Path], tmp_path: Path
) -> None:
    bad = tmp_path / "bad.csv"
    bad.write_text("value\n" + "1\n" * 100_000 + "oops\n")
    request = request_for(bad, "bad")
    job = services.imports.wait(services.imports.submit(request).id)
    assert job.state == ImportState.FAILED
    assert job.error
    assert services.catalog.find_table("main", "bad") is None
    assert not (services.workspace.warehouse / "main" / "bad").exists()


def test_cancel_queued_and_running_imports(
    services: Services, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(jobs, "BATCH_ROWS", 100)
    big = make_big_csv(tmp_path / "big.csv", 2_000_000)
    running = services.imports.submit(request_for(big, "big"))
    queued = services.imports.submit(request_for(big, "big2"))
    assert services.imports.cancel(queued.id).state == ImportState.CANCELLED

    deadline = time.time() + 30
    while running.rows_written == 0 and not running.done and time.time() < deadline:
        time.sleep(0.01)
    services.imports.cancel(running.id)
    job = services.imports.wait(running.id)
    assert job.state == ImportState.CANCELLED
    assert services.catalog.find_table("main", "big") is None
    assert not (services.workspace.warehouse / "main" / "big").exists()


def test_progress_is_reported(services: Services, tmp_path: Path) -> None:
    big = make_big_csv(tmp_path / "big.csv", 500_000)
    job = services.imports.submit(request_for(big, "big"))
    seen: list[float] = []

    def watch() -> None:
        while not job.done:
            if job.progress is not None:
                seen.append(job.progress)
            time.sleep(0.005)

    watcher = threading.Thread(target=watch)
    watcher.start()
    services.imports.wait(job.id)
    watcher.join()
    assert job.state == ImportState.SUCCEEDED
    assert job.progress == 1.0
    assert job.rows_written == 500_000
    assert all(0 <= p <= 1 for p in seen)
