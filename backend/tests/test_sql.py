import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

import duckdb
import pyarrow as pa
import pytest
from deltalake import write_deltalake
from fastapi.testclient import TestClient

from chakybricks import delta
from chakybricks.catalog import MIGRATIONS, Catalog
from chakybricks.errors import (
    ConflictError,
    InvalidInputError,
    NotFoundError,
    QueryCancelledError,
    QueryError,
)
from chakybricks.services import Services
from tests.test_api import wait_for_import


def add_table(services: Services, schema: str, name: str, data: pa.Table) -> None:
    services.catalog.ensure_schema(schema)
    location = services.workspace.table_location(schema, name)
    path = services.workspace.table_path(location)
    write_deltalake(str(path), data, mode="overwrite")
    services.catalog.upsert_table(schema, name, location, delta.table_stats(path))


@pytest.fixture
def sales(services: Services) -> Services:
    add_table(
        services,
        "main",
        "sales",
        pa.table(
            {
                "id": list(range(1, 2001)),
                "region": ["north", "south", "east", "west"] * 500,
                "amount": [float(i % 100) for i in range(2000)],
            }
        ),
    )
    return services


def run(services: Services, sql: str, limit: int | None = None) -> dict[str, Any]:
    return services.sql.run(sql, f"q-{time.time_ns()}", limit)


def test_run_returns_rows_columns_and_total(sales: Services) -> None:
    result = run(sales, "SELECT region, sum(amount) AS total FROM sales GROUP BY 1 ORDER BY 1")
    assert result["columns"] == [
        {"name": "region", "type": "VARCHAR"},
        {"name": "total", "type": "DOUBLE"},
    ]
    assert [r[0] for r in result["rows"]] == ["east", "north", "south", "west"]
    assert result["row_count"] == 4
    assert result["truncated"] is False
    assert result["elapsed_ms"] >= 0


def test_row_limit_truncates_but_counts_everything(sales: Services) -> None:
    result = run(sales, "SELECT * FROM main.sales ORDER BY id", limit=150)
    assert len(result["rows"]) == 150
    assert result["rows"][0][0] == 1
    assert result["row_count"] == 2000
    assert result["truncated"] is True

    sales.update_settings({"row_limit": 100})
    assert len(run(sales, "SELECT * FROM sales")["rows"]) == 100


def test_large_result_counts_without_materializing(sales: Services) -> None:
    result = run(sales, "SELECT i FROM range(3000000) t(i)", limit=10)
    assert len(result["rows"]) == 10
    assert result["row_count"] == 3_000_000


def test_multiple_statements_return_the_last(sales: Services) -> None:
    result = run(sales, "SELECT 1; -- first\nSELECT count(*) AS n FROM sales;")
    assert result["rows"] == [[2000]]
    assert result["statement_count"] == 2


@pytest.mark.parametrize(
    "sql",
    [
        "CREATE TABLE x AS SELECT 1",
        "INSERT INTO sales VALUES (1, 'x', 1)",
        "SET threads = 1",
        "COPY (SELECT 1) TO 'x.csv'",
        "PRAGMA show_tables",
        "SELECT 1; DROP VIEW sales",
        "ATTACH 'x.db'",
    ],
)
def test_write_statements_are_rejected(sales: Services, sql: str) -> None:
    with pytest.raises(InvalidInputError, match="read-only"):
        run(sales, sql)


def test_read_only_helpers_are_allowed(sales: Services) -> None:
    assert run(sales, "DESCRIBE sales")["row_count"] == 3
    assert run(sales, "SUMMARIZE sales")["row_count"] == 3
    assert run(sales, "EXPLAIN SELECT * FROM sales")["rows"]
    assert run(sales, "FROM sales LIMIT 1")["row_count"] == 1


def test_errors_and_empty_sql(sales: Services) -> None:
    with pytest.raises(InvalidInputError):
        run(sales, "   -- nothing")
    with pytest.raises(QueryError, match="nope"):
        run(sales, "SELECT * FROM nope")
    with pytest.raises((QueryError, InvalidInputError)):
        run(sales, "SELEC 1")


