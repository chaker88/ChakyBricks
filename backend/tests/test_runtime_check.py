import importlib.util
import sys
from pathlib import Path
from types import ModuleType

from tests.wheels import build_wheel

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_runtime.py"


def load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_runtime", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_runtime"] = module
    spec.loader.exec_module(module)
    return module


def test_closure_follows_backend_dependencies() -> None:
    needed = load().closure()
    assert {"chakybricks", "duckdb", "deltalake", "polars", "ipykernel", "fastapi"} <= needed
    assert {"uvicorn", "websockets", "httptools"} <= needed
    assert "pytest" not in needed and "ruff" not in needed


def test_flags_stray_and_missing_packages(tmp_path: Path) -> None:
    check = load()
    site = tmp_path / "site-packages"
    wheel = build_wheel(tmp_path / "wheels", "xgboost", "9.9")
    import zipfile

    with zipfile.ZipFile(wheel) as archive:
        archive.extractall(site)
    unexpected, missing = check.problems(site)
    assert unexpected == {"xgboost"}
    assert "duckdb" in missing
