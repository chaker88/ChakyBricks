"""The per-workspace virtual environment notebook kernels run in.

The venv sees the bundled default packages (and `chakybricks` for `cb`) through a `.pth` file,
so it is created in seconds and works offline. Packages installed with `%pip` land in the venv
and shadow the defaults; the defaults themselves live outside the venv and cannot be removed.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import sysconfig
import threading
import time
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path
from typing import Any

from chakybricks.catalog import now_iso
from chakybricks.errors import ChakyError

VENV_ENV = "CHAKYBRICKS_KERNEL_VENV"
BASE_PYTHON_ENV = "CHAKYBRICKS_BASE_PYTHON"
PTH_NAME = "_chakybricks_defaults.pth"
CONSTRAINTS_NAME = "chakybricks-constraints.txt"
PROTECTED_PACKAGES = ("duckdb", "deltalake", "pyarrow", "polars", "numpy", "pandas", "ipykernel")
_CONSTRAINT_CONFLICT = re.compile(r"The user requested \(constraint\) ([A-Za-z0-9_.-]+)==(\S+)")
MARKER = "chakybricks-env.json"
CREATE_NO_WINDOW = 0x08000000


class KernelEnvironmentError(ChakyError):
    status_code = 500


@dataclass(frozen=True)
class Package:
    name: str
    version: str

    def to_dict(self) -> dict[str, str]:
        return {"name": self.name, "version": self.version}


def defaults_path() -> Path:
    """Where the backend's own packages live: the bundled runtime, or the dev venv."""
    return Path(sysconfig.get_paths()["purelib"])


def base_python() -> Path:
    override = os.environ.get(BASE_PYTHON_ENV)
    if override:
        return Path(override)
    return Path(getattr(sys, "_base_executable", sys.executable))


def subprocess_flags() -> int:
    return CREATE_NO_WINDOW if sys.platform == "win32" else 0


def clean_environment(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "CHAKYBRICKS_TOKEN")
    }
    env["PYTHONNOUSERSITE"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    env["PIP_NO_INPUT"] = "1"
    return {**env, **(extra or {})}


class KernelEnvironment:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    @property
    def python(self) -> Path:
        scripts = "Scripts" if sys.platform == "win32" else "bin"
        name = "python.exe" if sys.platform == "win32" else "python"
        return self.path / scripts / name

    @property
    def scripts(self) -> Path:
        return self.python.parent

    @property
    def site_packages(self) -> Path:
        if sys.platform == "win32":
            return self.path / "Lib" / "site-packages"
        version = f"python{sys.version_info.major}.{sys.version_info.minor}"
        return self.path / "lib" / version / "site-packages"

    @property
    def constraints(self) -> Path:
        return self.path / CONSTRAINTS_NAME

    def environment(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        env = clean_environment(extra)
        env["VIRTUAL_ENV"] = str(self.path)
        env["PIP_CONSTRAINT"] = str(self.constraints)
        env["PATH"] = os.pathsep.join([str(self.scripts), env.get("PATH", "")])
        return env

    def ready(self) -> bool:
        marker = self.path / MARKER
        if not self.python.exists() or not marker.exists():
            return False
        try:
            info = json.loads(marker.read_text(encoding="utf-8"))
        except ValueError:
            return False
        return bool(
            info.get("python") == _python_tag() and info.get("defaults") == str(defaults_path())
        )

    def ensure(self) -> KernelEnvironment:
        with self._lock:
            if not self.ready():
                self._create()
            self._write_pip_config()
        return self

    def reset(self) -> None:
        with self._lock:
            self._remove()
            self._create()
            self._write_pip_config()

    def protected(self) -> dict[str, str]:
        """The bundled versions every install in the venv must keep (cb depends on them)."""
        versions = {p.name.lower(): p.version for p in self.defaults()}
        return {name: versions[name] for name in PROTECTED_PACKAGES if name in versions}

    def _write_pip_config(self) -> None:
        """Pin cb's dependencies for every pip run in the venv: %pip, !pip and the Packages page."""
        lines = [f"{name}=={version}" for name, version in self.protected().items()]
        self.constraints.write_text(
            "# Managed by ChakyBricks: cb, SQL cells and Delta tables need these versions.\n"
            + "\n".join(lines)
            + "\n",
            encoding="utf-8",
        )
        config = self.path / ("pip.ini" if sys.platform == "win32" else "pip.conf")
        config.write_text(f"[install]\nconstraint = {self.constraints}\n", encoding="utf-8")

    def defaults(self) -> list[Package]:
        return _distributions(defaults_path())

    def installed(self) -> list[Package]:
        if not self.site_packages.exists():
            return []
        return _distributions(self.site_packages, exclude={"pip", "setuptools"})

    def info(self) -> dict[str, Any]:
        marker = self.path / MARKER
        created = None
        if marker.exists():
            created = json.loads(marker.read_text(encoding="utf-8")).get("created_at")
        return {
            "path": str(self.path),
            "python": str(self.python),
            "python_version": ".".join(map(str, sys.version_info[:3])),
            "ready": self.ready(),
            "created_at": created,
        }

    def _create(self) -> None:
        if self.path.exists():
            self._remove()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            [str(base_python()), "-m", "venv", str(self.path)],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=clean_environment(),
            creationflags=subprocess_flags(),
        )
        if result.returncode != 0 or not self.python.exists():
            raise KernelEnvironmentError(
                f"Could not create the notebook environment: {result.stderr.strip()}"
            )
        defaults = defaults_path()
        (self.site_packages / PTH_NAME).write_text(
            f"import site; site.addsitedir({str(defaults)!r})\n", encoding="utf-8"
        )
        marker = {"python": _python_tag(), "defaults": str(defaults), "created_at": now_iso()}
        (self.path / MARKER).write_text(json.dumps(marker, indent=2), encoding="utf-8")

    def _remove(self) -> None:
        for attempt in range(10):
            try:
                if self.path.exists():
                    shutil.rmtree(self.path)
                return
            except OSError:
                if attempt == 9:
                    raise KernelEnvironmentError(
                        f"Could not remove {self.path}; shut down running kernels and try again"
                    ) from None
                time.sleep(0.3)


def explain_conflict(pip_output: str) -> str | None:
    """A readable reason when pip refused an install because it would change a pinned package."""
    pinned: dict[str, str] = {}
    for name, version in _CONSTRAINT_CONFLICT.findall(pip_output):
        pinned.setdefault(name.lower(), version)
    if not pinned:
        return None
    listed = ", ".join(f"{name} {version}" for name, version in pinned.items())
    names = ", ".join(PROTECTED_PACKAGES)
    return (
        f"Nothing was installed: this would change {listed}. ChakyBricks keeps {names} at the "
        "bundled versions because cb, SQL cells and Delta tables depend on them. Try a version "
        "of the package that supports the bundled versions (often an older or newer release)."
    )


def _python_tag() -> str:
    return f"{sys.version_info.major}.{sys.version_info.minor}"


def _distributions(path: Path, exclude: set[str] | None = None) -> list[Package]:
    found: dict[str, Package] = {}
    for dist in metadata.distributions(path=[str(path)]):
        name = dist.metadata["Name"]
        if not name or (exclude and name.lower() in exclude):
            continue
        found.setdefault(name.lower(), Package(name, dist.version))
    return sorted(found.values(), key=lambda p: p.name.lower())