def test_python_variables_are_not_queryable(sales: Services) -> None:
    sales_df = pa.table({"secret": [1]})
    assert sales_df.num_rows == 1
    with pytest.raises(QueryError):
        run(sales, "SELECT * FROM sales_df")


def test_cancel_running_query(sales: Services) -> None:
    query_id = "slow"
    errors: list[BaseException] = []

    def target() -> None:
        try:
            sales.sql.run("SELECT count(*) FROM range(100000000000) t(i) WHERE i % 7 = 1", query_id)
        except BaseException as exc:
            errors.append(exc)

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not sales.sql.cancel(query_id) and time.time() < deadline:
        time.sleep(0.01)
    thread.join(10)
    assert not thread.is_alive()
    assert isinstance(errors[0], QueryCancelledError)
    assert sales.sql.cancel("unknown") is False
    assert sales.queries.history(1)[0]["status"] == "cancelled"


def test_history_records_runs(sales: Services) -> None:
    run(sales, "SELECT 1")
    with pytest.raises(QueryError):
        run(sales, "SELECT * FROM missing")
    history = sales.queries.history()
    assert [h["status"] for h in history[:2]] == ["failed", "succeeded"]
    assert history[0]["error"]
    assert history[1]["row_count"] == 1
    sales.queries.clear_history()
    assert sales.queries.history() == []


def test_export_csv_and_parquet(sales: Services, tmp_path: Path) -> None:
    csv = tmp_path / "out.csv"
    parquet = tmp_path / "out.parquet"
    query = "SELECT id, region FROM sales WHERE amount > 50"
    assert sales.sql.export(query, str(csv), "csv", "e1")["size_bytes"] > 0
    sales.sql.export(query, str(parquet), "parquet", "e2")
    with duckdb.connect() as con:
        assert con.sql(f"SELECT count(*) FROM read_csv('{csv.as_posix()}')").fetchall() == [(980,)]
        assert con.sql(f"SELECT count(*) FROM '{parquet.as_posix()}'").fetchall() == [(980,)]
    with pytest.raises(InvalidInputError):
        sales.sql.export(query, "relative.csv", "csv", "e3")
    with pytest.raises(InvalidInputError, match="last statement"):
        sales.sql.export("SELECT 1; EXPLAIN SELECT 2", str(csv), "csv", "e4")
    sales.sql.export("SELECT 1; SELECT 42 AS answer", str(csv), "csv", "e5")
    with duckdb.connect() as con:
        assert con.sql(f"SELECT * FROM read_csv('{csv.as_posix()}')").fetchall() == [(42,)]


def test_column_stats(sales: Services) -> None:
    numeric = sales.sql.column_stats("SELECT * FROM sales", "amount")
    assert numeric["rows"] == 2000
    assert numeric["nulls"] == 0
    assert numeric["numeric"] is True
    assert (numeric["min"], numeric["max"], numeric["median"]) == (0.0, 99.0, 49.5)
    text = sales.sql.column_stats("SELECT region FROM sales", "region")
    assert text["numeric"] is False
    assert text["distinct"] == 4
    assert {v["value"] for v in text["top_values"]} == {"north", "south", "east", "west"}
    assert all(v["count"] == 500 for v in text["top_values"])
    nested = sales.sql.column_stats("SELECT {'a': 1} AS s", "s")
    assert nested["top_values"] == [] and "min" not in nested
    with pytest.raises(InvalidInputError):
        sales.sql.column_stats("SELECT 1 AS a", "b")


def test_saved_queries_crud(services: Services) -> None:
    store = services.queries
    created = store.create_saved("  Revenue   by region ", "SELECT 1")
    assert created.name == "Revenue by region"
    with pytest.raises(ConflictError):
        store.create_saved("revenue BY region", "SELECT 2")
    with pytest.raises(InvalidInputError):
        store.create_saved("   ", "SELECT 2")
    updated = store.update_saved(created.id, sql="SELECT 2", description="d")
    assert (updated.sql, updated.description, updated.name) == ("SELECT 2", "d", created.name)
    other = store.create_saved("Other", "SELECT 3")
    with pytest.raises(ConflictError):
        store.update_saved(other.id, name="Revenue by region")
    assert [q.name for q in store.list_saved()] == ["Other", "Revenue by region"]
    store.delete_saved(created.id)
    with pytest.raises(NotFoundError):
        store.get_saved(created.id)


