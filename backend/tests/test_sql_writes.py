import threading
import time
from pathlib import Path
from typing import Any

import pyarrow as pa
import pytest
from fastapi.testclient import TestClient

from chakybricks.errors import (
    ConflictError,
    InvalidInputError,
    NotFoundError,
    QueryCancelledError,
)
from chakybricks.ingest import jobs
from chakybricks.services import Services
from tests.test_sql import add_table


@pytest.fixture
def sales(services: Services) -> Services:
    add_table(
        services,
        "main",
        "sales",
        pa.table(
            {
                "id": [1, 2, 3, 4],
                "region": ["north", "south", "north", "east"],
                "amount": [10.0, 20.0, 30.0, 40.0],
            }
        ),
    )
    return services


def run(services: Services, sql: str) -> dict[str, Any]:
    return services.sql.run(sql, f"q-{time.time_ns()}")


def rows(services: Services, sql: str) -> list[list[Any]]:
    return list(run(services, sql)["rows"])


def test_create_table_as_select(sales: Services) -> None:
    result = run(sales, "CREATE TABLE north AS SELECT * FROM sales WHERE region = 'north'")
    assert result["kind"] == "write"
    assert result["rows"] == [] and result["columns"] == []
    assert result["row_count"] == 2
    assert result["message"] == "Created main.north with 2 rows · version 0"
    assert result["writes"][0] == {
        "action": "create",
        "table": "main.north",
        "message": "Created main.north with 2 rows · version 0",
        "rows_written": 2,
        "version": 0,
    }
    table = sales.catalog.get_table("main", "north")
    assert (table.row_count, table.version) == (2, 0)
    assert (sales.workspace.warehouse / "main" / "north" / "_delta_log").is_dir()
    assert rows(sales, "SELECT sum(amount) FROM north") == [[40.0]]
    created_run = sales.queries.history(2)[1]
    assert (created_run["status"], created_run["row_count"]) == ("succeeded", 2)


def test_create_existing_table_conflicts(sales: Services) -> None:
    with pytest.raises(ConflictError, match="CREATE OR REPLACE"):
        run(sales, "CREATE TABLE sales AS SELECT 1 AS id")
    assert sales.catalog.get_table("main", "sales").version == 0


def test_create_if_not_exists(sales: Services) -> None:
    skipped = run(sales, "CREATE TABLE IF NOT EXISTS sales AS SELECT 1 AS id")
    assert skipped["writes"][0]["action"] == "skipped"
    assert "already exists" in skipped["message"]
    assert sales.catalog.get_table("main", "sales").version == 0
    created = run(sales, "create table if not exists fresh as select 42 as answer")
    assert created["writes"][0]["action"] == "create"
    assert rows(sales, "SELECT * FROM fresh") == [[42]]


def test_create_or_replace(sales: Services) -> None:
    replaced = run(
        sales,
        "CREATE OR REPLACE TABLE sales AS "
        "SELECT region, sum(amount) AS total FROM sales GROUP BY 1",
    )
    assert replaced["writes"][0]["action"] == "replace"
    assert replaced["writes"][0]["version"] == 1
    assert replaced["message"] == "Replaced main.sales with 3 rows · version 1"
    table = sales.catalog.get_table("main", "sales")
    assert [c.name for c in table.columns] == ["region", "total"]
    assert rows(sales, "SELECT total FROM sales WHERE region = 'north'") == [[40.0]]
    new = run(sales, "CREATE OR REPLACE TABLE brand_new AS SELECT 1 AS x")
    assert new["writes"][0]["action"] == "create"


def test_create_in_new_schema_with_quoted_names(sales: Services) -> None:
    run(sales, 'CREATE TABLE "Reports"."By_Region" AS SELECT region FROM sales')
    assert sales.catalog.get_table("reports", "by_region").row_count == 4
    assert "reports" in sales.catalog.list_schemas()
    assert rows(sales, "SELECT count(*) FROM reports.by_region") == [[4]]


def test_created_column_names_are_sanitized(sales: Services) -> None:
    run(
        sales,
        'CREATE TABLE named AS SELECT 1 AS x, 2 AS x, count(*), 3 AS "Total Amount", '
        "'أحمد' AS الاسم FROM sales",
    )
    columns = [c.name for c in sales.catalog.get_table("main", "named").columns]
    assert columns == ["x", "x_2", "count_star", "total_amount", "الاسم"]
    assert rows(sales, "SELECT الاسم, x_2 FROM named") == [["أحمد", 2]]


