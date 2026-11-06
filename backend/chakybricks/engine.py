import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import duckdb
import pyarrow.dataset as pads

from chakybricks import delta
from chakybricks.catalog import Catalog, TableInfo
from chakybricks.config import Settings
from chakybricks.workspace import Workspace

log = logging.getLogger(__name__)


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def configure_connection(
    con: duckdb.DuckDBPyConnection, settings: Settings, tmp_dir: Path, *, bulk: bool = False
) -> None:
    con.execute(f"SET memory_limit = '{settings.effective_memory_limit_mb}MB'")
    con.execute(f"SET temp_directory = {quote_literal(tmp_dir.as_posix())}")
    con.execute("SET python_enable_replacements = false")
    if bulk:
        con.execute("SET preserve_insertion_order = false")
        con.execute("SET TimeZone = 'UTC'")


@dataclass(frozen=True)
class _Registration:
    token: tuple[str, int, str]
    name: str
    dataset: pads.Dataset


class Engine:
    """In-process DuckDB with one view per catalog table, each backed by a lazy Delta dataset."""

    def __init__(self, catalog: Catalog, workspace: Workspace, settings: Settings) -> None:
        self.catalog = catalog
        self.workspace = workspace
        self.settings = settings
        self._root = duckdb.connect()
        self._lock = threading.RLock()
        self._registrations: dict[tuple[str, str], _Registration] = {}
        configure_connection(self._root, settings, workspace.tmp)

    def apply_settings(self, settings: Settings) -> None:
        with self._lock:
            self.settings = settings
            configure_connection(self._root, settings, self.workspace.tmp)

    def sync(self) -> None:
        tables = {(t.schema, t.name): t for t in self.catalog.list_tables()}
        with self._lock:
            for key, registration in list(self._registrations.items()):
                table = tables.get(key)
                if table is None or _token(table) != registration.token:
                    self._drop(key, registration)
            for schema in self.catalog.list_schemas():
                self._root.execute(f"CREATE SCHEMA IF NOT EXISTS {quote_ident(schema)}")
            for key, table in tables.items():
                if key not in self._registrations:
                    self._register(table)

    @contextmanager
    def cursor(self) -> Iterator[duckdb.DuckDBPyConnection]:
        self.sync()
        with self._lock:
            registrations = list(self._registrations.values())
            cur = self._root.cursor()
        try:
            for registration in registrations:
                cur.register(registration.name, registration.dataset)
            yield cur
        finally:
            cur.close()

    def bulk_connection(self, *, with_catalog: bool = False) -> duckdb.DuckDBPyConnection:
        con = duckdb.connect()
        configure_connection(con, self.settings, self.workspace.tmp, bulk=True)
        if with_catalog:
            self.sync()
            with self._lock:
                registrations = dict(self._registrations)
            for schema in self.catalog.list_schemas():
                con.execute(f"CREATE SCHEMA IF NOT EXISTS {quote_ident(schema)}")
            for (schema, table), registration in registrations.items():
                con.register(registration.name, registration.dataset)
                view = f"{quote_ident(schema)}.{quote_ident(table)}"
                con.execute(f"CREATE VIEW {view} AS SELECT * FROM {quote_ident(registration.name)}")
        return con

    def close(self) -> None:
        with self._lock:
            self._root.close()

    def _register(self, table: TableInfo) -> None:
        name = f"__cb_{table.schema}__{table.name}"
        try:
            ds = delta.dataset(self.workspace.table_path(table.location))
        except Exception:
            log.exception("Could not open Delta table %s", table.full_name)
            return
        self._root.register(name, ds)
        view = f"{quote_ident(table.schema)}.{quote_ident(table.name)}"
        self._root.execute(f"CREATE OR REPLACE VIEW {view} AS SELECT * FROM {quote_ident(name)}")
        self._registrations[(table.schema, table.name)] = _Registration(_token(table), name, ds)

    def _drop(self, key: tuple[str, str], registration: _Registration) -> None:
        schema, name = key
        self._root.execute(f"DROP VIEW IF EXISTS {quote_ident(schema)}.{quote_ident(name)}")
        self._root.unregister(registration.name)
        del self._registrations[key]


def _token(table: TableInfo) -> tuple[str, int, str]:
    return (table.location, table.version, table.updated_at)
