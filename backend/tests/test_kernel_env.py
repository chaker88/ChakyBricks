import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from chakybricks.errors import ConflictError, InvalidInputError, NotFoundError
from chakybricks.kernel_env import MARKER, PTH_NAME, KernelEnvironment
from chakybricks.packages import JobState, PackageManager, parse_requirements
from tests.wheels import build_wheel


@pytest.fixture(scope="module")
def environment(tmp_path_factory: pytest.TempPathFactory) -> KernelEnvironment:
    return KernelEnvironment(tmp_path_factory.mktemp("env") / "venv").ensure()


def run(environment: KernelEnvironment, code: str) -> str:
    result = subprocess.run(
        [str(environment.python), "-c", code],
        capture_output=True,
        text=True,
        env=environment.environment(),
        check=True,
    )
    return result.stdout.strip()


def test_environment_sees_defaults_and_cb(environment: KernelEnvironment) -> None:
    assert environment.ready()
    assert (environment.site_packages / PTH_NAME).is_file()
    assert json.loads((environment.path / MARKER).read_text())["python"].startswith("3.")
    output = run(environment, "import sys, chakybricks.cb, duckdb, polars; print(sys.prefix)")
    assert Path(output) == environment.path
    defaults = {p.name.lower() for p in environment.defaults()}
    assert {"duckdb", "polars", "pandas", "scikit-learn", "ipykernel"} <= defaults
    assert environment.installed() == []


def test_parse_requirements() -> None:
    assert parse_requirements("xgboost  lightgbm==4.5.0 scikit-learn>=1.5,<2") == [
        "xgboost",
        "lightgbm==4.5.0",
        "scikit-learn>=1.5,<2",
    ]
    assert parse_requirements("pandas[parquet]") == ["pandas[parquet]"]
    for bad in ["", "--index-url http://x", "x; rm -rf /", "-e .", "../evil"]:
        with pytest.raises(InvalidInputError):
            parse_requirements(bad)


@pytest.fixture
def offline_index(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    wheels = tmp_path / "wheels"
    build_wheel(wheels)
    monkeypatch.setenv("PIP_NO_INDEX", "1")
    monkeypatch.setenv("PIP_FIND_LINKS", str(wheels))
    return wheels


def test_install_uninstall_and_reset(tmp_path: Path, offline_index: Path) -> None:
    environment = KernelEnvironment(tmp_path / "venv")
    resets: list[bool] = []
    manager = PackageManager(environment, before_reset=lambda: resets.append(True))
    try:
        installed = manager.wait(manager.install("chakytiny==1.0").id)
        assert installed.state == JobState.SUCCEEDED, installed.output
        assert installed.output.startswith("$ pip install chakytiny==1.0")
        assert "Successfully installed chakytiny-1.0" in installed.output
        listing = manager.listing()
        assert {"name": "chakytiny", "version": "1.0"} in listing["installed"]
        assert run(environment, "import chakytiny; print(chakytiny.VALUE)") == "42"

        with pytest.raises(ConflictError, match="default package"):
            manager.uninstall("duckdb")
        with pytest.raises(NotFoundError):
            manager.uninstall("not-installed-anywhere")
        with pytest.raises(InvalidInputError):
            manager.uninstall("../x")
        removed = manager.wait(manager.uninstall("chakytiny").id)
        assert removed.state == JobState.SUCCEEDED, removed.output
        assert "Successfully uninstalled chakytiny" in removed.output
        assert manager.listing()["installed"] == []

        manager.wait(manager.install("chakytiny").id)
        assert environment.installed()
        reset = manager.wait(manager.reset().id)
        assert reset.state == JobState.SUCCEEDED, reset.error
        assert resets == [True]
        assert environment.ready()
        assert environment.installed() == []
    finally:
        manager.shutdown()


def test_failed_install_reports_output(tmp_path: Path, offline_index: Path) -> None:
    environment = KernelEnvironment(tmp_path / "venv")
    manager = PackageManager(environment, before_reset=lambda: None)
    try:
        job = manager.wait(manager.install("chakytiny==9.9").id)
        assert job.state == JobState.FAILED
        assert "pip exited with code" in (job.error or "")
        assert job.output.startswith("$ pip install")
    finally:
        manager.shutdown()


def test_package_api(client: TestClient) -> None:
    listing = client.get("/api/packages").json()
    assert listing["environment"]["python_version"].startswith("3.12")
    assert any(p["name"].lower() == "polars" for p in listing["defaults"])
    assert client.post("/api/packages/install", json={"packages": "--evil"}).status_code == 422
    assert client.post("/api/packages/duckdb/uninstall").status_code == 409
    assert client.get("/api/packages/jobs/nope").status_code == 404

    settings = client.get("/api/settings").json()
    assert settings["kernel_memory_percent"] == 50
    assert settings["kernel_memory_limit_mb"] == settings["effective_memory_limit_mb"] // 2
    updated = client.put("/api/settings", json={"kernel_memory_percent": 25}).json()
    assert updated["kernel_memory_percent"] == 25
    assert client.put("/api/settings", json={"kernel_memory_percent": 5}).status_code == 422
