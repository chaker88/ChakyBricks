import base64
import datetime as dt
import math
import uuid
from decimal import Decimal
from typing import Any

import duckdb


def jsonable(value: Any) -> Any:
    if value is None or isinstance(value, bool | int | str):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, Decimal):
        return float(value) if value.is_finite() else None
    if isinstance(value, dt.datetime | dt.date | dt.time):
        return value.isoformat()
    if isinstance(value, dt.timedelta):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, bytes | bytearray | memoryview):
        return base64.b64encode(bytes(value)).decode("ascii")
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [jsonable(v) for v in value]
    return str(value)


def relation_to_json(rel: duckdb.DuckDBPyRelation) -> dict[str, Any]:
    columns = [{"name": n, "type": str(t)} for n, t in zip(rel.columns, rel.types, strict=True)]
    rows = [[jsonable(v) for v in row] for row in rel.fetchall()]
    return {"columns": columns, "rows": rows}
