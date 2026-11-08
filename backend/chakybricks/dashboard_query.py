import calendar
import hashlib
import json
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

import duckdb
import pyarrow as pa
import pyarrow.compute as pc

from chakybricks.catalog import Catalog
from chakybricks.dashboard_models import (
    MAX_TABLE_ROWS,
    Condition,
    FieldRef,
    Metric,
    OptionsQuery,
    Sort,
    Source,
    TileConfig,
    TileQuery,
)
from chakybricks.engine import quote_ident
from chakybricks.errors import InvalidInputError
from chakybricks.queries import QueryStore
from chakybricks.serialization import relation_columns, table_to_json
from chakybricks.sql import QueryRunner
from chakybricks.statements import parse_statements

QUERY_VIEW = "__cb_dashboard_source"
CACHE_ENTRIES = 256
SERIES_CAP = 8
HEATMAP_SERIES_CAP = 20
DEFAULT_LIMIT = 50
TIME_LIMIT = 1000
SCATTER_LIMIT = 300
TREND_POINTS = 120
OPTION_VALUES = 200
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
INTEGER_PREFIXES = NUMERIC_PREFIXES[:10]


def is_numeric(duck_type: str) -> bool:
    return duck_type.startswith(NUMERIC_PREFIXES)


def is_temporal(duck_type: str) -> bool:
    return duck_type == "DATE" or duck_type.startswith("TIMESTAMP")


@dataclass(frozen=True)
class _Source:
    ref: str
    columns: dict[str, str]
    token: list[Any]


@dataclass(frozen=True)
class _Fetched:
    table: pa.Table
    columns: list[dict[str, str]]


class _ResultCache:
    """Small LRU of query results keyed by (SQL, parameters, table versions)."""

    def __init__(self, entries: int) -> None:
        self._entries = entries
        self._items: OrderedDict[str, _Fetched] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> _Fetched | None:
        with self._lock:
            item = self._items.get(key)
            if item is not None:
                self._items.move_to_end(key)
            return item

    def put(self, key: str, item: _Fetched) -> None:
        with self._lock:
            self._items[key] = item
            self._items.move_to_end(key)
            while len(self._items) > self._entries:
                self._items.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()


class _Query:
    """A tile query being assembled against one resolved source; values are always parameters."""

    def __init__(self, source: _Source, conditions: list[Condition]) -> None:
        self.source = source
        self.where, self.params = self._conditions(conditions)

    def column(self, name: str | None) -> str:
        if name is None or name not in self.source.columns:
            raise InvalidInputError(f"Column '{name}' is not in the data source")
        return quote_ident(name)

    def type_of(self, name: str) -> str:
        self.column(name)
        return self.source.columns[name]

    def dimension(self, field: FieldRef) -> str:
        column = self.column(field.column)
        if field.grain is None:
            return column
        if not is_temporal(self.source.columns[field.column]):
            raise InvalidInputError(
                f"'{field.column}' is not a date, so it cannot be grouped by it"
            )
        return f"CAST(date_trunc('{field.grain}', {column}) AS DATE)"

    def metric(self, metric: Metric) -> str:
        if metric.column is None:
            if metric.agg != "count":
                raise InvalidInputError(f"Choose a column to {metric.agg.replace('_', ' ')}")
            return "CAST(count(*) AS DOUBLE)"
        column = self.column(metric.column)
        numeric = is_numeric(self.source.columns[metric.column])
        if metric.agg in ("sum", "avg") and not numeric:
            raise InvalidInputError(
                f"'{metric.column}' is not numeric, so it cannot be a {metric.agg}"
            )
        match metric.agg:
            case "sum" | "avg":
                return f"CAST({metric.agg}({column}) AS DOUBLE)"
            case "count":
                return f"CAST(count({column}) AS DOUBLE)"
            case "count_distinct":
                return f"CAST(count(DISTINCT {column}) AS DOUBLE)"
            case _:
                inner = f"{metric.agg}({column})"
                return f"CAST({inner} AS DOUBLE)" if numeric else inner

    def _conditions(self, conditions: list[Condition]) -> tuple[str, list[Any]]:
        parts: list[str] = []
        params: list[Any] = []
        for condition in conditions:
            if condition.column not in self.source.columns:
                continue
            clause = self._condition(condition, params)
            if clause:
                parts.append(clause)
        return (" WHERE " + " AND ".join(parts)) if parts else "", params

    def _condition(self, c: Condition, params: list[Any]) -> str:
        column = quote_ident(c.column)
        duck_type = self.source.columns[c.column]
        clauses: list[str] = []
        try:
            if c.kind == "date_range":
                if not is_temporal(duck_type):
                    raise InvalidInputError(f"'{c.column}' is not a date column")
                if c.start:
                    clauses.append(f"{column} >= ?")
                    params.append(_parse_date(c.start))
                if c.end:
                    clauses.append(f"{column} < ?")
                    params.append(_parse_date(c.end) + timedelta(days=1))
            elif c.kind == "number_range":
                if c.minimum is not None:
                    clauses.append(f"{column} >= ?")
                    params.append(c.minimum)
                if c.maximum is not None:
                    clauses.append(f"{column} <= ?")
                    params.append(c.maximum)
            elif c.values:
                return self._membership(c, column, duck_type, params)
        except (ValueError, OverflowError) as exc:
            raise InvalidInputError(f"Invalid filter value for '{c.column}': {exc}") from exc
        return " AND ".join(clauses)

    def _membership(self, c: Condition, column: str, duck_type: str, params: list[Any]) -> str:
        values = [v for v in c.values if v is not None]
        expr = column
        if c.grain is not None:
            if not is_temporal(duck_type):
                raise InvalidInputError(f"'{c.column}' is not a date column")
            expr = f"CAST(date_trunc('{c.grain}', {column}) AS DATE)"
            params.extend(_parse_date(str(v)) for v in values)
        else:
            params.extend(_coerce(v, duck_type) for v in values)
        clauses = []
        if values:
            clauses.append(f"{expr} IN ({', '.join('?' * len(values))})")
        if len(values) < len(c.values):
            clauses.append(f"{column} IS NULL")
        return "(" + " OR ".join(clauses) + ")"


