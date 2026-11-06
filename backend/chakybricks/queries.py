import sqlite3
from dataclasses import asdict, dataclass
from typing import Any

from chakybricks.catalog import Catalog, now_iso
from chakybricks.errors import ConflictError, InvalidInputError, NotFoundError

MAX_HISTORY = 500
MAX_NAME_LENGTH = 120


@dataclass(frozen=True)
class SavedQuery:
    id: int
    name: str
    sql: str
    description: str
    created_at: str
    updated_at: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class QueryStore:
    def __init__(self, catalog: Catalog) -> None:
        self.catalog = catalog

    def list_saved(self) -> list[SavedQuery]:
        with self.catalog.connect() as conn:
            rows = conn.execute("SELECT * FROM saved_queries ORDER BY name COLLATE NOCASE")
            return [SavedQuery(**dict(r)) for r in rows]

    def get_saved(self, query_id: int) -> SavedQuery:
        with self.catalog.connect() as conn:
            row = conn.execute("SELECT * FROM saved_queries WHERE id = ?", (query_id,)).fetchone()
        if row is None:
            raise NotFoundError(f"Saved query {query_id} does not exist")
        return SavedQuery(**dict(row))

    def create_saved(self, name: str, sql: str, description: str = "") -> SavedQuery:
        name = _clean_name(name)
        timestamp = now_iso()
        try:
            with self.catalog.connect() as conn:
                cursor = conn.execute(
                    "INSERT INTO saved_queries (name, sql, description, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (name, sql, description, timestamp, timestamp),
                )
                query_id = int(cursor.lastrowid or 0)
        except sqlite3.IntegrityError as exc:
            raise ConflictError(f"A saved query named '{name}' already exists") from exc
        return self.get_saved(query_id)

    def update_saved(
        self,
        query_id: int,
        *,
        name: str | None = None,
        sql: str | None = None,
        description: str | None = None,
    ) -> SavedQuery:
        current = self.get_saved(query_id)
        try:
            with self.catalog.connect() as conn:
                conn.execute(
                    "UPDATE saved_queries SET name = ?, sql = ?, description = ?, updated_at = ? "
                    "WHERE id = ?",
                    (
                        _clean_name(name) if name is not None else current.name,
                        sql if sql is not None else current.sql,
                        description if description is not None else current.description,
                        now_iso(),
                        query_id,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise ConflictError(f"A saved query named '{name}' already exists") from exc
        return self.get_saved(query_id)

    def delete_saved(self, query_id: int) -> None:
        self.get_saved(query_id)
        with self.catalog.connect() as conn:
            conn.execute("DELETE FROM saved_queries WHERE id = ?", (query_id,))

    def record_run(
        self,
        sql: str,
        started_at: str,
        duration_ms: int,
        status: str,
        row_count: int | None = None,
        error: str | None = None,
    ) -> None:
        with self.catalog.connect() as conn:
            conn.execute(
                "INSERT INTO query_history "
                "(sql, started_at, duration_ms, status, row_count, error) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (sql, started_at, duration_ms, status, row_count, error),
            )
            conn.execute(
                "DELETE FROM query_history WHERE id <= "
                "(SELECT id FROM query_history ORDER BY id DESC LIMIT 1 OFFSET ?)",
                (MAX_HISTORY,),
            )

    def history(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.catalog.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM query_history ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    def clear_history(self) -> None:
        with self.catalog.connect() as conn:
            conn.execute("DELETE FROM query_history")


def _clean_name(name: str) -> str:
    cleaned = " ".join(name.split())
    if not cleaned:
        raise InvalidInputError("Enter a name for the query")
    if len(cleaned) > MAX_NAME_LENGTH:
        raise InvalidInputError(f"Query names are limited to {MAX_NAME_LENGTH} characters")
    return cleaned
