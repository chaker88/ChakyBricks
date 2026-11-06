from pathlib import Path

import pytest

from chakybricks.catalog import (
    Catalog,
    Column,
    TableStats,
    normalize_identifier,
    normalize_schema,
    parse_full_name,
)
from chakybricks.errors import ConflictError, InvalidInputError, NotFoundError

STATS = TableStats(version=0, row_count=3, size_bytes=100, columns=[Column("id", "BIGINT")])


@pytest.fixture
def catalog(tmp_path: Path) -> Catalog:
    return Catalog(tmp_path / "meta.db")


def test_identifiers() -> None:
    assert normalize_identifier(" Sales_2024 ") == "sales_2024"
    for bad in ["", "1abc", "a-b", "a b", "__cb_x", "x" * 64]:
        with pytest.raises(InvalidInputError):
            normalize_identifier(bad)
    with pytest.raises(InvalidInputError):
        normalize_schema("temp")
    assert parse_full_name("orders") == ("main", "orders")
    assert parse_full_name("Sales.Orders") == ("sales", "orders")
    with pytest.raises(InvalidInputError):
        parse_full_name("a.b.c")


def test_default_schema_and_migrations_are_idempotent(tmp_path: Path) -> None:
    Catalog(tmp_path / "meta.db")
    catalog = Catalog(tmp_path / "meta.db")
    assert catalog.list_schemas() == ["main"]


def test_schema_lifecycle(catalog: Catalog) -> None:
    catalog.create_schema("Sales")
    assert catalog.list_schemas() == ["main", "sales"]
    with pytest.raises(ConflictError):
        catalog.create_schema("sales")
    catalog.upsert_table("sales", "orders", "sales/orders", STATS)
    with pytest.raises(ConflictError):
        catalog.drop_schema("sales")
    catalog.delete_table("sales", "orders")
    catalog.drop_schema("sales")
    with pytest.raises(InvalidInputError):
        catalog.drop_schema("main")
    with pytest.raises(NotFoundError):
        catalog.drop_schema("nope")


def test_table_upsert_rename_delete(catalog: Catalog) -> None:
    created = catalog.upsert_table("main", "orders", "main/orders", STATS, source="a.csv")
    assert created.full_name == "main.orders"
    assert created.columns == [Column("id", "BIGINT")]

    updated = catalog.upsert_table(
        "main", "orders", "main/orders", TableStats(1, 5, 200, STATS.columns)
    )
    assert (updated.version, updated.row_count, updated.source) == (1, 5, "a.csv")
    assert updated.created_at == created.created_at

    catalog.ensure_schema("archive")
    renamed = catalog.rename_table("main", "orders", "archive", "old_orders", "archive/old")
    assert renamed.full_name == "archive.old_orders"
    assert catalog.find_table("main", "orders") is None

    catalog.delete_table("archive", "old_orders")
    with pytest.raises(NotFoundError):
        catalog.get_table("archive", "old_orders")
