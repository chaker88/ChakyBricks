import keyword
import re
import unicodedata
from enum import StrEnum
from functools import cache
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from pydantic import BaseModel

from chakybricks.engine import quote_ident, quote_literal
from chakybricks.errors import InvalidInputError
from chakybricks.serialization import relation_to_json

PREVIEW_ROWS = 100
EXCEL_MAX_BYTES = 50 * 1024 * 1024
ESTIMATE_SAMPLE_BYTES = 4 * 1024 * 1024


class SourceFormat(StrEnum):
    CSV = "csv"
    TSV = "tsv"
    PARQUET = "parquet"
    JSON = "json"
    EXCEL = "excel"


EXTENSIONS = {
    ".csv": SourceFormat.CSV,
    ".txt": SourceFormat.CSV,
    ".tsv": SourceFormat.TSV,
    ".tab": SourceFormat.TSV,
    ".parquet": SourceFormat.PARQUET,
    ".pq": SourceFormat.PARQUET,
    ".json": SourceFormat.JSON,
    ".ndjson": SourceFormat.JSON,
    ".jsonl": SourceFormat.JSON,
    ".xlsx": SourceFormat.EXCEL,
}

EDITABLE_TYPES = [
    "VARCHAR",
    "BOOLEAN",
    "INTEGER",
    "BIGINT",
    "DOUBLE",
    "DECIMAL(18,2)",
    "DATE",
    "TIMESTAMP",
    "TIMESTAMP WITH TIME ZONE",
]
_ALLOWED_TYPE_RE = re.compile(
    r"^(VARCHAR|BOOLEAN|TINYINT|SMALLINT|INTEGER|BIGINT|FLOAT|DOUBLE|DATE|TIMESTAMP"
    r"|TIMESTAMP WITH TIME ZONE|DECIMAL\((\d{1,2}),(\d{1,2})\))$"
)
_STORAGE_TYPE_FIXES = {
    "UTINYINT": "SMALLINT",
    "USMALLINT": "INTEGER",
    "UINTEGER": "BIGINT",
    "UBIGINT": "DECIMAL(20,0)",
    "HUGEINT": "DECIMAL(38,0)",
    "UHUGEINT": "DECIMAL(38,0)",
    "TIMESTAMP_S": "TIMESTAMP",
    "TIMESTAMP_MS": "TIMESTAMP",
    "TIMESTAMP_NS": "TIMESTAMP",
    "TIME": "VARCHAR",
    "TIME WITH TIME ZONE": "VARCHAR",
    "UUID": "VARCHAR",
    "INTERVAL": "VARCHAR",
    "JSON": "VARCHAR",
    "BIT": "VARCHAR",
}
_UNDERSCORES_RE = re.compile(r"_+")
MAX_COLUMN_NAME = 128


class SourceOptions(BaseModel):
    delimiter: str | None = None
    header: bool = True
    sheet: str | None = None


class ColumnSpec(BaseModel):
    source: str
    name: str
    type: str


def detect_format(path: Path) -> SourceFormat:
    fmt = EXTENSIONS.get(path.suffix.lower())
    if fmt is None:
        supported = ", ".join(sorted(EXTENSIONS))
        raise InvalidInputError(f"Unsupported file type '{path.suffix}'. Supported: {supported}")
    return fmt


def resolve_source(path: str) -> Path:
    resolved = Path(path).expanduser()
    if not resolved.is_file():
        raise InvalidInputError(f"File not found: {path}")
    return resolved.resolve()


def suggest_table_name(path: Path) -> str:
    name = re.sub(r"[^a-z0-9_]+", "_", path.stem.lower()).strip("_") or "imported"
    return f"t_{name}"[:63] if name[0].isdigit() else name[:63]


def _is_name_start(ch: str) -> bool:
    return ch == "_" or unicodedata.category(ch).startswith("L")


def _is_name_char(ch: str) -> bool:
    return _is_name_start(ch) or unicodedata.category(ch) in ("Mn", "Mc", "Nd")


@cache
def _sql_reserved_words() -> frozenset[str]:
    with duckdb.connect() as con:
        rows = con.sql(
            "SELECT keyword_name FROM duckdb_keywords() WHERE keyword_category = 'reserved'"
        ).fetchall()
    return frozenset(str(r[0]).lower() for r in rows)


def is_reserved_word(name: str) -> bool:
    return name.lower() in _sql_reserved_words() or keyword.iskeyword(name)


def column_name_error(name: str) -> str | None:
    if not name or len(name) > MAX_COLUMN_NAME:
        return f"Column names must be 1 to {MAX_COLUMN_NAME} characters"
    if not _is_name_start(name[0]) or not all(_is_name_char(ch) for ch in name):
        return (
            f"Invalid column name '{name}': use letters, digits and underscores, "
            "starting with a letter or underscore"
        )
    if is_reserved_word(name):
        return f"'{name}' is a reserved word in SQL or Python; try 'c_{name.lower()}'"
    return None


