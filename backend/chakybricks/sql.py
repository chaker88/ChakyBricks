import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from functools import partial
from pathlib import Path
from typing import Any, Literal

import duckdb
import pyarrow as pa

from chakybricks.catalog import now_iso
from chakybricks.config import Settings
from chakybricks.engine import Engine, quote_ident
from chakybricks.errors import InvalidInputError, QueryCancelledError, QueryError
from chakybricks.queries import QueryStore
from chakybricks.serialization import relation_columns, relation_to_json, table_to_json
from chakybricks.statements import parse_statements, result_query

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


class QueryRunner:
    """Runs editor queries on engine cursors; each run is tracked by id so it can be cancelled."""

    def __init__(self, engine: Engine, store: QueryStore, settings: Callable[[], Settings]) -> None:
        self.engine = engine
        self.store = store
        self.settings = settings
        self._running: dict[str, duckdb.DuckDBPyConnection] = {}
        self._cancelled: set[str] = set()
        self._lock = threading.Lock()

    def run(self, sql: str, query_id: str, limit: int | None = None) -> dict[str, Any]:
        statements = parse_statements(sql)
        limit = max(1, limit or self.settings().row_limit)
        started_at = now_iso()
        start = time.perf_counter()

        def record(status: str, rows: int | None = None, error: str | None = None) -> int:
            elapsed = int((time.perf_counter() - start) * 1000)
            self.store.record_run(sql, started_at, elapsed, status, rows, error)
            return elapsed

        try:
            with self._track(query_id, self.engine.cursor()) as cur:
                check = partial(self._raise_if_cancelled, query_id)
                for statement in statements[:-1]:
                    check()
                    _drain(cur.sql(statement.query), check)
                check()
                rel = cur.sql(statements[-1].query)
                table, total = _first_rows(rel, limit, check)
                columns = relation_columns(rel)
        except QueryCancelledError:
            record("cancelled")
            raise
        except duckdb.Error as exc:
            if self._was_cancelled(query_id, exc):
                record("cancelled")
                raise QueryCancelledError() from exc
            message = _error_message(exc)
            record("failed", error=message)
            raise QueryError(message) from exc

        elapsed = record("succeeded", total)
        return {
            "query_id": query_id,
            **table_to_json(table, columns),
            "row_count": total,
            "truncated": total > table.num_rows,
            "elapsed_ms": elapsed,
            "statement_count": len(statements),
        }

    def cancel(self, query_id: str) -> bool:
        with self._lock:
            connection = self._running.get(query_id)
            if connection is None:
                return False
            self._cancelled.add(query_id)
        threading.Thread(
            target=self._interrupt_until_stopped, args=(query_id, connection), daemon=True
        ).start()
        return True

    def _interrupt_until_stopped(
        self, query_id: str, connection: duckdb.DuckDBPyConnection
    ) -> None:
        """An interrupt sent before DuckDB starts executing is lost, so repeat until it stops."""
        deadline = time.monotonic() + CANCEL_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            with self._lock:
                if self._running.get(query_id) is not connection:
                    return
            try:
                connection.interrupt()
            except duckdb.Error:
                return
            time.sleep(CANCEL_RETRY_SECONDS)

    def _raise_if_cancelled(self, query_id: str) -> None:
        with self._lock:
            if query_id in self._cancelled:
                raise QueryCancelledError()

    def export(self, sql: str, path: str, fmt: ExportFormat, query_id: str) -> dict[str, Any]:
        query = result_query(sql)
        target = Path(path)
        if not target.is_absolute() or not target.parent.is_dir():
            raise InvalidInputError(f"Cannot write to {path}")
        start = time.perf_counter()
        try:
            with self._track(
                query_id, _closing(self.engine.bulk_connection(with_catalog=True))
            ) as con:
                self._raise_if_cancelled(query_id)
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
            if self._was_cancelled(query_id, exc):
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
    def _track(self, query_id: str, connection_context: Any) -> Iterator[duckdb.DuckDBPyConnection]:
        with connection_context as connection:
            with self._lock:
                if query_id in self._running:
                    raise InvalidInputError(f"Query id {query_id} is already running")
                self._running[query_id] = connection
            try:
                yield connection
            finally:
                with self._lock:
                    self._running.pop(query_id, None)
                    self._cancelled.discard(query_id)

    def _was_cancelled(self, query_id: str, exc: duckdb.Error) -> bool:
        with self._lock:
            cancelled = query_id in self._cancelled
        return cancelled or isinstance(exc, duckdb.InterruptException)


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
