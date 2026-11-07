import os
import threading
from pathlib import Path

from chakybricks.catalog import Catalog
from chakybricks.config import Settings, SettingsStore
from chakybricks.engine import Engine
from chakybricks.errors import ConflictError, InvalidInputError
from chakybricks.ingest.jobs import ImportManager
from chakybricks.kernel_env import VENV_ENV, KernelEnvironment
from chakybricks.kernels import KernelRegistry
from chakybricks.notebooks import NotebookStore
from chakybricks.packages import PackageManager
from chakybricks.queries import QueryStore
from chakybricks.sql import QueryRunner
from chakybricks.workspace import Workspace
from chakybricks.writes import SqlWriter

KERNEL_VENV_DIR = ".venv"


class Services:
    def __init__(self, home: Path) -> None:
        self.store = SettingsStore(home)
        self.settings = self.store.load()
        self._lock = threading.Lock()
        self._open()

    def _open(self) -> None:
        self.workspace = Workspace(self.settings.workspace).ensure()
        self.catalog = Catalog(self.workspace.meta_db)
        self.engine = Engine(self.catalog, self.workspace, self.settings)
        self.imports = ImportManager(self.workspace, self.catalog, self.engine)
        self.queries = QueryStore(self.catalog)
        self.notebooks = NotebookStore(self.workspace.notebooks)
        venv = os.environ.get(VENV_ENV)
        self.kernel_env = KernelEnvironment(
            Path(venv) if venv else self.workspace.root / KERNEL_VENV_DIR
        )
        self.kernels = KernelRegistry(self.workspace, lambda: self.settings, self.kernel_env)
        self.packages = PackageManager(self.kernel_env, before_reset=self.kernels.shutdown_all)
        self.sql = QueryRunner(self.engine, self.queries, lambda: self.settings, SqlWriter(self))

    def update_settings(self, changes: dict[str, object]) -> Settings:
        with self._lock:
            updated = Settings.model_validate({**self.settings.model_dump(), **changes})
            workspace_changed = updated.workspace.resolve() != self.workspace.root
            if workspace_changed:
                if any(not job.done for job in self.imports.list()):
                    raise ConflictError("Wait for running imports to finish first")
                try:
                    Workspace(updated.workspace).ensure()
                except OSError as exc:
                    raise InvalidInputError(f"Cannot use workspace folder: {exc}") from exc
            self.store.save(updated)
            self.settings = updated
            if workspace_changed:
                self.close()
                self._open()
            else:
                self.engine.apply_settings(updated)
            return updated

    def close(self) -> None:
        self.kernels.shutdown_all()
        self.packages.shutdown()
        self.imports.shutdown()
        self.engine.close()
