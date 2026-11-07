from collections.abc import Iterator

import pandas as pd
import polars as pl
import pyarrow as pa
import pytest

from chakybricks import cb
from chakybricks.errors import InvalidInputError, NotFoundError
from chakybricks.kernel_init import TABLE_MIME, SqlCellError, _bundle, sql_magic, table_payload
from chakybricks.services import Services
from tests.test_sql import add_table


@pytest.fixture
def kernel_env(services: Services, monkeypatch: pytest.MonkeyPatch) -> Iterator[Services]:
    monkeypatch.setenv(cb.WORKSPACE_ENV, str(services.workspace.root))
    monkeypatch.setenv(cb.MEMORY_ENV, "1024")
    cb._context.cache_clear()
    add_table(
        services,
        "main",
        "sales",
        pa.table(
            {"id": [1, 2, 3], "region": ["north", "south", "north"], "amount": [1.0, 2.0, 3.0]}
        ),
    )
    yield services
    cb._context.cache_clear()


def test_sql_returns_polars(kernel_env: Services) -> None:
    df = cb.sql("SELECT region, sum(amount) AS total FROM sales GROUP BY 1 ORDER BY 1")
    assert isinstance(df, pl.DataFrame)
    assert df.to_dicts() == [{"region": "north", "total": 4.0}, {"region": "south", "total": 2.0}]
    assert isinstance(df.to_pandas(), pd.DataFrame)
    assert cb.sql("SELECT 1; SELECT 2 AS two").item() == 2


def test_table_is_lazy_and_time_travels(kernel_env: Services) -> None:
    lf = cb.table("sales")
    assert isinstance(lf, pl.LazyFrame)
    assert lf.filter(pl.col("region") == "north").collect().height == 2
    cb.save(pl.DataFrame({"id": [4], "region": ["east"], "amount": [4.0]}), "sales", mode="append")
    assert cb.table("main.sales").collect().height == 4
    assert cb.table("sales", version=0).collect().height == 3
    with pytest.raises(NotFoundError):
        cb.table("missing")


def test_save_creates_registers_and_is_queryable_everywhere(kernel_env: Services) -> None:
    result = cb.save(pl.DataFrame({"Customer Name": ["a", "b"], "Total": [1, 2]}), "reports.top")
    assert result == {
        "table": "reports.top",
        "rows": 2,
        "version": 0,
        "columns": ["customer_name", "total"],
    }
    table = kernel_env.catalog.get_table("reports", "top")
    assert table.source == "notebook"
    with kernel_env.engine.cursor() as cur:
        assert cur.sql("SELECT sum(total) FROM reports.top").fetchall() == [(3,)]
    assert run_sql(kernel_env, "SELECT count(*) FROM reports.top") == [[2]]


def run_sql(services: Services, query: str) -> list[list[object]]:
    return list(services.sql.run(query, f"q-{id(query)}")["rows"])


def test_save_overwrite_append_and_inputs(kernel_env: Services) -> None:
    cb.save(pd.DataFrame({"x": [1, 2]}), "nums")
    cb.save(pa.table({"x": [3]}), "nums", mode="append")
    cb.save(pl.LazyFrame({"x": [4]}), "nums", mode="append")
    cb.save(pl.Series("x", [5]), "nums", mode="append")
    assert sorted(cb.table("nums").collect()["x"].to_list()) == [1, 2, 3, 4, 5]
    replaced = cb.save(pl.DataFrame({"y": ["new"]}), "nums")
    assert (replaced["version"], replaced["columns"], replaced["rows"]) == (4, ["y"], 1)
    with pytest.raises(NotFoundError):
        cb.save(pl.DataFrame({"x": [1]}), "nope", mode="append")
    with pytest.raises(InvalidInputError):
        cb.save([1, 2, 3], "bad")
    with pytest.raises(InvalidInputError):
        cb.save(pl.DataFrame({"x": [1]}), "bad", mode="upsert")  # type: ignore[arg-type]


def test_save_partitioned_and_unsigned(kernel_env: Services) -> None:
    df = pl.DataFrame({"region": ["n", "s"], "n": pl.Series([1, 2], dtype=pl.UInt64)})
    cb.save(df, "parts", partition_by="region")
    path = kernel_env.workspace.warehouse / "main" / "parts"
    assert {p.name for p in path.iterdir() if p.name.startswith("region=")} == {
        "region=n",
        "region=s",
    }
    types = {c.name: c.type for c in kernel_env.catalog.get_table("main", "parts").columns}
    assert types["n"] == "DECIMAL(20,0)"


def test_tables_lists_catalog(kernel_env: Services) -> None:
    listing = cb.tables()
    assert listing.columns == ["schema", "table", "rows", "size_bytes", "version", "updated_at"]
    assert listing.filter(pl.col("table") == "sales")["rows"].item() == 3


def test_table_payload_and_bundle() -> None:
    payload = table_payload(pl.DataFrame({"a": list(range(5))}), limit=2)
    assert payload["rows"] == [[0], [1]]
    assert (payload["row_count"], payload["truncated"]) == (5, True)
    assert payload["columns"] == [{"name": "a", "type": "BIGINT"}]
    grouped = pd.DataFrame({"k": ["x", "y"], "v": [1, 2]}).set_index("k")
    assert [c["name"] for c in table_payload(grouped)["columns"]] == ["k", "v"]
    assert table_payload(pa.table({"t": ["é"]}))["rows"] == [["é"]]
    assert table_payload(pd.Series([1, 2], name="s"))["row_count"] == 2
    assert TABLE_MIME in _bundle(pl.DataFrame({"a": [1]}))


def test_sql_magic(kernel_env: Services) -> None:
    assert sql_magic("", "SELECT 7 AS n").item() == 7
    with pytest.raises(SqlCellError, match="nope"):
        sql_magic("", "SELECT * FROM nope")
    with pytest.raises(SqlCellError, match="identifier"):
        sql_magic("not a name", "SELECT 1")
    assert SqlCellError("boom")._render_traceback_() == ["\x1b[31mboom\x1b[0m"]


def test_sql_supports_editor_writes(
    kernel_env: Services, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cb.sql("CREATE TABLE copy AS SELECT * FROM sales WHERE region = 'north'") is None
    assert capsys.readouterr().out == "Created main.copy with 2 rows · version 0\n"
    assert (
        cb.sql("INSERT INTO copy SELECT 4, 'west', 4.0; SELECT count(*) AS n FROM copy").item() == 3
    )
    assert "Inserted 1 rows into main.copy · version 1" in capsys.readouterr().out
    assert kernel_env.catalog.get_table("main", "copy").version == 1
    cb.sql("CREATE OR REPLACE TABLE copy AS SELECT 1 AS one")
    assert cb.table("copy").collect().columns == ["one"]
    cb.sql("ALTER TABLE copy RENAME TO renamed")
    cb.sql("DROP TABLE renamed")
    assert kernel_env.catalog.find_table("main", "renamed") is None
    with pytest.raises(InvalidInputError, match="UPDATE statements are not supported"):
        cb.sql("UPDATE sales SET amount = 0")


def test_integer_sums_stay_integers(kernel_env: Services) -> None:
    df = cb.sql("SELECT sum(id) AS total, sum(id)::HUGEINT * 10 AS big FROM sales")
    assert df.schema["total"] == pl.Int64
    assert df.row(0) == (6, 60)
    huge = cb.sql("SELECT 170141183460469231731687303715884105727::HUGEINT AS h")
    assert huge.schema["h"] != pl.Int64
