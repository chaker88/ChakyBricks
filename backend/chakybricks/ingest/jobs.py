import logging
import queue
import shutil
import threading
import time
import uuid
from collections import OrderedDict
from collections.abc import Iterator
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

import duckdb
import pyarrow as pa
from deltalake import write_deltalake
from pydantic import BaseModel

from chakybricks import delta
from chakybricks.catalog import Catalog, normalize_identifier, normalize_schema
from chakybricks.engine import Engine, quote_ident
from chakybricks.errors import ConflictError, InvalidInputError, NotFoundError
from chakybricks.ingest.sources import (
    ColumnSpec,
    SourceFormat,
    SourceOptions,
    apply_columns,
    estimate_rows,
    open_source,
    resolve_source,
    sanitize_column_names,
    storage_type,
)
from chakybricks.statements import result_query
from chakybricks.workspace import Workspace

log = logging.getLogger(__name__)

BATCH_ROWS = 122_880
MAX_FINISHED_JOBS = 50


class ImportMode(StrEnum):
    CREATE = "create"
    OVERWRITE = "overwrite"
    APPEND = "append"


class ImportState(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ImportRequest(BaseModel):
    path: str
    format: SourceFormat
    options: SourceOptions = SourceOptions()
    columns: list[ColumnSpec]
    schema_name: str
    table: str
    partition_by: str | None = None
    mode: ImportMode = ImportMode.CREATE


class QueryImportRequest(BaseModel):
    sql: str
    schema_name: str
    table: str
    partition_by: str | None = None
    mode: ImportMode = ImportMode.CREATE
    target_columns: list[ColumnSpec] | None = None


class ImportCancelled(Exception):
    pass


@dataclass
class ImportJob:
    request: ImportRequest | QueryImportRequest
    schema: str
    table: str
    source: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    state: ImportState = ImportState.QUEUED
    rows_written: int = 0
    estimated_rows: int | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)
    connection: duckdb.DuckDBPyConnection | None = None

    @property
    def done(self) -> bool:
        return self.state in (ImportState.SUCCEEDED, ImportState.FAILED, ImportState.CANCELLED)

    @property
    def progress(self) -> float | None:
        if self.state == ImportState.SUCCEEDED:
            return 1.0
        if not self.estimated_rows:
            return None
        return min(0.99, self.rows_written / self.estimated_rows)

    def to_dict(self) -> dict[str, Any]:
        end = self.finished_at or time.time()
        return {
            "id": self.id,
            "state": self.state.value,
            "schema": self.schema,
            "table": self.table,
            "source": self.source,
            "rows_written": self.rows_written,
            "estimated_rows": self.estimated_rows,
            "progress": self.progress,
            "error": self.error,
            "elapsed_seconds": round(end - self.started_at, 2) if self.started_at else 0,
        }