class DashboardQueries:
    """Runs dashboard tile queries through the SQL editor's engine, with a version-keyed cache."""

    def __init__(self, catalog: Catalog, queries: QueryStore, runner: QueryRunner) -> None:
        self.catalog = catalog
        self.queries = queries
        self.runner = runner
        self.cache = _ResultCache(CACHE_ENTRIES)

    def columns(self, source: Source) -> list[dict[str, str]]:
        def work(cur: duckdb.DuckDBPyConnection) -> list[dict[str, str]]:
            resolved = self._resolve(cur, source)
            return [{"name": n, "type": t} for n, t in resolved.columns.items()]

        return self.runner.run_read(uuid.uuid4().hex, work)

    def run(self, request: TileQuery) -> dict[str, Any]:
        started = time.perf_counter()
        query_id = request.query_id or uuid.uuid4().hex

        def work(cur: duckdb.DuckDBPyConnection) -> dict[str, Any]:
            source = self._resolve(cur, request.source)
            query = _Query(source, request.conditions)
            fetch = _Fetcher(self, cur, source, request.force)
            match request.type:
                case "kpi":
                    result = self._kpi(query, request, fetch)
                case "table":
                    result = self._table(query, request.config, fetch)
                case _:
                    result = self._chart(query, request.config, fetch)
            return {**result, "cached": fetch.all_cached}

        result = self.runner.run_read(query_id, work)
        return {**result, "elapsed_ms": int((time.perf_counter() - started) * 1000)}

    def options(self, request: OptionsQuery) -> dict[str, Any]:
        def work(cur: duckdb.DuckDBPyConnection) -> dict[str, Any]:
            source = self._resolve(cur, request.source)
            query = _Query(source, [])
            column = query.column(request.column)
            duck_type = source.columns[request.column]
            fetch = _Fetcher(self, cur, source, False)
            if is_temporal(duck_type) or is_numeric(duck_type):
                data = fetch.fetch(
                    f"SELECT min({column}) AS minimum, max({column}) AS maximum FROM {source.ref}",
                    [],
                )
                rows = table_to_json(data.table, data.columns)["rows"][0]
                return {"kind": "range", "type": duck_type, "minimum": rows[0], "maximum": rows[1]}
            sql = f"SELECT DISTINCT {column} AS value FROM {source.ref} WHERE {column} IS NOT NULL"
            params: list[Any] = []
            if request.search:
                escaped = (
                    request.search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                )
                sql += f" AND CAST({column} AS VARCHAR) ILIKE ? ESCAPE '\\'"
                params.append(f"%{escaped}%")
            sql += f" ORDER BY 1 LIMIT {request.limit + 1}"
            data = fetch.fetch(sql, params)
            values = [row[0] for row in table_to_json(data.table, data.columns)["rows"]]
            return {
                "kind": "values",
                "type": duck_type,
                "values": values[: request.limit],
                "truncated": len(values) > request.limit,
            }

        return self.runner.run_read(request.query_id or uuid.uuid4().hex, work)

    def _resolve(self, cur: duckdb.DuckDBPyConnection, source: Source) -> _Source:
        if source.kind == "table":
            schema, _, name = (source.table or "").partition(".")
            info = self.catalog.get_table(schema, name)
            ref = f"{quote_ident(schema)}.{quote_ident(name)}"
            rel = cur.sql(f"SELECT * FROM {ref}")
            token: list[Any] = [info.location, info.version, info.updated_at]
        else:
            if source.query_id is None:
                raise InvalidInputError("Choose a saved query")
            saved = self.queries.get_saved(source.query_id)
            statements = parse_statements(saved.sql)
            if len(statements) != 1 or not statements[0].is_select:
                raise InvalidInputError(
                    f"Saved query '{saved.name}' must be a single SELECT to be used in a dashboard"
                )
            rel = cur.sql(statements[0].sql)
            rel.create_view(QUERY_VIEW)
            ref = QUERY_VIEW
            versions = [[t.location, t.version, t.updated_at] for t in self.catalog.list_tables()]
            token = [saved.sql, versions]
        columns = dict(zip(rel.columns, (str(t) for t in rel.types), strict=True))
        return _Source(ref, columns, token)

    def _chart(self, q: _Query, config: TileConfig, fetch: "_Fetcher") -> dict[str, Any]:
        kind = config.chart
        if config.dimension is None:
            raise InvalidInputError("Choose a dimension")
        if not config.metrics:
            raise InvalidInputError("Add at least one metric")
        metrics = config.metrics
        breakdown = config.breakdown
        if kind in ("pie", "donut", "heatmap") and len(metrics) != 1:
            raise InvalidInputError("This chart type takes exactly one metric")
        if kind == "scatter" and len(metrics) != 2:
            raise InvalidInputError("A scatter chart needs two metrics (X and Y)")
        if kind == "heatmap" and breakdown is None:
            raise InvalidInputError("A heatmap needs a breakdown for its second axis")
        if breakdown is not None and (
            kind in ("pie", "donut", "scatter", "combo") or len(metrics) != 1
        ):
            raise InvalidInputError(
                "A breakdown works with a single metric on bar, line or area charts"
            )
        dim = q.dimension(config.dimension)
        exprs = [q.metric(m) for m in metrics]
        default_limit = (
            SCATTER_LIMIT
            if kind == "scatter"
            else TIME_LIMIT
            if config.dimension.grain
            else DEFAULT_LIMIT
        )
        limit = config.limit or default_limit
        order = _order(config.sort, config.dimension, len(metrics), "_d", "_m{}")
        if breakdown is None:
            projection = ", ".join(f"{e} AS _m{i}" for i, e in enumerate(exprs))
            sql = (
                f"SELECT {dim} AS _d, {projection} FROM {q.source.ref}{q.where} "
                f"GROUP BY 1 ORDER BY {order} LIMIT {limit + 1}"
            )
            data = fetch.fetch(sql, q.params)
            truncated = data.table.num_rows > limit
            return {
                **_json(data.table.slice(0, limit), data.columns),
                "truncated": truncated,
                "series_truncated": False,
            }
        cap = HEATMAP_SERIES_CAP if kind == "heatmap" else SERIES_CAP
        series = q.dimension(breakdown)
        table_order = _order(config.sort, config.dimension, 1, "__cb_d", "__cb_m{}")
        sql = (
            f"WITH base AS NOT MATERIALIZED (SELECT * FROM {q.source.ref}{q.where}), "
            f"top_d AS (SELECT __cb_d, row_number() OVER (ORDER BY {table_order}) "
            f"AS __cb_dr FROM (SELECT {dim} AS __cb_d, {exprs[0]} AS __cb_m0 FROM base GROUP BY 1) "
            f"ORDER BY __cb_dr LIMIT {limit + 1}), "
            f"top_b AS (SELECT __cb_b, "
            f"row_number() OVER (ORDER BY __cb_v DESC NULLS LAST, __cb_b) AS __cb_br "
            f"FROM (SELECT {series} AS __cb_b, {exprs[0]} AS __cb_v FROM base GROUP BY 1) "
            f"ORDER BY __cb_br LIMIT {cap + 1}) "
            f"SELECT t.__cb_d AS _d, u.__cb_b AS _b, {exprs[0]} AS _m0, "
            f"t.__cb_dr AS _dr, u.__cb_br AS _br FROM base "
            f"JOIN top_d t ON {dim} IS NOT DISTINCT FROM t.__cb_d "
            f"JOIN top_b u ON {series} IS NOT DISTINCT FROM u.__cb_b "
            f"GROUP BY t.__cb_d, t.__cb_dr, u.__cb_b, u.__cb_br ORDER BY t.__cb_dr, u.__cb_br"
        )
        data = fetch.fetch(sql, q.params)
        table = data.table
        truncated = bool(table.num_rows) and pc.max(table.column("_dr")).as_py() > limit
        series_truncated = bool(table.num_rows) and pc.max(table.column("_br")).as_py() > cap
        keep = pc.and_(
            pc.less_equal(table.column("_dr"), limit), pc.less_equal(table.column("_br"), cap)
        )
        table = table.filter(keep).select(["_d", "_b", "_m0"])
        return {
            **_json(table, data.columns[:3]),
            "truncated": truncated,
            "series_truncated": series_truncated,
        }

    def _kpi(self, q: _Query, request: TileQuery, fetch: "_Fetcher") -> dict[str, Any]:
        config = request.config
        if not config.metrics:
            raise InvalidInputError("Add a metric")
        expr = q.metric(config.metrics[0])
        sql = f"SELECT {expr} AS _m0 FROM {q.source.ref}"
        data = fetch.fetch(sql + q.where, q.params)
        value = _scalar(data)
        comparison: dict[str, Any] | None = None
        note: str | None = None
        if config.compare is not None:
            shifted = _shift_conditions(
                request.conditions, config.compare.column, config.compare.mode
            )
            if shifted is None:
                note = "Pick a date range to compare with the previous period"
            else:
                before = _Query(q.source, shifted)
                previous = _scalar(fetch.fetch(sql + before.where, before.params))
                comparison = _comparison(value, previous, config.compare.mode)
        trend: dict[str, Any] | None = None
        if config.trend is not None:
            dim = q.dimension(config.trend)
            sql = (
                f"SELECT {dim} AS _d, {expr} AS _m0 FROM {q.source.ref}{q.where} "
                f"GROUP BY 1 ORDER BY _d DESC LIMIT {TREND_POINTS}"
            )
            series = fetch.fetch(sql, q.params)
            reversed_rows = series.table.take(pa.array(range(series.table.num_rows - 1, -1, -1)))
            trend = _json(reversed_rows, series.columns)
        return {
            "columns": data.columns,
            "rows": table_to_json(data.table, data.columns)["rows"],
            "comparison": comparison,
            "note": note,
            "trend": trend,
            "truncated": False,
        }

    def _table(self, q: _Query, config: TileConfig, fetch: "_Fetcher") -> dict[str, Any]:
        dims = [q.dimension(d) for d in config.dimensions]
        exprs = [q.metric(m) for m in config.metrics]
        if not dims and not exprs:
            raise InvalidInputError("Add at least one column")
        limit = min(config.limit or DEFAULT_LIMIT * 2, MAX_TABLE_ROWS)
        select = [f"{d} AS _c{i}" for i, d in enumerate(dims)] + [
            f"{e} AS _m{i}" for i, e in enumerate(exprs)
        ]
        sort = config.sort
        order = ""
        if sort is not None:
            names = (
                [f"_c{i}" for i in range(len(dims))]
                if sort.by == "dimension"
                else [f"_m{i}" for i in range(len(exprs))]
            )
            if sort.index < len(names):
                order = f" ORDER BY {names[sort.index]} {sort.direction.upper()} NULLS LAST"
        elif exprs:
            order = " ORDER BY _m0 DESC NULLS LAST"
        group = (
            f" GROUP BY {', '.join(str(i + 1) for i in range(len(dims)))}" if dims and exprs else ""
        )
        sql = (
            f"SELECT {', '.join(select)} FROM {q.source.ref}{q.where}{group}{order} "
            f"LIMIT {limit + 1}"
        )
        data = fetch.fetch(sql, q.params)
        return {
            **_json(data.table.slice(0, limit), data.columns),
            "truncated": data.table.num_rows > limit,
        }


