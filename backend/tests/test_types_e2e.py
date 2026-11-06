import sys
from pathlib import Path
from typing import Any

import duckdb
import pytest
from fastapi.testclient import TestClient

from tests.test_api import import_csv


@pytest.fixture(autouse=True)
def no_pytz(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "pytz", None)


@pytest.fixture
def typed_files(tmp_path: Path) -> dict[str, Path]:
    tz_csv = tmp_path / "events_tz.csv"
    tz_csv.write_text(
        "id,created_at,label\n"
        "1,2024-01-01 10:00:00+01,a\n"
        "2,2024-06-30 23:30:00.5+02,b\n"
        "3,2024-12-31 00:00:00+00,c\n"
    )
    temporal = tmp_path / "temporal.parquet"
    other = tmp_path / "other.parquet"
    with duckdb.connect() as con:
        con.execute("SET TimeZone = 'UTC'")
        con.execute(
            f"""COPY (SELECT
                    TIMESTAMPTZ '2024-01-01 10:00:00+01' AS tstz,
                    TIMESTAMP '2024-01-01 10:00:00.123456' AS ts,
                    DATE '2024-02-29' AS d,
                    TIME '13:45:01.5' AS t,
                    INTERVAL '1 year 2 months 3 days 04:05:06.7' AS iv
                ) TO '{temporal.as_posix()}' (FORMAT parquet)"""
        )
        con.execute("CREATE TYPE mood AS ENUM ('sad', 'happy')")
        con.execute(
            f"""COPY (SELECT
                    12.34::DECIMAL(10,2) AS price,
                    123456789012345678901234.5678901234::DECIMAL(38,10) AS big,
                    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID AS id,
                    '\\xAA\\xBBhi'::BLOB AS raw,
                    [1, 2, NULL] AS nums,
                    {{'a': 1, 'b': 'x'}} AS obj,
                    MAP {{'k1': 1, 'k2': 2}} AS attrs,
                    'happy'::mood AS feeling
                ) TO '{other.as_posix()}' (FORMAT parquet)"""
        )
    return {"tz_csv": tz_csv, "temporal": temporal, "other": other}


def preview(client: TestClient, path: Path) -> dict[str, Any]:
    response = client.post("/api/imports/preview", json={"path": str(path)})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def first_row(result: dict[str, Any]) -> dict[str, Any]:
    names = [c["name"] for c in result["columns"]]
    return dict(zip(names, result["rows"][0], strict=True))


def column_types(result: dict[str, Any]) -> dict[str, str]:
    return {c["name"]: c["type"] for c in result["columns"]}


def test_csv_with_utc_offsets_previews_and_imports(
    client: TestClient, typed_files: dict[str, Path]
) -> None:
    body = preview(client, typed_files["tz_csv"])
    assert column_types(body["sample"])["created_at"] == "TIMESTAMP WITH TIME ZONE"
    assert [r[1] for r in body["sample"]["rows"]] == [
        "2024-01-01T09:00:00Z",
        "2024-06-30T21:30:00.5Z",
        "2024-12-31T00:00:00Z",
    ]

    import_csv(client, typed_files["tz_csv"], "main", "events_tz")
    sample = client.get("/api/tables/main/events_tz/sample").json()
    assert column_types(sample)["created_at"] == "TIMESTAMP WITH TIME ZONE"
    assert sorted(r[1] for r in sample["rows"])[0] == "2024-01-01T09:00:00Z"


def test_temporal_types_preview_import_sample_and_history(
    client: TestClient, typed_files: dict[str, Path]
) -> None:
    body = preview(client, typed_files["temporal"])
    assert {c["name"]: c["type"] for c in body["source_columns"]} == {
        "tstz": "TIMESTAMP WITH TIME ZONE",
        "ts": "TIMESTAMP",
        "d": "DATE",
        "t": "VARCHAR",
        "iv": "VARCHAR",
    }
    expected = {
        "tstz": "2024-01-01T09:00:00Z",
        "ts": "2024-01-01T10:00:00.123456",
        "d": "2024-02-29",
        "t": "13:45:01.5",
        "iv": "1 year 2 months 3 days 04:05:06.7",
    }
    assert first_row(body["sample"]) == expected

    import_csv(client, typed_files["temporal"], "main", "temporal")
    import_csv(client, typed_files["temporal"], "main", "temporal", mode="append")

    detail = client.get("/api/tables/main/temporal").json()
    assert detail["row_count"] == 2
    assert {c["name"]: c["type"] for c in detail["columns"]}["tstz"] == "TIMESTAMP WITH TIME ZONE"

    sample = client.get("/api/tables/main/temporal/sample").json()
    assert all(dict(zip(expected, row, strict=True)) == expected for row in sample["rows"])

    history = client.get("/api/tables/main/temporal/history").json()
    assert [h["version"] for h in history] == [1, 0]
    old = client.get("/api/tables/main/temporal/sample?version=0").json()
    assert len(old["rows"]) == 1
    assert first_row(old) == expected


def test_other_types_preview_import_and_sample(
    client: TestClient, typed_files: dict[str, Path]
) -> None:
    body = preview(client, typed_files["other"])
    types = {c["name"]: c["type"] for c in body["source_columns"]}
    assert types == {
        "price": "DECIMAL(10,2)",
        "big": "DECIMAL(38,10)",
        "id": "VARCHAR",
        "raw": "BLOB",
        "nums": "INTEGER[]",
        "obj": "STRUCT(a INTEGER, b VARCHAR)",
        "attrs": "MAP(VARCHAR, INTEGER)",
        "feeling": "VARCHAR",
    }
    expected = {
        "price": 12.34,
        "big": "123456789012345678901234.5678901234",
        "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "raw": "\\xAA\\xBBhi",
        "nums": [1, 2, None],
        "obj": {"a": 1, "b": "x"},
        "attrs": {"k1": 1, "k2": 2},
        "feeling": "happy",
    }
    assert first_row(body["sample"]) == expected

    import_csv(client, typed_files["other"], "main", "other")
    assert first_row(client.get("/api/tables/main/other/sample").json()) == expected
    assert first_row(client.get("/api/tables/main/other/sample?version=0").json()) == expected