def test_insert_into_select_maps_columns_by_position(sales: Services) -> None:
    result = run(sales, "INSERT INTO sales SELECT 5 AS a, 'west' AS b, 50 AS c")
    assert result["writes"][0]["action"] == "append"
    assert result["message"] == "Inserted 1 rows into main.sales · version 1"
    table = sales.catalog.get_table("main", "sales")
    assert (table.row_count, table.version) == (5, 1)
    assert [c.type for c in table.columns] == ["BIGINT", "VARCHAR", "DOUBLE"]
    assert rows(sales, "SELECT region, amount FROM sales WHERE id = 5") == [["west", 50.0]]
    run(sales, "INSERT INTO main.sales VALUES (6, 'east', 1.5), (7, 'east', 2.5)")
    assert sales.catalog.get_table("main", "sales").row_count == 7
    run(sales, "INSERT INTO sales SELECT * FROM sales WHERE region = 'east'")
    assert rows(sales, "SELECT count(*) FROM sales WHERE region = 'east'") == [[6]]


def test_insert_errors(sales: Services) -> None:
    with pytest.raises(InvalidInputError, match=r"returns 1 columns but main\.sales has 3"):
        run(sales, "INSERT INTO sales SELECT 1")
    with pytest.raises(NotFoundError, match="does not exist"):
        run(sales, "INSERT INTO missing SELECT 1")
    with pytest.raises(InvalidInputError, match="Invalid query"):
        run(sales, "INSERT INTO sales SELECT 1, 'x', 2.0 RETURNING id")
    assert sales.catalog.get_table("main", "sales").version == 0


def test_drop_table(sales: Services) -> None:
    result = run(sales, "DROP TABLE sales")
    assert result["writes"][0]["action"] == "drop"
    assert result["message"] == "Dropped main.sales"
    assert sales.catalog.find_table("main", "sales") is None
    assert not (sales.workspace.warehouse / "main" / "sales").exists()
    with pytest.raises(NotFoundError):
        run(sales, "DROP TABLE sales")
    skipped = run(sales, "DROP TABLE IF EXISTS sales;")
    assert skipped["writes"][0]["action"] == "skipped"


def test_alter_table_rename(sales: Services) -> None:
    result = run(sales, "ALTER TABLE sales RENAME TO orders")
    assert result["message"] == "Renamed main.sales to main.orders"
    assert sales.catalog.find_table("main", "sales") is None
    assert rows(sales, "SELECT count(*) FROM orders") == [[4]]
    with pytest.raises(NotFoundError):
        run(sales, "ALTER TABLE sales RENAME TO x")
    assert run(sales, "ALTER TABLE IF EXISTS sales RENAME TO x")["writes"][0]["action"] == (
        "skipped"
    )
    run(sales, "CREATE TABLE other AS SELECT 1 AS a")
    with pytest.raises(ConflictError):
        run(sales, "ALTER TABLE other RENAME TO orders")


def test_write_then_read_in_one_run(sales: Services) -> None:
    result = run(
        sales,
        "CREATE TABLE totals AS SELECT region, sum(amount) AS total FROM sales GROUP BY 1;\n"
        "INSERT INTO totals SELECT 'all', sum(amount) FROM sales;\n"
        "SELECT region, total FROM totals ORDER BY total DESC",
    )
    assert result["kind"] == "rows"
    assert [w["action"] for w in result["writes"]] == ["create", "append"]
    assert result["rows"][0] == ["all", 100.0]
    assert result["row_count"] == 4


def test_cancel_running_create(sales: Services, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(jobs, "BATCH_ROWS", 100)
    query_id = "slow-create"
    errors: list[BaseException] = []

    def target() -> None:
        try:
            sales.sql.run("CREATE TABLE big AS SELECT * FROM range(5000000) t(i)", query_id)
        except BaseException as exc:
            errors.append(exc)

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not sales.sql.cancel(query_id) and time.time() < deadline:
        time.sleep(0.01)
    thread.join(30)
    assert not thread.is_alive()
    assert isinstance(errors[0], QueryCancelledError)
    assert sales.catalog.find_table("main", "big") is None
    assert not (sales.workspace.warehouse / "main" / "big").exists()
    assert sales.queries.history(1)[0]["status"] == "cancelled"


def test_write_endpoints(client: TestClient, files: dict[str, Path]) -> None:
    from tests.test_api import import_csv

    import_csv(client, files["csv"], "main", "orders")
    created = client.post(
        "/api/sql/run", json={"sql": "CREATE TABLE copy AS SELECT * FROM orders"}
    ).json()
    assert created["kind"] == "write"
    assert created["message"] == "Created main.copy with 4 rows · version 0"
    catalog = client.get("/api/catalog").json()["schemas"]
    assert "copy" in [t["name"] for t in catalog[0]["tables"]]
    conflict = client.post("/api/sql/run", json={"sql": "CREATE TABLE copy AS SELECT 1"})
    assert conflict.status_code == 409
    rejected = client.post("/api/sql/run", json={"sql": "UPDATE copy SET amount = 0"})
    assert rejected.status_code == 422
    assert "UPDATE statements are not supported" in rejected.json()["detail"]
    assert client.post("/api/sql/run", json={"sql": "DROP TABLE copy"}).json()["kind"] == "write"
    assert client.get("/api/tables/main/copy").status_code == 404
