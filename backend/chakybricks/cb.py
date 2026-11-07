"""The `cb` helper preloaded in notebook kernels: same tables and names as the SQL editor."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any, Literal

import duckdb
import pandas as pd
import polars as pl
import pyarrow as pa
from deltalake import write_deltalake

from chakybricks import delta
from chakybricks.catalog import Catalog, parse_full_name
from chakybricks.config import Settings
from chakybricks.engine import Engine, quote_ident
from chakybricks.errors import InvalidInputError, NotFoundError
from chakybricks.ingest.sources import sanitize_column_names, storage_type
from chakybricks.statements import parse_statements
from chakybricks.workspace import Workspace

WORKSPACE_ENV = "CHAKYBRICKS_KERNEL_WORKSPACE"
MEMORY_ENV = "CHAKYBRICKS_KERNEL_MEMORY_MB"
BATCH_ROWS = 122_880

__all__ = ["save", "sql", "table", "tables"]


@dataclass(frozen=True)
class _Context:
    workspace: Workspace
    catalog: Catalog
    engine: Engine


@cache
def _context() -> _Context:
    root = os.environ.get(WORKSPACE_ENV)
    if not root:
        raise RuntimeError(f"{WORKSPACE_ENV} is not set; cb only works inside ChakyBricks kernels")
    memory = os.environ.get(MEMORY_ENV)
    workspace = Workspace(Path(root)).ensure()
    settings = Settings(workspace=workspace.root, memory_limit_mb=int(memory) if memory else None)
    catalog = Catalog(workspace.meta_db)
    return _Context(workspace, catalog, Engine(catalog, workspace, settings))


def sql(query: str) -> pl.DataFrame:
    """Runs SQL over the catalog and returns the last statement's result as a Polars DataFrame."""
    statements = parse_statements(query)
    writes = [s for s in statements if s.write is not None]
    if writes:
        raise InvalidInputError(
            "cb.sql runs read-only queries. Create or change tables with "
            'cb.save(df, "schema.table"), or use the SQL editor for CREATE/INSERT/DROP.'
        )
    with _context().engine.cursor() as cur:
        for statement in statements[:-1]:
            cur.sql(statement.sql).to_arrow_table()
        result = cur.sql(statements[-1].sql).to_arrow_table()
    return pl.from_arrow(result)  # type: ignore[return-value]


def table(name: str, version: int | None = None) -> pl.LazyFrame:
    """A lazy Polars frame over a catalog table; pass `version` for Delta time travel."""
    ctx = _context()
    schema, table_name = parse_full_name(name)
    info = ctx.catalog.get_table(schema, table_name)
    return pl.scan_delta(str(ctx.workspace.table_path(info.location)), version=version)


def tables() -> pl.DataFrame:
    """The catalog: one row per table."""
    rows = [
        {
            "schema": t.schema,
            "table": t.name,
            "rows": t.row_count,
            "size_bytes": t.size_bytes,
            "version": t.version,
            "updated_at": t.updated_at,
        }
        for t in _context().catalog.list_tables()
    ]
    return pl.DataFrame(
        rows,
        schema={
            "schema": pl.String,
            "table": pl.String,
            "rows": pl.Int64,
            "size_bytes": pl.Int64,
            "version": pl.Int64,
            "updated_at": pl.String,
        },
    )


def save(
    df: Any,
    name: str,
    mode: Literal["overwrite", "append"] = "overwrite",
    partition_by: str | None = None,
) -> dict[str, Any]:
    """Writes a Polars/pandas DataFrame or Arrow table to a Delta table and registers it."""
    if mode not in ("overwrite", "append"):
        raise InvalidInputError("mode must be 'overwrite' or 'append'")
    ctx = _context()
    schema, table_name = parse_full_name(name)
    existing = ctx.catalog.find_table(schema, table_name)
    if mode == "append" and existing is None:
        raise NotFoundError(f"Table {schema}.{table_name} does not exist; save it first")

    data = _to_arrow(df)
    names = sanitize_column_names(data.column_names)
    renamed = [f"{a} → {b}" for a, b in zip(data.column_names, names, strict=True) if a != b]
    if renamed:
        print(
            f"Renamed columns so they work in SQL and Python: {', '.join(renamed)}", file=sys.stderr
        )
    if partition_by is not None and partition_by not in names:
        raise InvalidInputError(f"Partition column '{partition_by}' is not in the data")

    ctx.catalog.ensure_schema(schema)
    location = existing.location if existing else ctx.workspace.table_location(schema, table_name)
    path = ctx.workspace.table_path(location)
    with ctx.engine.bulk_connection() as con:
        rel = con.from_arrow(data)
        expressions = []
        for index, (raw, target) in enumerate(zip(rel.types, names, strict=True), 1):
            kind = storage_type(str(raw))
            value = f"#{index}" if kind == str(raw) else f"CAST(#{index} AS {kind})"
            expressions.append(f"{value} AS {quote_ident(target)}")
        reader = rel.project(", ".join(expressions)).to_arrow_reader(BATCH_ROWS)
        appending = mode == "append"
        write_deltalake(
            str(path),
            reader,
            mode="append" if appending else "overwrite",
            partition_by=None if appending or partition_by is None else [partition_by],
            schema_mode="overwrite" if existing is not None and not appending else None,
        )
    info = ctx.catalog.upsert_table(
        schema, table_name, location, delta.table_stats(path), source="notebook"
    )
    return {
        "table": info.full_name,
        "rows": info.row_count,
        "version": info.version,
        "columns": [c.name for c in info.columns],
    }


def _to_arrow(df: Any) -> pa.Table:
    if isinstance(df, pl.LazyFrame):
        df = df.collect()
    if isinstance(df, pl.Series):
        df = df.to_frame()
    if isinstance(df, pl.DataFrame):
        return df.to_arrow()
    if isinstance(df, pd.Series):
        df = df.to_frame()
    if isinstance(df, pd.DataFrame):
        return pa.Table.from_pandas(df, preserve_index=False)
    if isinstance(df, pa.Table):
        return df
    if isinstance(df, pa.RecordBatchReader):
        return df.read_all()
    if isinstance(df, duckdb.DuckDBPyRelation):
        return df.to_arrow_table()
    raise InvalidInputError(
        f"cb.save expects a Polars or pandas DataFrame or an Arrow table, not {type(df).__name__}"
    )
