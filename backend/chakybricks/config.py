import json
import os
from pathlib import Path

import psutil
from pydantic import BaseModel, Field

HOME_ENV = "CHAKYBRICKS_HOME"
DEFAULT_MEMORY_FRACTION = 0.6
MIN_MEMORY_LIMIT_MB = 256


def app_home() -> Path:
    override = os.environ.get(HOME_ENV)
    if override:
        return Path(override)
    appdata = os.environ.get("APPDATA")
    base = Path(appdata) if appdata else Path.home() / ".config"
    return base / "ChakyBricks"


def total_memory_mb() -> int:
    return int(psutil.virtual_memory().total // (1024 * 1024))


def default_memory_limit_mb() -> int:
    return max(MIN_MEMORY_LIMIT_MB, int(total_memory_mb() * DEFAULT_MEMORY_FRACTION))


class Settings(BaseModel):
    workspace: Path
    memory_limit_mb: int | None = Field(default=None, ge=MIN_MEMORY_LIMIT_MB)

    @property
    def effective_memory_limit_mb(self) -> int:
        return self.memory_limit_mb or default_memory_limit_mb()


class SettingsStore:
    def __init__(self, home: Path) -> None:
        self.home = home
        self.path = home / "config.json"

    def load(self) -> Settings:
        if self.path.exists():
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return Settings.model_validate({"workspace": self.home, **data})
        return Settings(workspace=self.home)

    def save(self, settings: Settings) -> None:
        self.home.mkdir(parents=True, exist_ok=True)
        payload = settings.model_dump(mode="json")
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        tmp.replace(self.path)