def test_migration_upgrades_existing_catalog(tmp_path: Path) -> None:
    path = tmp_path / "meta.db"
    conn = sqlite3.connect(path)
    conn.executescript(MIGRATIONS[0])
    conn.execute("PRAGMA user_version = 1")
    conn.close()
    catalog = Catalog(path)
    with catalog.connect() as c:
        assert c.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)
        c.execute("SELECT * FROM saved_queries").fetchall()


def test_sql_endpoints(client: TestClient, files: dict[str, Path], tmp_path: Path) -> None:
    from tests.test_api import import_csv

    import_csv(client, files["csv"], "main", "orders")
    ok = client.post("/api/sql/run", json={"sql": "SELECT count(*) AS n FROM orders"})
    assert ok.status_code == 200
    assert ok.json()["rows"] == [[4]]
    assert client.post("/api/sql/run", json={"sql": "SELECT * FROM nope"}).status_code == 400
    assert client.post("/api/sql/run", json={"sql": "DROP VIEW orders"}).status_code == 422
    assert client.post("/api/sql/cancel/nothing").json() == {"cancelled": False}

    stats = client.post("/api/sql/stats", json={"sql": "SELECT * FROM orders", "column": "amount"})
    assert stats.json()["max"] == 20.0

    out = tmp_path / "orders.parquet"
    exported = client.post(
        "/api/sql/export",
        json={"sql": "SELECT * FROM orders", "path": str(out), "format": "parquet"},
    )
    assert exported.status_code == 200 and out.exists()

    history = client.get("/api/sql/history").json()
    assert history[0]["status"] == "failed"
    assert client.delete("/api/sql/history").status_code == 204

    created = client.post("/api/saved-queries", json={"name": "All orders", "sql": "SELECT 1"})
    assert created.status_code == 201
    query_id = created.json()["id"]
    assert client.put(f"/api/saved-queries/{query_id}", json={"sql": "SELECT 2"}).json()["sql"] == (
        "SELECT 2"
    )
    assert [q["name"] for q in client.get("/api/saved-queries").json()] == ["All orders"]
    assert (
        client.post("/api/saved-queries", json={"name": "all ORDERS", "sql": "x"}).status_code
        == 409
    )
    assert client.delete(f"/api/saved-queries/{query_id}").status_code == 204
    assert client.get(f"/api/saved-queries/{query_id}").status_code == 404

    assert client.put("/api/settings", json={"row_limit": 500}).json()["row_limit"] == 500
    assert client.put("/api/settings", json={"row_limit": 5}).status_code == 422


def test_save_query_result_as_table(client: TestClient, files: dict[str, Path]) -> None:
    from tests.test_api import import_csv

    import_csv(client, files["csv"], "main", "orders")
    body = {
        "sql": 'SELECT region, count(*), sum(amount) AS "Total Amount" FROM orders GROUP BY 1',
        "schema_name": "reports",
        "table": "by_region",
    }
    response = client.post("/api/sql/save-table", json=body)
    assert response.status_code == 202, response.text
    job = wait_for_import(client, response.json()["id"])
    assert job["state"] == "succeeded", job["error"]
    assert job["source"] == "SQL query"

    detail = client.get("/api/tables/reports/by_region").json()
    assert [c["name"] for c in detail["columns"]] == ["region", "count_star", "total_amount"]
    assert detail["row_count"] == 3
    assert client.post("/api/sql/save-table", json=body).status_code == 409

    overwrite = client.post(
        "/api/sql/save-table",
        json={
            **body,
            "sql": "SELECT * FROM reports.by_region WHERE region = 'north'",
            "mode": "overwrite",
        },
    )
    assert wait_for_import(client, overwrite.json()["id"])["state"] == "succeeded"
    result = client.post("/api/sql/run", json={"sql": "SELECT * FROM reports.by_region"}).json()
    assert result["rows"] == [["north", 2, 17.75]]

    bad = client.post("/api/sql/save-table", json={**body, "table": "x", "sql": "DROP VIEW orders"})
    assert bad.status_code == 422
