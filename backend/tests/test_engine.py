from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pyarrow as pa
from deltalake import write_deltalake

from chakybricks import delta
from chakybricks.services import Services


def add_table(services: Services, schema: str, name: str, data: pa.Table) -> None:
    location = services.workspace.table_location(schema, name)
    path = services.workspace.table_path(location)
    write_deltalake(str(path), data, mode="overwrite")
    services.catalog.upsert_table(schema, name, location, delta.table_stats(path))


def test_memory_limit_and_spill_dir_are_configured(services: Services) -> None:
    with services.engine.cursor() as cur:
        rows = cur.sql(
            "SELECT current_setting('memory_limit'), current_setting('temp_directory')"
        ).fetchall()
    memory, temp = rows[0]
    assert memory.endswith("iB")
    assert Path(temp).resolve() == services.workspace.tmp


def test_views_follow_catalog_changes(services: Services) -> None:
    services.catalog.ensure_schema("sales")
    add_table(services, "sales", "orders", pa.table({"id": [1, 2, 3]}))
    with services.engine.cursor() as cur:
        assert cur.sql("SELECT sum(id) FROM sales.orders").fetchall() == [(6,)]

    add_table(services, "sales", "orders", pa.table({"id": [10, 20]}))
    with services.engine.cursor() as cur:
        assert cur.sql("SELECT sum(id) FROM sales.orders").fetchall() == [(30,)]

    services.catalog.delete_table("sales", "orders")
    with services.engine.cursor() as cur:
        names = cur.sql("SELECT view_name FROM duckdb_views() WHERE NOT internal").fetchall()
    assert ("orders",) not in names


def test_table_written_by_another_process_appears(services: Services, home: Path) -> None:
    other = Services(home)
    try:
        add_table(other, "main", "shared", pa.table({"x": [1, 2]}))
    finally:
        other.close()
    with services.engine.cursor() as cur:
        assert cur.sql("SELECT count(*) FROM main.shared").fetchall() == [(2,)]


def test_concurrent_cursors(services: Services) -> None:
    add_table(services, "main", "nums", pa.table({"n": list(range(1000))}))

    def query(_: int) -> int:
        with services.engine.cursor() as cur:
            return int(cur.sql("SELECT sum(n) FROM main.nums").fetchall()[0][0])

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert set(pool.map(query, range(32))) == {499500}
