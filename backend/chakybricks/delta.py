from pathlib import Path
from typing import Any

import duckdb
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.dataset as pads
from deltalake import DeltaTable

from chakybricks.catalog import Column, TableStats


def open_table(path: Path, version: int | None = None) -> DeltaTable:
    return DeltaTable(str(path), version=version)


def dataset(path: Path, version: int | None = None) -> pads.Dataset:
    return open_table(path, version).to_pyarrow_dataset()


def arrow_schema(table: DeltaTable) -> pa.Schema:
    return pa.schema(table.schema().to_arrow())


def duckdb_columns(schema: pa.Schema) -> list[Column]:
    with duckdb.connect() as con:
        rel = con.from_arrow(schema.empty_table())
        return [Column(name, str(t)) for name, t in zip(rel.columns, rel.types, strict=True)]


def table_stats(path: Path) -> TableStats:
    table = open_table(path)
    actions = pa.table(table.get_add_actions(flatten=True))
    size_bytes = int(pc.sum(actions["size_bytes"]).as_py() or 0)
    records = actions["num_records"] if "num_records" in actions.column_names else None
    if records is not None and records.null_count == 0:
        row_count = int(pc.sum(records).as_py() or 0)
    else:
        row_count = table.to_pyarrow_dataset().count_rows()
    return TableStats(
        version=table.version(),
        row_count=row_count,
        size_bytes=size_bytes,
        columns=duckdb_columns(arrow_schema(table)),
    )


def history(path: Path, limit: int | None = None) -> list[dict[str, Any]]:
    entries = open_table(path).history(limit)
    return [
        {
            "version": entry.get("version"),
            "timestamp": entry.get("timestamp"),
            "operation": entry.get("operation"),
            "parameters": entry.get("operationParameters") or {},
            "metrics": entry.get("operationMetrics") or {},
        }
        for entry in entries
    ]