class _Fetcher:
    def __init__(
        self, owner: DashboardQueries, cur: duckdb.DuckDBPyConnection, source: _Source, force: bool
    ) -> None:
        self.owner = owner
        self.cur = cur
        self.source = source
        self.force = force
        self.all_cached = True

    def fetch(self, sql: str, params: list[Any]) -> _Fetched:
        key = hashlib.sha1(
            json.dumps([sql, [repr(p) for p in params], self.source.token], default=str).encode()
        ).hexdigest()
        if not self.force:
            hit = self.owner.cache.get(key)
            if hit is not None:
                return hit
        self.all_cached = False
        rel = self.cur.sql(sql, params=params)
        fetched = _Fetched(rel.to_arrow_table(), relation_columns(rel))
        self.owner.cache.put(key, fetched)
        return fetched


def _order(
    sort: Sort | None, dimension: FieldRef, metrics: int, dim_name: str, metric_name: str
) -> str:
    if sort is None:
        sort = (
            Sort(by="dimension", direction="asc")
            if dimension.grain
            else Sort(by="metric", index=0, direction="desc")
        )
    direction = sort.direction.upper()
    if sort.by == "dimension":
        return f"{dim_name} {direction} NULLS LAST"
    if sort.index >= metrics:
        raise InvalidInputError("Sort refers to a metric that does not exist")
    metric = metric_name.format(sort.index)
    return f"{metric} {direction} NULLS LAST, {dim_name} ASC NULLS LAST"


