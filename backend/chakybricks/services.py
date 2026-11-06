import threading
from pathlib import Path

from chakybricks.catalog import Catalog
from chakybricks.config import Settings, SettingsStore
from chakybricks.engine import Engine
from chakybricks.errors import ConflictError, InvalidInputError
from chakybricks.ingest.jobs import ImportManager
from chakybricks.workspace import Workspace


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
        self.imports.shutdown()
        self.engine.close()
