import datetime as dt
import math
import uuid
from collections.abc import Callable
from decimal import Decimal
from typing import Any

import duckdb
import pyarrow as pa
import pyarrow.compute as pc

MAX_SAFE_INTEGER = 2**53 - 1
_EPOCH = dt.datetime(1970, 1, 1)
_UNIT_DIGITS = {"s": 0, "ms": 3, "us": 6, "ns": 9}


def relation_to_json(rel: duckdb.DuckDBPyRelation) -> dict[str, Any]:
    """Serializes via Arrow so no Python type conversion (pytz, zoneinfo) is needed."""
    columns = [{"name": n, "type": str(t)} for n, t in zip(rel.columns, rel.types, strict=True)]
    table = rel.to_arrow_table()
    values = [column_values(table.column(i)) for i in range(table.num_columns)]
    rows = [list(row) for row in zip(*values, strict=True)] if values else []
    return {"columns": columns, "rows": rows}


def column_values(array: pa.Array | pa.ChunkedArray) -> list[Any]:
    if isinstance(array, pa.ChunkedArray):
        return [value for chunk in array.chunks for value in column_values(chunk)]
    kind = array.type
    if isinstance(kind, pa.ExtensionType):
        if kind.extension_name == "arrow.uuid":
            return _map(array.storage.to_pylist(), lambda b: str(uuid.UUID(bytes=b)))
        return column_values(array.storage)
    if pa.types.is_null(kind):
        return [None] * len(array)
    if pa.types.is_dictionary(kind):
        return column_values(array.dictionary_decode())
    if pa.types.is_timestamp(kind):
        return _timestamps(array)
    if pa.types.is_time(kind):
        return _times(array)
    if pa.types.is_date(kind):
        return _map(array.cast(pa.date32()).to_pylist(), lambda d: d.isoformat())
    if pa.types.is_duration(kind):
        return _durations(array)
    if pa.types.is_interval(kind):
        return _map(array.to_pylist(), _format_interval)
    if pa.types.is_decimal(kind):
        return _map(array.to_pylist(), _decimal)
    if pa.types.is_floating(kind):
        return _map(array.to_pylist(), _float)
    if pa.types.is_integer(kind):
        return _map(array.to_pylist(), _integer)
    if (
        pa.types.is_binary(kind)
        or pa.types.is_large_binary(kind)
        or pa.types.is_fixed_size_binary(kind)
        or pa.types.is_binary_view(kind)
    ):
        return _map(array.to_pylist(), _format_blob)
    if pa.types.is_map(kind):
        return _maps(array)
    if (
        pa.types.is_list(kind)
        or pa.types.is_large_list(kind)
        or pa.types.is_fixed_size_list(kind)
        or pa.types.is_list_view(kind)
        or pa.types.is_large_list_view(kind)
    ):
        return _lists(array)
    if pa.types.is_struct(kind):
        return _structs(array)
    if (
        pa.types.is_boolean(kind)
        or pa.types.is_string(kind)
        or pa.types.is_large_string(kind)
        or pa.types.is_string_view(kind)
    ):
        return list(array.to_pylist())
    return _map(array.to_pylist(), str)


def _map(values: list[Any], convert: Callable[[Any], Any]) -> list[Any]:
    return [None if v is None else convert(v) for v in values]


def _timestamps(array: pa.Array) -> list[str | None]:
    kind = array.type
    counts = array.cast(pa.timestamp(kind.unit)).cast(pa.int64()).to_pylist()
    suffix = "Z" if kind.tz else ""
    digits = _UNIT_DIGITS[kind.unit]

    def fmt(count: int) -> str:
        seconds, fraction = divmod(count, 10**digits)
        try:
            text = (_EPOCH + dt.timedelta(seconds=seconds)).isoformat()
        except OverflowError:
            return "infinity" if count > 0 else "-infinity"
        return text + _fraction(fraction, digits) + suffix

    return _map(counts, fmt)


def _times(array: pa.Array) -> list[str | None]:
    unit = array.type.unit
    digits = _UNIT_DIGITS[unit]
    counts = array.cast(pa.int64()).to_pylist()

    def fmt(count: int) -> str:
        seconds, fraction = divmod(count, 10**digits)
        minutes, second = divmod(seconds, 60)
        hour, minute = divmod(minutes, 60)
        return f"{hour:02d}:{minute:02d}:{second:02d}" + _fraction(fraction, digits)

    return _map(counts, fmt)


def _durations(array: pa.Array) -> list[str | None]:
    digits = _UNIT_DIGITS[array.type.unit]
    counts = array.cast(pa.int64()).to_pylist()
    return _map(counts, lambda c: _format_clock(c * 10 ** (9 - digits)))


def _fraction(value: int, digits: int) -> str:
    if digits == 0 or value == 0:
        return ""
    return "." + f"{value:0{digits}d}".rstrip("0")


def _format_clock(nanoseconds: int) -> str:
    sign = "-" if nanoseconds < 0 else ""
    seconds, fraction = divmod(abs(nanoseconds), 10**9)
    minutes, second = divmod(seconds, 60)
    hours, minute = divmod(minutes, 60)
    return f"{sign}{hours:02d}:{minute:02d}:{second:02d}" + _fraction(fraction, 9)


def _format_interval(value: Any) -> str:
    months, days, nanoseconds = value.months, value.days, value.nanoseconds
    years, months = divmod(months, 12) if months >= 0 else (-((-months) // 12), -((-months) % 12))
    parts = [
        f"{n} {unit}{'' if abs(n) == 1 else 's'}"
        for n, unit in ((years, "year"), (months, "month"), (days, "day"))
        if n
    ]
    if nanoseconds or not parts:
        parts.append(_format_clock(nanoseconds))
    return " ".join(parts)


def _decimal(value: Decimal) -> float | str:
    if not value.is_finite():
        return str(value)
    as_float = float(value)
    return as_float if Decimal(repr(as_float)) == value else str(value)


def _float(value: float) -> float | str:
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    return value


def _integer(value: int) -> int | str:
    return value if abs(value) <= MAX_SAFE_INTEGER else str(value)


def _format_blob(value: bytes) -> str:
    return "".join(chr(b) if 32 <= b < 127 and b != 92 else f"\\x{b:02X}" for b in value)


def _lists(array: pa.Array) -> list[Any]:
    lengths = pc.list_value_length(array).to_pylist()
    flat = column_values(array.flatten())
    result: list[Any] = []
    position = 0
    for length in lengths:
        if length is None:
            result.append(None)
        else:
            result.append(flat[position : position + length])
            position += length
    return result


def _maps(array: pa.Array) -> list[Any]:
    offsets = array.offsets.to_pylist()
    nulls = array.is_null().to_pylist()
    key_array, item_array = array.values.flatten()
    keys = column_values(key_array)
    items = column_values(item_array)
    result: list[Any] = []
    for i in range(len(array)):
        if nulls[i]:
            result.append(None)
            continue
        start, end = offsets[i], offsets[i + 1]
        pairs = list(zip(keys[start:end], items[start:end], strict=True))
        if all(isinstance(k, str) for k, _ in pairs):
            result.append(dict(pairs))
        else:
            result.append([[k, v] for k, v in pairs])
    return result


def _structs(array: pa.Array) -> list[Any]:
    names = [array.type.field(i).name for i in range(array.type.num_fields)]
    fields = [column_values(child) for child in array.flatten()]
    nulls = array.is_null().to_pylist()
    return [
        None if nulls[i] else {name: values[i] for name, values in zip(names, fields, strict=True)}
        for i in range(len(array))
    ]
