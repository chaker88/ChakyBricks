import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from chakybricks.catalog import Catalog, now_iso
from chakybricks.dashboard_models import DashboardSpec
from chakybricks.errors import ConflictError, InvalidInputError, NotFoundError

MAX_NAME_LENGTH = 120


@dataclass(frozen=True)
class Dashboard:
    id: int
    name: str
    description: str
    spec: DashboardSpec
    created_at: str
    updated_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "spec": self.spec.model_dump(mode="json"),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "tile_count": len(self.spec.tiles),
            "filter_count": len(self.spec.filters),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class DashboardStore:
    def __init__(self, catalog: Catalog) -> None:
        self.catalog = catalog

    def list(self) -> list[Dashboard]:
        with self.catalog.connect() as conn:
            rows = conn.execute("SELECT * FROM dashboards ORDER BY updated_at DESC").fetchall()
        return [_from_row(r) for r in rows]

    def get(self, dashboard_id: int) -> Dashboard:
        with self.catalog.connect() as conn:
            row = conn.execute("SELECT * FROM dashboards WHERE id = ?", (dashboard_id,)).fetchone()
        if row is None:
            raise NotFoundError(f"Dashboard {dashboard_id} does not exist")
        return _from_row(row)

    def create(
        self, name: str, spec: DashboardSpec | None = None, description: str = ""
    ) -> Dashboard:
        name = _clean_name(name)
        timestamp = now_iso()
        try:
            with self.catalog.connect() as conn:
                cursor = conn.execute(
                    "INSERT INTO dashboards (name, description, spec, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (name, description, _dump(spec or DashboardSpec()), timestamp, timestamp),
                )
                dashboard_id = int(cursor.lastrowid or 0)
        except sqlite3.IntegrityError as exc:
            raise ConflictError(f"A dashboard named '{name}' already exists") from exc
        return self.get(dashboard_id)

    def update(
        self,
        dashboard_id: int,
        *,
        name: str | None = None,
        description: str | None = None,
        spec: DashboardSpec | None = None,
    ) -> Dashboard:
        current = self.get(dashboard_id)
        try:
            with self.catalog.connect() as conn:
                conn.execute(
                    "UPDATE dashboards SET name = ?, description = ?, spec = ?, updated_at = ? "
                    "WHERE id = ?",
                    (
                        _clean_name(name) if name is not None else current.name,
                        description if description is not None else current.description,
                        _dump(spec) if spec is not None else _dump(current.spec),
                        now_iso(),
                        dashboard_id,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise ConflictError(f"A dashboard named '{name}' already exists") from exc
        return self.get(dashboard_id)

    def duplicate(self, dashboard_id: int) -> Dashboard:
        source = self.get(dashboard_id)
        existing = {d.name.lower() for d in self.list()}
        base = f"{source.name} (copy)"
        name, counter = base, 2
        while name.lower() in existing:
            name = f"{base} {counter}"
            counter += 1
        return self.create(name, source.spec, source.description)

    def delete(self, dashboard_id: int) -> None:
        self.get(dashboard_id)
        with self.catalog.connect() as conn:
            conn.execute("DELETE FROM dashboards WHERE id = ?", (dashboard_id,))


def _dump(spec: DashboardSpec) -> str:
    ids = [t.id for t in spec.tiles] + [f.id for f in spec.filters]
    if len(ids) != len(set(ids)):
        raise InvalidInputError("Tile and filter ids must be unique")
    return spec.model_dump_json()


def _from_row(row: sqlite3.Row) -> Dashboard:
    return Dashboard(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        spec=DashboardSpec.model_validate(json.loads(row["spec"])),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _clean_name(name: str) -> str:
    cleaned = " ".join(name.split())
    if not cleaned:
        raise InvalidInputError("Enter a name for the dashboard")
    if len(cleaned) > MAX_NAME_LENGTH:
        raise InvalidInputError(f"Dashboard names are limited to {MAX_NAME_LENGTH} characters")
    return cleaned
