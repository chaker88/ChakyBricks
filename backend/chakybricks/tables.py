import shutil
import uuid
from typing import Any

import duckdb

from chakybricks import delta
from chakybricks.catalog import TableInfo, normalize_identifier, normalize_schema
from chakybricks.engine import quote_ident
from chakybricks.errors import ConflictError, InvalidInputError
from chakybricks.serialization import relation_to_json
from chakybricks.services import Services

MAX_SAMPLE_ROWS = 1000


def table_summary(table: TableInfo) -> dict[str, Any]:
    return {
        "schema": table.schema,
        "name": table.name,
        "version": table.version,
        "row_count": table.row_count,
        "size_bytes": table.size_bytes,
        "updated_at": table.updated_at,
        "columns": [{"name": c.name, "type": c.type} for c in table.columns],
    }


def describe(services: Services, schema: str, name: str) -> dict[str, Any]:
    table = services.catalog.get_table(schema, name)
    path = services.workspace.table_path(table.location)
    return {
        **table_summary(table),
        "location": str(path),
        "source": table.source,
        "created_at": table.created_at,
        "partition_columns": delta.open_table(path).metadata().partition_columns,
    }


def sample(
    services: Services, schema: str, name: str, limit: int, version: int | None = None
) -> dict[str, Any]:
    table = services.catalog.get_table(schema, name)
    limit = max(1, min(limit, MAX_SAMPLE_ROWS))
    if version is None:
        with services.engine.cursor() as cur:
            view = f"{quote_ident(table.schema)}.{quote_ident(table.name)}"
            return relation_to_json(cur.sql(f"SELECT * FROM {view} LIMIT {limit}"))
    if not 0 <= version <= table.version:
        raise InvalidInputError(f"Version must be between 0 and {table.version}")
    ds = delta.dataset(services.workspace.table_path(table.location), version)
    with duckdb.connect() as con:
        con.register("__cb_version", ds)
        return relation_to_json(con.sql(f"SELECT * FROM __cb_version LIMIT {limit}"))


def history(services: Services, schema: str, name: str) -> list[dict[str, Any]]:
    table = services.catalog.get_table(schema, name)
    return delta.history(services.workspace.table_path(table.location))


def rename(services: Services, schema: str, name: str, new_schema: str, new_name: str) -> TableInfo:
    table = services.catalog.get_table(schema, name)
    new_schema = normalize_schema(new_schema)
    new_name = normalize_identifier(new_name, "table name")
    if (new_schema, new_name) == (schema, name):
        return table
    if services.catalog.find_table(new_schema, new_name):
        raise ConflictError(f"Table '{new_schema}.{new_name}' already exists")
    services.catalog.ensure_schema(new_schema)
    location = services.workspace.table_location(new_schema, new_name)
    source = services.workspace.table_path(table.location)
    target = services.workspace.table_path(location)
    if target.exists():
        raise ConflictError(f"Folder {target} already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        source.rename(target)
    except OSError as exc:
        raise ConflictError(f"Could not move table files (are they in use?): {exc}") from exc
    renamed = services.catalog.rename_table(schema, name, new_schema, new_name, location)
    services.engine.sync()
    return renamed


def drop(services: Services, schema: str, name: str) -> None:
    table = services.catalog.get_table(schema, name)
    path = services.workspace.table_path(table.location)
    trash = services.workspace.tmp / f"dropped-{uuid.uuid4().hex}"
    if path.exists():
        try:
            path.rename(trash)
        except OSError as exc:
            raise ConflictError(f"Could not remove table files (are they in use?): {exc}") from exc
    services.catalog.delete_table(schema, name)
    services.engine.sync()
    shutil.rmtree(trash, ignore_errors=True)
