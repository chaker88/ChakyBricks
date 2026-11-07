import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Any, Literal

import duckdb
import pyarrow as pa

from chakybricks.catalog import now_iso
from chakybricks.config import Settings
from chakybricks.engine import Engine, quote_ident
from chakybricks.errors import (
    ChakyError,
    InvalidInputError,
    QueryCancelledError,
    QueryError,
)
from chakybricks.queries import QueryStore
from chakybricks.serialization import relation_columns, relation_to_json, table_to_json
from chakybricks.statements import parse_statements, result_query
from chakybricks.writes import SqlWriter

MAX_BATCH_ROWS = 122_880
TOP_VALUES = 10
CANCEL_RETRY_SECONDS = 0.05
CANCEL_TIMEOUT_SECONDS = 60
NUMERIC_PREFIXES = (
    "TINYINT",
    "SMALLINT",
    "INTEGER",
    "BIGINT",
    "HUGEINT",
    "UTINYINT",
    "USMALLINT",
    "UINTEGER",
    "UBIGINT",
    "UHUGEINT",
    "FLOAT",
    "DOUBLE",
    "DECIMAL",
)
UNORDERED_PREFIXES = ("STRUCT", "MAP", "UNION", "BLOB")

ExportFormat = Literal["csv", "parquet"]


@dataclass
class _Run:
    connection: duckdb.DuckDBPyConnection | None = None
    job_id: str | None = None
    cancelled: bool = False


class QueryRunner:
    """Runs editor SQL: reads on engine cursors, writes through Delta; cancellable by query id."""

    def __init__(
        self,
        engine: Engine,
        store: QueryStore,
        settings: Callable[[], Settings],
        writer: SqlWriter,
    ) -> None:
        self.engine = engine
        self.store = store
        self.settings = settings
        self.writer = writer
        self._runs: dict[str, _Run] = {}
        self._lock = threading.Lock()

    def run(self, sql: str, query_id: str, limit: int | None = None) -> dict[str, Any]:
        statements = parse_statements(sql)
        limit = max(1, limit or self.settings().row_limit)
        started_at = now_iso()
        start = time.perf_counter()
        writes: list[dict[str, Any]] = []
        table: pa.Table | None = None
        columns: list[dict[str, str]] = []
        total = 0

        def record(status: str, rows: int | None = None, error: str | None = None) -> int:
            elapsed = int((time.perf_counter() - start) * 1000)
            self.store.record_run(sql, started_at, elapsed, status, rows, error)
            return elapsed

        run = _Run()
        try:
            with self._track(query_id, run):
                check = partial(self._raise_if_cancelled, run)
                for index, statement in enumerate(statements):
                    check()
                    last = index == len(statements) - 1
                    if statement.write is not None:
                        writes.append(
                            self.writer.execute(
                                statement.write,
                                on_job=partial(self._set_job, run),
                                cancelled=lambda: run.cancelled,
                            )
                        )
                        continue
                    with self._use(run, self.engine.cursor()) as cur:
                        rel = cur.sql(statement.sql)
                        if last:
                            table, total = _first_rows(rel, limit, check)
                            columns = relation_columns(rel)
                        else:
                            _drain(rel, check)
        except QueryCancelledError:
            record("cancelled")
            raise
        except duckdb.Error as exc:
            if run.cancelled or isinstance(exc, duckdb.InterruptException):
                record("cancelled")
                raise QueryCancelledError() from exc
            message = _error_message(exc)
            record("failed", error=message)
            raise QueryError(message) from exc
        except ChakyError as exc:
            record("failed", error=str(exc))
            raise

        base = {"query_id": query_id, "statement_count": len(statements), "writes": writes}
        if table is None:
            outcome = writes[-1]
            elapsed = record("succeeded", outcome["rows_written"])
            return {
                **base,
                "kind": "write",
                "message": outcome["message"],
                "columns": [],
                "rows": [],
                "row_count": outcome["rows_written"] or 0,
                "truncated": False,
                "elapsed_ms": elapsed,
            }
        elapsed = record("succeeded", total)
        return {
            **base,
            "kind": "rows",
            **table_to_json(table, columns),
            "row_count": total,
            "truncated": total > table.num_rows,
            "elapsed_ms": elapsed,
        }

    def cancel(self, query_id: str) -> bool:
        with self._lock:
            run = self._runs.get(query_id)
            if run is None:
                return False
            run.cancelled = True
            job_id = run.job_id
        if job_id:
            self.writer.cancel_job(job_id)
        threading.Thread(
            target=self._interrupt_until_stopped, args=(query_id, run), daemon=True
        ).start()
        return True

    def _interrupt_until_stopped(self, query_id: str, run: _Run) -> None:
        """An interrupt sent before DuckDB starts executing is lost, so repeat until it stops."""
        deadline = time.monotonic() + CANCEL_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            with self._lock:
                if self._runs.get(query_id) is not run:
                    return
                connection = run.connection
            if connection is not None:
                with suppress(duckdb.Error):
                    connection.interrupt()
            time.sleep(CANCEL_RETRY_SECONDS)

    def _set_job(self, run: _Run, job_id: str) -> None:
        with self._lock:
            run.job_id = job_id
            cancelled = run.cancelled
        if cancelled:
            self.writer.cancel_job(job_id)

    def _raise_if_cancelled(self, run: _Run) -> None:
        if run.cancelled:
            raise QueryCancelledError()

    def export(self, sql: str, path: str, fmt: ExportFormat, query_id: str) -> dict[str, Any]:
        query = result_query(sql)
        target = Path(path)
        if not target.is_absolute() or not target.parent.is_dir():
            raise InvalidInputError(f"Cannot write to {path}")
        start = time.perf_counter()
        run = _Run()
        try:
            with (
                self._track(query_id, run),
                self._use(run, _closing(self.engine.bulk_connection(with_catalog=True))) as con,
            ):
                self._raise_if_cancelled(run)
                rel = con.sql(query)
                if fmt == "csv":
                    rel.write_csv(str(target), header=True)
                else:
                    rel.write_parquet(str(target))
        except QueryCancelledError:
            target.unlink(missing_ok=True)
            raise
        except duckdb.Error as exc:
            target.unlink(missing_ok=True)
            if run.cancelled or isinstance(exc, duckdb.InterruptException):
                raise QueryCancelledError() from exc
            raise QueryError(_error_message(exc)) from exc
        return {
            "path": str(target),
            "size_bytes": target.stat().st_size,
            "elapsed_ms": int((time.perf_counter() - start) * 1000),
        }

    def column_stats(self, sql: str, column: str) -> dict[str, Any]:
        query = result_query(sql)
        try:
            with self.engine.cursor() as cur:
                rel = cur.sql(query)
                types = dict(zip(rel.columns, (str(t) for t in rel.types), strict=True))
                if column not in types:
                    raise InvalidInputError(f"Column '{column}' is not in the result")
                return _column_stats(rel, column, types[column])
        except duckdb.Error as exc:
            raise QueryError(_error_message(exc)) from exc

    @contextmanager
    def _track(self, query_id: str, run: _Run) -> Iterator[_Run]:
        with self._lock:
            if query_id in self._runs:
                raise InvalidInputError(f"Query id {query_id} is already running")
            self._runs[query_id] = run
        try:
            yield run
        finally:
            with self._lock:
                self._runs.pop(query_id, None)

    @contextmanager
    def _use(self, run: _Run, connection_context: Any) -> Iterator[duckdb.DuckDBPyConnection]:
        with connection_context as connection:
            with self._lock:
                run.connection = connection
            try:
                yield connection
            finally:
                with self._lock:
                    run.connection = None