def sanitize_column_names(names: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for index, raw in enumerate(names, start=1):
        normalized = unicodedata.normalize("NFKC", raw).lower()
        cleaned = "".join(ch if _is_name_char(ch) else "_" for ch in normalized)
        name = _UNDERSCORES_RE.sub("_", cleaned).strip("_") or f"column_{index}"
        if not _is_name_start(name[0]) or is_reserved_word(name):
            name = f"c_{name}"
        name = name[: MAX_COLUMN_NAME - 8]
        candidate, n = name, 2
        while candidate in seen:
            candidate, n = f"{name}_{n}", n + 1
        seen.add(candidate)
        result.append(candidate)
    return result


def storage_type(duck_type: str) -> str:
    if duck_type.startswith("ENUM("):
        return "VARCHAR"
    return _STORAGE_TYPE_FIXES.get(duck_type, duck_type)


def open_source(
    con: duckdb.DuckDBPyConnection, path: Path, fmt: SourceFormat, options: SourceOptions
) -> duckdb.DuckDBPyRelation:
    source = quote_literal(path.as_posix())
    try:
        if fmt in (SourceFormat.CSV, SourceFormat.TSV):
            args = [source, f"header = {str(options.header).lower()}"]
            delimiter = options.delimiter or ("\t" if fmt == SourceFormat.TSV else None)
            if delimiter:
                args.append(f"delim = {quote_literal(delimiter)}")
            return con.sql(f"SELECT * FROM read_csv({', '.join(args)})")
        if fmt == SourceFormat.PARQUET:
            return con.sql(f"SELECT * FROM read_parquet({source})")
        if fmt == SourceFormat.JSON:
            return con.sql(f"SELECT * FROM read_json({source})")
        return con.from_arrow(_read_excel(path, options))
    except duckdb.Error as exc:
        raise InvalidInputError(f"Could not read {path.name}: {exc}") from exc


def _read_excel(path: Path, options: SourceOptions) -> pa.Table:
    if path.stat().st_size > EXCEL_MAX_BYTES:
        raise InvalidInputError(
            "Excel import is limited to files under 50 MB; save the sheet as CSV for larger data"
        )
    frame = pd.read_excel(
        path, sheet_name=options.sheet or 0, header=0 if options.header else None, engine="openpyxl"
    )
    frame.columns = [str(c) for c in frame.columns]
    for column in frame.columns:
        if frame[column].dtype == object:
            frame[column] = frame[column].map(lambda v: None if pd.isna(v) else str(v))
    return pa.Table.from_pandas(frame, preserve_index=False)


def inferred_columns(rel: duckdb.DuckDBPyRelation) -> list[ColumnSpec]:
    names = sanitize_column_names(rel.columns)
    return [
        ColumnSpec(source=source, name=name, type=storage_type(str(t)))
        for source, name, t in zip(rel.columns, names, rel.types, strict=True)
    ]


def apply_columns(rel: duckdb.DuckDBPyRelation, specs: list[ColumnSpec]) -> duckdb.DuckDBPyRelation:
    if not specs:
        raise InvalidInputError("Select at least one column to import")
    raw_types = {name: str(t) for name, t in zip(rel.columns, rel.types, strict=True)}
    seen: set[str] = set()
    expressions = []
    for spec in specs:
        if spec.source not in raw_types:
            raise InvalidInputError(f"Column '{spec.source}' is not in the source file")
        if error := column_name_error(spec.name):
            raise InvalidInputError(error)
        if spec.name.lower() in seen:
            raise InvalidInputError(f"Duplicate column name '{spec.name}'")
        seen.add(spec.name.lower())
        raw = raw_types[spec.source]
        target = spec.type.strip()
        if target != storage_type(raw):
            target = target.upper().replace(", ", ",")
            if not _ALLOWED_TYPE_RE.match(target):
                raise InvalidInputError(f"Unsupported type '{spec.type}' for column '{spec.name}'")
        expression = quote_ident(spec.source)
        if target != raw:
            expression = f"CAST({expression} AS {target})"
        expressions.append(f"{expression} AS {quote_ident(spec.name)}")
    return rel.project(", ".join(expressions))


def estimate_rows(path: Path, fmt: SourceFormat, rel: duckdb.DuckDBPyRelation) -> int | None:
    if fmt == SourceFormat.PARQUET:
        return int(pq.ParquetFile(path).metadata.num_rows)
    if fmt == SourceFormat.EXCEL:
        return len(rel)
    size = path.stat().st_size
    with path.open("rb") as handle:
        sample = handle.read(ESTIMATE_SAMPLE_BYTES)
    lines = sample.count(b"\n")
    if lines == 0:
        return 1
    return max(1, int(size / (len(sample) / lines)))


def preview(
    con: duckdb.DuckDBPyConnection,
    path: Path,
    fmt: SourceFormat,
    options: SourceOptions,
    specs: list[ColumnSpec] | None,
) -> dict[str, Any]:
    rel = open_source(con, path, fmt, options)
    columns = inferred_columns(rel)
    try:
        sample = relation_to_json(apply_columns(rel, specs or columns).limit(PREVIEW_ROWS))
    except duckdb.Error as exc:
        raise InvalidInputError(f"Preview failed: {exc}") from exc
    return {
        "path": str(path),
        "format": fmt.value,
        "file_size": path.stat().st_size,
        "suggested_table": suggest_table_name(path),
        "estimated_rows": estimate_rows(path, fmt, rel),
        "source_columns": [c.model_dump() for c in columns],
        "editable_types": EDITABLE_TYPES,
        "sample": sample,
    }
