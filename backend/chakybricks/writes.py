from __future__ import annotations

import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from chakybricks import tables
from chakybricks.errors import ConflictError, NotFoundError, QueryCancelledError, QueryError
from chakybricks.ingest.jobs import ImportMode, ImportState, QueryImportRequest
from chakybricks.ingest.sources import ColumnSpec
from chakybricks.statements import WriteAction, WriteStatement

if TYPE_CHECKING:
    from chakybricks.services import Services

POLL_SECONDS = 0.05


class SqlWriter:
    """Executes editor write statements on Delta tables and the catalog, never in DuckDB."""

    def __init__(self, services: Services) -> None:
        self.services = services

    def cancel_job(self, job_id: str) -> None:
        self.services.imports.cancel(job_id)

    def execute(
        self,
        write: WriteStatement,
        on_job: Callable[[str], None],
        cancelled: Callable[[], bool],
    ) -> dict[str, Any]:
        catalog = self.services.catalog
        existing = catalog.find_table(write.schema, write.table)
        name = write.full_name

        if write.action in (WriteAction.DROP, WriteAction.DROP_IF_EXISTS):
            if existing is None:
                if write.action == WriteAction.DROP_IF_EXISTS:
                    return _outcome("skipped", name, f"{name} does not exist — nothing dropped")
                raise NotFoundError(f"Table {name} does not exist")
            tables.drop(self.services, write.schema, write.table)
            return _outcome("drop", name, f"Dropped {name}")

        if write.action in (WriteAction.RENAME, WriteAction.RENAME_IF_EXISTS):
            if existing is None:
                if write.action == WriteAction.RENAME_IF_EXISTS:
                    return _outcome("skipped", name, f"{name} does not exist — nothing renamed")
                raise NotFoundError(f"Table {name} does not exist")
            renamed = tables.rename(
                self.services, write.schema, write.table, write.schema, write.new_name or ""
            )
            return _outcome(
                "rename",
                renamed.full_name,
                f"Renamed {name} to {renamed.full_name}",
                version=renamed.version,
            )

        if write.action == WriteAction.CREATE_IF_NOT_EXISTS and existing is not None:
            return _outcome("skipped", name, f"{name} already exists — nothing created")
        if write.action in (WriteAction.CREATE, WriteAction.CREATE_IF_NOT_EXISTS) and existing:
            raise ConflictError(f"Table {name} already exists; use CREATE OR REPLACE TABLE")
        if write.action == WriteAction.APPEND and existing is None:
            raise NotFoundError(
                f"Table {name} does not exist; create it with CREATE TABLE {name} AS SELECT …"
            )

        mode = {
            WriteAction.CREATE: ImportMode.CREATE,
            WriteAction.CREATE_IF_NOT_EXISTS: ImportMode.CREATE,
            WriteAction.REPLACE: ImportMode.OVERWRITE,
            WriteAction.APPEND: ImportMode.APPEND,
        }[write.action]
        target = (
            [ColumnSpec(source=c.name, name=c.name, type=c.type) for c in existing.columns]
            if write.action == WriteAction.APPEND and existing is not None
            else None
        )
        request = QueryImportRequest(
            sql=write.query or "",
            schema_name=write.schema,
            table=write.table,
            mode=mode,
            target_columns=target,
        )
        job = self.services.imports.submit(request)
        on_job(job.id)
        while not job.done:
            if cancelled():
                self.services.imports.cancel(job.id)
            time.sleep(POLL_SECONDS)
        if job.state == ImportState.CANCELLED:
            raise QueryCancelledError()
        if job.state == ImportState.FAILED:
            raise QueryError(job.error or f"Writing {name} failed")

        table = catalog.get_table(write.schema, write.table)
        rows = job.rows_written
        if write.action == WriteAction.APPEND:
            action, message = "append", f"Inserted {rows:,} rows into {name}"
        elif write.action == WriteAction.REPLACE and existing is not None:
            action, message = "replace", f"Replaced {name} with {rows:,} rows"
        else:
            action, message = "create", f"Created {name} with {rows:,} rows"
        return _outcome(
            action,
            name,
            f"{message} · version {table.version}",
            rows_written=rows,
            version=table.version,
        )


def _outcome(
    action: str,
    table: str,
    message: str,
    *,
    rows_written: int | None = None,
    version: int | None = None,
) -> dict[str, Any]:
    return {
        "action": action,
        "table": table,
        "message": message,
        "rows_written": rows_written,
        "version": version,
    }
