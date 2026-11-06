import sys
from typing import Any

import duckdb
import pyarrow as pa
import pytest

from chakybricks.serialization import column_values, relation_to_json


@pytest.fixture
def con() -> duckdb.DuckDBPyConnection:
    connection = duckdb.connect()
    connection.execute("SET TimeZone = 'Africa/Tunis'")
    connection.execute("CREATE TYPE mood AS ENUM ('sad', 'happy')")
    return connection


@pytest.fixture(autouse=True)
def no_pytz(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "pytz", None)


def one(con: duckdb.DuckDBPyConnection, expression: str) -> tuple[str, Any]:
    result = relation_to_json(con.sql(f"SELECT {expression} AS v"))
    return result["columns"][0]["type"], result["rows"][0][0]


@pytest.mark.parametrize(
    ("expression", "duck_type", "expected"),
    [
        (
            "TIMESTAMPTZ '2024-01-01 10:00:00+01'",
            "TIMESTAMP WITH TIME ZONE",
            "2024-01-01T09:00:00Z",
        ),
        (
            "TIMESTAMPTZ '2024-07-01 10:00:00.25+02'",
            "TIMESTAMP WITH TIME ZONE",
            "2024-07-01T08:00:00.25Z",
        ),
        ("TIMESTAMP '2024-01-01 10:00:00.123456'", "TIMESTAMP", "2024-01-01T10:00:00.123456"),
        (
            "'2024-01-01 10:00:00.123456789'::TIMESTAMP_NS",
            "TIMESTAMP_NS",
            "2024-01-01T10:00:00.123456789",
        ),
        ("TIMESTAMP '1900-01-01 00:00:00'", "TIMESTAMP", "1900-01-01T00:00:00"),
        ("'infinity'::TIMESTAMP", "TIMESTAMP", "infinity"),
        ("DATE '2024-02-29'", "DATE", "2024-02-29"),
        ("TIME '13:45:01.5'", "TIME", "13:45:01.5"),
        ("TIME '00:00:00'", "TIME", "00:00:00"),
        (
            "INTERVAL '1 year 2 months 3 days 04:05:06.7'",
            "INTERVAL",
            "1 year 2 months 3 days 04:05:06.7",
        ),
        ("INTERVAL '1 day'", "INTERVAL", "1 day"),
        ("INTERVAL '-90 minutes'", "INTERVAL", "-01:30:00"),
        ("INTERVAL '0 seconds'", "INTERVAL", "00:00:00"),
        ("12.34::DECIMAL(10,2)", "DECIMAL(10,2)", 12.34),
        (
            "123456789012345678901234.5678901234::DECIMAL(38,10)",
            "DECIMAL(38,10)",
            "123456789012345678901234.5678901234",
        ),
        (
            "'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID",
            "UUID",
            "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        ),
        ("'\\xAA\\xBBhi'::BLOB", "BLOB", "\\xAA\\xBBhi"),
        ("[1, 2, NULL]", "INTEGER[]", [1, 2, None]),
        ("[[1], NULL, []]", "INTEGER[][]", [[1], None, []]),
        (
            "[TIMESTAMPTZ '2024-01-01 00:00:00+00']",
            "TIMESTAMP WITH TIME ZONE[]",
            ["2024-01-01T00:00:00Z"],
        ),
        ("[1, 2]::INTEGER[2]", "INTEGER[2]", [1, 2]),
        ("{'a': 1, 'b': 'x'}", "STRUCT(a INTEGER, b VARCHAR)", {"a": 1, "b": "x"}),
        (
            "{'when': DATE '2024-01-02', 'tags': ['x']}",
            'STRUCT("when" DATE, tags VARCHAR[])',
            {"when": "2024-01-02", "tags": ["x"]},
        ),
        ("MAP {'k1': 1, 'k2': 2}", "MAP(VARCHAR, INTEGER)", {"k1": 1, "k2": 2}),
        ("MAP {1: 'a'}", "MAP(INTEGER, VARCHAR)", [[1, "a"]]),
        ("'happy'::mood", "ENUM('sad', 'happy')", "happy"),
        (
            "170141183460469231731687303715884105727::HUGEINT",
            "HUGEINT",
            "170141183460469231731687303715884105727",
        ),
        ("18446744073709551615::UBIGINT", "UBIGINT", "18446744073709551615"),
        ("42::BIGINT", "BIGINT", 42),
        ("'nan'::DOUBLE", "DOUBLE", "NaN"),
        ("'-inf'::DOUBLE", "DOUBLE", "-Infinity"),
        ("1.5::FLOAT", "FLOAT", 1.5),
        ("true", "BOOLEAN", True),
        ("'مرحبا é'", "VARCHAR", "مرحبا é"),
        ("NULL::TIMESTAMPTZ", "TIMESTAMP WITH TIME ZONE", None),
        ("NULL::INTERVAL", "INTERVAL", None),
        ("NULL::STRUCT(a INT)", "STRUCT(a INTEGER)", None),
        ("NULL", '"NULL"', None),
    ],
)
def test_every_duckdb_type_serializes_without_pytz(
    con: duckdb.DuckDBPyConnection, expression: str, duck_type: str, expected: Any
) -> None:
    assert one(con, expression) == (duck_type, expected)


def test_multiple_rows_nulls_and_empty_results(con: duckdb.DuckDBPyConnection) -> None:
    result = relation_to_json(
        con.sql(
            "SELECT i, CASE WHEN i % 2 = 0 THEN TIMESTAMPTZ '2024-01-01 00:00:00+00' END AS ts, "
            "CASE WHEN i = 1 THEN NULL ELSE MAP {'k': i} END AS m "
            "FROM range(3) t(i) ORDER BY i"
        )
    )
    assert result["rows"] == [
        [0, "2024-01-01T00:00:00Z", {"k": 0}],
        [1, None, None],
        [2, "2024-01-01T00:00:00Z", {"k": 2}],
    ]
    empty = relation_to_json(con.sql("SELECT 1 AS a WHERE false"))
    assert empty == {"columns": [{"name": "a", "type": "INTEGER"}], "rows": []}


def test_sliced_and_chunked_arrow_arrays() -> None:
    lists = pa.array([[1], [2, 3], None, [4]]).slice(1, 3)
    assert column_values(lists) == [[2, 3], None, [4]]
    maps = pa.array([[("a", 1)], [("b", 2)], None], type=pa.map_(pa.string(), pa.int64()))
    assert column_values(maps.slice(1)) == [{"b": 2}, None]
    structs = pa.array([{"x": 1}, None, {"x": 3}]).slice(1)
    assert column_values(structs) == [None, {"x": 3}]
    chunked = pa.chunked_array([pa.array([1, 2]), pa.array([3])])
    assert column_values(chunked) == [1, 2, 3]
    uuids = pa.array(
        [b"\xa0\xee\xbc\x99\x9c\x0b\x4e\xf8\xbb\x6d\x6b\xb9\xbd\x38\x0a\x11"], pa.uuid()
    )
    assert column_values(uuids) == ["a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"]