class ImportManager:
    """Runs imports one at a time on a background thread so large files never compete for RAM."""

    def __init__(self, workspace: Workspace, catalog: Catalog, engine: Engine) -> None:
        self.workspace = workspace
        self.catalog = catalog
        self.engine = engine
        self._jobs: OrderedDict[str, ImportJob] = OrderedDict()
        self._queue: queue.Queue[ImportJob | None] = queue.Queue()
        self._worker = threading.Thread(target=self._work, name="imports", daemon=True)
        self._worker.start()

    def submit(self, request: ImportRequest | QueryImportRequest) -> ImportJob:
        schema = normalize_schema(request.schema_name)
        table = normalize_identifier(request.table, "table name")
        if isinstance(request, ImportRequest):
            path = resolve_source(request.path)
            request = request.model_copy(update={"path": str(path)})
            source = str(path)
        else:
            request = request.model_copy(update={"sql": result_query(request.sql)})
            source = "SQL query"
        if request.mode == ImportMode.CREATE and self.catalog.find_table(schema, table):
            raise ConflictError(
                f"Table '{schema}.{table}' already exists; choose overwrite or append"
            )
        with self._connection(request) as con:
            rel, _ = self._relation(con, request)
            if request.partition_by and request.partition_by not in rel.columns:
                raise InvalidInputError(
                    f"Partition column '{request.partition_by}' is not imported"
                )
            try:
                rel.limit(0).to_arrow_table()
            except duckdb.Error as exc:
                raise InvalidInputError(str(exc)) from exc
        job = ImportJob(request=request, schema=schema, table=table, source=source)
        self._jobs[job.id] = job
        self._prune()
        self._queue.put(job)
        return job

    def get(self, job_id: str) -> ImportJob:
        job = self._jobs.get(job_id)
        if job is None:
            raise NotFoundError(f"Import '{job_id}' not found")
        return job

    def list(self) -> list[ImportJob]:
        return list(reversed(self._jobs.values()))

    def cancel(self, job_id: str) -> ImportJob:
        job = self.get(job_id)
        if job.done:
            return job
        job.cancel_event.set()
        if job.state == ImportState.QUEUED:
            self._finish(job, ImportState.CANCELLED)
        elif job.connection is not None:
            job.connection.interrupt()
        return job

    def wait(self, job_id: str, timeout: float = 60) -> ImportJob:
        deadline = time.time() + timeout
        job = self.get(job_id)
        while not job.done and time.time() < deadline:
            time.sleep(0.02)
        return job

    def shutdown(self) -> None:
        for job in self._jobs.values():
            if not job.done:
                self.cancel(job.id)
        self._queue.put(None)

    def _work(self) -> None:
        while (job := self._queue.get()) is not None:
            if job.done:
                continue
            try:
                self._run(job)
            except Exception as exc:
                if job.cancel_event.is_set():
                    self._finish(job, ImportState.CANCELLED)
                else:
                    log.exception("Import %s failed", job.id)
                    self._finish(job, ImportState.FAILED, _error_message(exc))

    def _run(self, job: ImportJob) -> None:
        request = job.request
        job.state = ImportState.RUNNING
        job.started_at = time.time()
        self.catalog.ensure_schema(job.schema)
        existing = self.catalog.find_table(job.schema, job.table)
        location = (
            existing.location if existing else self.workspace.table_location(job.schema, job.table)
        )
        table_path = self.workspace.table_path(location)
        if existing is None and table_path.exists():
            shutil.rmtree(table_path)

        con = self._connection(request)
        job.connection = con
        try:
            rel, job.estimated_rows = self._relation(con, request)
            reader = rel.to_arrow_reader(BATCH_ROWS)

            def batches() -> Iterator[pa.RecordBatch]:
                for batch in reader:
                    if job.cancel_event.is_set():
                        raise ImportCancelled()
                    job.rows_written += batch.num_rows
                    yield batch
                if job.cancel_event.is_set():
                    raise ImportCancelled()

            stream = pa.RecordBatchReader.from_batches(reader.schema, batches())
            appending = existing is not None and request.mode == ImportMode.APPEND
            write_deltalake(
                str(table_path),
                stream,
                mode="append" if appending else "overwrite",
                partition_by=None
                if appending or not request.partition_by
                else [request.partition_by],
                schema_mode="overwrite" if existing is not None and not appending else None,
            )
        except BaseException:
            if existing is None:
                shutil.rmtree(table_path, ignore_errors=True)
            raise
        finally:
            job.connection = None
            con.close()

        stats = delta.table_stats(table_path)
        self.catalog.upsert_table(job.schema, job.table, location, stats, source=job.source)
        self._finish(job, ImportState.SUCCEEDED)

    def _connection(self, request: ImportRequest | QueryImportRequest) -> duckdb.DuckDBPyConnection:
        return self.engine.bulk_connection(with_catalog=isinstance(request, QueryImportRequest))

    def _relation(
        self, con: duckdb.DuckDBPyConnection, request: ImportRequest | QueryImportRequest
    ) -> tuple[duckdb.DuckDBPyRelation, int | None]:
        if isinstance(request, QueryImportRequest):
            try:
                rel = con.sql(request.sql)
            except duckdb.Error as exc:
                raise InvalidInputError(str(exc)) from exc
            return _project_query(rel, request), None
        source = resolve_source(request.path)
        raw = open_source(con, source, request.format, request.options)
        return apply_columns(raw, request.columns), estimate_rows(source, request.format, raw)

    def _finish(self, job: ImportJob, state: ImportState, error: str | None = None) -> None:
        job.state = state
        job.error = error
        job.finished_at = time.time()

    def _prune(self) -> None:
        finished = [j.id for j in self._jobs.values() if j.done]
        for job_id in finished[: max(0, len(finished) - MAX_FINISHED_JOBS)]:
            del self._jobs[job_id]


def _project_query(
    rel: duckdb.DuckDBPyRelation, request: QueryImportRequest
) -> duckdb.DuckDBPyRelation:
    """Maps query output to table columns by position, so duplicate output names are fine."""
    raw_types = [str(t) for t in rel.types]
    if request.target_columns is None:
        names = sanitize_column_names(rel.columns)
        types = [storage_type(t) for t in raw_types]
    else:
        target = request.target_columns
        if len(target) != len(raw_types):
            raise InvalidInputError(
                f"The query returns {len(raw_types)} columns but "
                f"{request.schema_name}.{request.table} has {len(target)}: "
                + ", ".join(c.name for c in target)
            )
        names = [c.name for c in target]
        types = [c.type for c in target]
    expressions = []
    for index, (name, target_type, raw) in enumerate(zip(names, types, raw_types, strict=True), 1):
        value = f"#{index}" if target_type == raw else f"CAST(#{index} AS {target_type})"
        expressions.append(f"{value} AS {quote_ident(name)}")
    return rel.project(", ".join(expressions))


def _error_message(exc: BaseException) -> str:
    message = str(exc).strip() or type(exc).__name__
    return message.splitlines()[0] if len(message) > 2000 else message