@contextmanager
def _closing(connection: duckdb.DuckDBPyConnection) -> Iterator[duckdb.DuckDBPyConnection]:
    try:
        yield connection
    finally:
        connection.close()


def _drain(rel: duckdb.DuckDBPyRelation, check: Callable[[], None]) -> None:
    reader = rel.to_arrow_reader(MAX_BATCH_ROWS)
    for _ in reader:
        check()


def _first_rows(
    rel: duckdb.DuckDBPyRelation, limit: int, check: Callable[[], None]
) -> tuple[pa.Table, int]:
    reader = rel.to_arrow_reader(min(limit + 1, MAX_BATCH_ROWS))
    batches: list[pa.RecordBatch] = []
    rows = 0
    exhausted = True
    for batch in reader:
        check()
        batches.append(batch)
        rows += batch.num_rows
        if rows > limit:
            exhausted = False
            break
    schema = reader.schema
    reader.close()
    table = pa.Table.from_batches(batches, schema=schema).slice(0, limit)
    if exhausted:
        return table, rows
    check()
    count = rel.aggregate("count(*)").to_arrow_table().column(0)[0].as_py()
    return table, int(count)


def _column_stats(rel: duckdb.DuckDBPyRelation, column: str, duck_type: str) -> dict[str, Any]:
    c = quote_ident(column)
    numeric = duck_type.startswith(NUMERIC_PREFIXES)
    ordered = not duck_type.startswith(UNORDERED_PREFIXES) and not duck_type.endswith("]")
    aggregates = [
        "count(*) AS rows",
        f"count({c}) AS non_null",
        f"approx_count_distinct({c}) AS distinct",
    ]
    if ordered:
        aggregates += [f"min({c}) AS min", f"max({c}) AS max"]
    if numeric:
        aggregates += [
            f"avg({c}::DOUBLE) AS mean",
            f"stddev_samp({c}::DOUBLE) AS stddev",
            f"quantile_cont({c}::DOUBLE, 0.25) AS p25",
            f"quantile_cont({c}::DOUBLE, 0.5) AS median",
            f"quantile_cont({c}::DOUBLE, 0.75) AS p75",
        ]
    summary = relation_to_json(rel.aggregate(", ".join(aggregates)))
    stats = dict(zip((col["name"] for col in summary["columns"]), summary["rows"][0], strict=True))
    top: list[dict[str, Any]] = []
    if ordered:
        grouped = (
            rel.aggregate(f"{c} AS value, count(*) AS count", c)
            .order("count DESC, value")
            .limit(TOP_VALUES)
        )
        top = [{"value": v, "count": n} for v, n in relation_to_json(grouped)["rows"]]
    rows = stats.pop("rows")
    return {
        "column": column,
        "type": duck_type,
        "rows": rows,
        "nulls": rows - stats.pop("non_null"),
        "numeric": numeric,
        **stats,
        "top_values": top,
    }


def _error_message(exc: Exception) -> str:
    return str(exc).strip() or type(exc).__name__
