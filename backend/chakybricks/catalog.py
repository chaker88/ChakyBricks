import json
import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from chakybricks.errors import ConflictError, InvalidInputError, NotFoundError

DEFAULT_SCHEMA = "main"
IDENTIFIER_RE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")
RESERVED_SCHEMAS = {"temp", "information_schema", "pg_catalog", "system"}

MIGRATIONS = [
    """
    CREATE TABLE schemas (
        name TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
    );
    CREATE TABLE tables (
        schema_name TEXT NOT NULL REFERENCES schemas(name) ON UPDATE CASCADE,
        name TEXT NOT NULL,
        location TEXT NOT NULL,
        source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL,
        row_count INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        columns TEXT NOT NULL,
        PRIMARY KEY (schema_name, name)
    );
    """,
]


@dataclass(frozen=True)
class Column:
    name: str
    type: str


@dataclass(frozen=True)
class TableStats:
    version: int
    row_count: int
    size_bytes: int
    columns: list[Column]


@dataclass(frozen=True)
class TableInfo:
    schema: str
    name: str
    location: str
    source: str | None
    created_at: str
    updated_at: str
    version: int
    row_count: int
    size_bytes: int
    columns: list[Column] = field(default_factory=list)

    @property
    def full_name(self) -> str:
        return f"{self.schema}.{self.name}"


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def normalize_identifier(value: str, kind: str = "name") -> str:
    name = value.strip().lower()
    if not IDENTIFIER_RE.match(name) or name.startswith("__"):
        raise InvalidInputError(
            f"Invalid {kind} '{value}': use lowercase letters, digits and underscores, "
            "starting with a letter or underscore"
        )
    return name


def normalize_schema(value: str) -> str:
    name = normalize_identifier(value, "schema name")
    if name in RESERVED_SCHEMAS:
        raise InvalidInputError(f"'{name}' is a reserved schema name")
    return name


def parse_full_name(full_name: str) -> tuple[str, str]:
    parts = full_name.split(".")
    if len(parts) == 1:
        return DEFAULT_SCHEMA, normalize_identifier(parts[0], "table name")
    if len(parts) == 2:
        return normalize_schema(parts[0]), normalize_identifier(parts[1], "table name")
    raise InvalidInputError(f"Invalid table name '{full_name}': expected schema.table")


class Catalog:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._migrate()
        self.ensure_schema(DEFAULT_SCHEMA)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _migrate(self) -> None:
        with self._connect() as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            for index, script in enumerate(MIGRATIONS[version:], start=version + 1):
                conn.executescript(script)
                conn.execute(f"PRAGMA user_version = {index}")

    def list_schemas(self) -> list[str]:
        with self._connect() as conn:
            return [r["name"] for r in conn.execute("SELECT name FROM schemas ORDER BY name")]

    def ensure_schema(self, name: str) -> str:
        name = normalize_schema(name)
        with self._connect() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO schemas (name, created_at) VALUES (?, ?)", (name, now_iso())
            )
        return name

    def create_schema(self, name: str) -> str:
        name = normalize_schema(name)
        if name in self.list_schemas():
            raise ConflictError(f"Schema '{name}' already exists")
        return self.ensure_schema(name)

    def drop_schema(self, name: str) -> None:
        if name == DEFAULT_SCHEMA:
            raise InvalidInputError("The main schema cannot be dropped")
        if name not in self.list_schemas():
            raise NotFoundError(f"Schema '{name}' does not exist")
        if self.list_tables(name):
            raise ConflictError(f"Schema '{name}' is not empty")
        with self._connect() as conn:
            conn.execute("DELETE FROM schemas WHERE name = ?", (name,))

    def list_tables(self, schema: str | None = None) -> list[TableInfo]:
        query = "SELECT * FROM tables"
        params: tuple[str, ...] = ()
        if schema is not None:
            query += " WHERE schema_name = ?"
            params = (schema,)
        with self._connect() as conn:
            rows = conn.execute(query + " ORDER BY schema_name, name", params).fetchall()
        return [_row_to_table(r) for r in rows]

    def find_table(self, schema: str, name: str) -> TableInfo | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM tables WHERE schema_name = ? AND name = ?", (schema, name)
            ).fetchone()
        return _row_to_table(row) if row else None

    def get_table(self, schema: str, name: str) -> TableInfo:
        table = self.find_table(schema, name)
        if table is None:
            raise NotFoundError(f"Table '{schema}.{name}' does not exist")
        return table

    def upsert_table(
        self, schema: str, name: str, location: str, stats: TableStats, source: str | None = None
    ) -> TableInfo:
        self.ensure_schema(schema)
        timestamp = now_iso()
        columns = json.dumps([{"name": c.name, "type": c.type} for c in stats.columns])
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO tables (schema_name, name, location, source, created_at, updated_at,
                                    version, row_count, size_bytes, columns)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (schema_name, name) DO UPDATE SET
                    location = excluded.location,
                    source = COALESCE(excluded.source, tables.source),
                    updated_at = excluded.updated_at,
                    version = excluded.version,
                    row_count = excluded.row_count,
                    size_bytes = excluded.size_bytes,
                    columns = excluded.columns
                """,
                (
                    schema,
                    name,
                    location,
                    source,
                    timestamp,
                    timestamp,
                    stats.version,
                    stats.row_count,
                    stats.size_bytes,
                    columns,
                ),
            )
        return self.get_table(schema, name)

    def rename_table(
        self, schema: str, name: str, new_schema: str, new_name: str, new_location: str
    ) -> TableInfo:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE tables SET schema_name = ?, name = ?, location = ?, updated_at = ?
                WHERE schema_name = ? AND name = ?
                """,
                (new_schema, new_name, new_location, now_iso(), schema, name),
            )
        return self.get_table(new_schema, new_name)

    def delete_table(self, schema: str, name: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM tables WHERE schema_name = ? AND name = ?", (schema, name))


def _row_to_table(row: sqlite3.Row) -> TableInfo:
    return TableInfo(
        schema=row["schema_name"],
        name=row["name"],
        location=row["location"],
        source=row["source"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        version=row["version"],
        row_count=row["row_count"],
        size_bytes=row["size_bytes"],
        columns=[Column(**c) for c in json.loads(row["columns"])],
    )