def _json(table: pa.Table, columns: list[dict[str, str]]) -> dict[str, Any]:
    return table_to_json(table, columns)


def _scalar(data: _Fetched) -> float | None:
    if data.table.num_rows == 0:
        return None
    value = data.table.column(0)[0].as_py()
    return None if value is None else float(value) if isinstance(value, (int, float)) else value


def _parse_date(value: str) -> date:
    return date.fromisoformat(value[:10])


def _coerce(value: Any, duck_type: str) -> Any:
    if duck_type.startswith(INTEGER_PREFIXES):
        return int(value)
    if is_numeric(duck_type):
        return float(value)
    if duck_type == "BOOLEAN":
        return value if isinstance(value, bool) else str(value).lower() == "true"
    if duck_type == "DATE":
        return _parse_date(str(value))
    if is_temporal(duck_type):
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return (
            parsed
            if "TIME ZONE" in duck_type or duck_type.endswith("TZ")
            else parsed.replace(tzinfo=None)
        )
    return str(value) if not isinstance(value, str) else value


def _shift_conditions(
    conditions: list[Condition], column: str, mode: str
) -> list[Condition] | None:
    """Moves the active date range on `column` to the comparison period; None if there is none."""
    shifted: list[Condition] = []
    found = False
    for condition in conditions:
        if condition.kind == "date_range" and condition.column == column:
            if not condition.start or not condition.end:
                return None
            start, end = _parse_date(condition.start), _parse_date(condition.end)
            if mode == "previous_year":
                new_start, new_end = _years_back(start), _years_back(end)
            else:
                length = (end - start).days + 1
                new_end = start - timedelta(days=1)
                new_start = new_end - timedelta(days=length - 1)
            shifted.append(
                condition.model_copy(
                    update={"start": new_start.isoformat(), "end": new_end.isoformat()}
                )
            )
            found = True
        else:
            shifted.append(condition)
    return shifted if found else None


def _years_back(value: date) -> date:
    day = min(value.day, calendar.monthrange(value.year - 1, value.month)[1])
    return value.replace(year=value.year - 1, day=day)


def _comparison(current: Any, previous: Any, mode: str) -> dict[str, Any]:
    change = None
    if isinstance(current, (int, float)) and isinstance(previous, (int, float)):
        change = current - previous
    percent = change / abs(previous) if change is not None and previous else None
    return {
        "previous": previous,
        "change": change,
        "percent": percent,
        "label": "vs previous year" if mode == "previous_year" else "vs previous period",
    }
