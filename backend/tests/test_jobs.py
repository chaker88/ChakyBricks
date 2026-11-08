import time
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pyarrow as pa
import pytest
from fastapi.testclient import TestClient

from chakybricks.errors import ConflictError, InvalidInputError, NotFoundError
from chakybricks.schedules import Schedule
from chakybricks.services import Services
from tests.test_sql import add_table

UTC = ZoneInfo("UTC")


def wait_for_run(services: Services, run_id: int, timeout: float = 90) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = services.jobs.store.get_run(run_id)
        if run["status"] != "running":
            return run
        time.sleep(0.2)
    raise AssertionError(f"run {run_id} did not finish: {services.jobs.store.get_run(run_id)}")


@pytest.fixture
def data(services: Services) -> Services:
    add_table(services, "main", "src", pa.table({"id": list(range(100)), "v": [1.0] * 100}))
    return services


def test_schedule_descriptions_and_validation() -> None:
    assert Schedule(type="manual").describe() == "Manual only"
    assert Schedule(type="interval", minutes=15).validated().describe() == "Every 15 minutes"
    assert Schedule(type="interval", minutes=120).describe() == "Every 2 hours"
    assert Schedule(type="daily", time="06:30").validated().describe() == "Every day at 06:30"
    weekly = Schedule(type="weekly", time="09:00", days=[4, 0, 0]).validated()
    assert weekly.describe() == "Every Mon, Fri at 09:00"
    monthly = Schedule(type="monthly", time="01:00", day=15)
    assert monthly.describe() == "Day 15 of every month at 01:00"
    for bad in (
        Schedule(type="interval"),
        Schedule(type="daily"),
        Schedule(type="weekly", time="09:00"),
        Schedule(type="monthly", time="09:00"),
        Schedule(type="cron", expression="not a cron"),
        Schedule(type="cron", expression=""),
    ):
        with pytest.raises(InvalidInputError):
            bad.validated()
    with pytest.raises(ValueError):
        Schedule(type="daily", time="25:00")
    with pytest.raises(ValueError):
        Schedule(type="weekly", time="09:00", days=[7])


def test_next_runs_follow_the_schedule() -> None:
    now = datetime(2026, 11, 8, 12, 0, tzinfo=UTC)
    daily = Schedule(type="daily", time="06:30").next_runs(3, now)
    assert len(daily) == 3
    assert all((t.hour, t.minute) == (6, 30) for t in daily)
    assert daily[1] - daily[0] == timedelta(days=1)
    cron = Schedule(type="cron", expression="*/30 * * * *").next_runs(3, now)
    assert len(cron) == 3
    assert cron[1] - cron[0] == timedelta(minutes=30)
    monthly = Schedule(type="monthly", time="00:00", day=1).next_runs(2, now)
    assert all(t.day == 1 for t in monthly)
    assert Schedule(type="manual").next_runs() == []


def test_store_crud_runs_and_rename(services: Services) -> None:
    services.notebooks.create("Report")
    job = services.jobs.create(
        "Nightly", "notebook", "Report", Schedule(type="daily", time="02:00")
    )
    assert job["schedule_text"] == "Every day at 02:00" and job["next_run_at"]
    with pytest.raises(ConflictError):
        services.jobs.create("nightly", "notebook", "Report", Schedule())
    with pytest.raises(NotFoundError):
        services.jobs.create("Ghost", "notebook", "missing", Schedule())
    with pytest.raises(InvalidInputError):
        services.jobs.create("Bad", "query", "abc", Schedule())

    paused = services.jobs.update(job["id"], enabled=False)
    assert paused["enabled"] is False and paused["next_run_at"] is None
    resumed = services.jobs.update(job["id"], enabled=True, name="Nightly report")
    assert resumed["next_run_at"] and resumed["name"] == "Nightly report"
    manual = services.jobs.update(job["id"], schedule=Schedule(type="manual"))
    assert manual["next_run_at"] is None

    services.jobs.store.notebook_renamed("Report", "Report v2")
    assert services.jobs.get(job["id"])["target"] == "Report v2"

    for _ in range(3):
        services.jobs.store.create_run(job["id"], "manual", "succeeded")
    assert len(services.jobs.store.list_runs(job["id"])) == 3
    services.jobs.delete(job["id"])
    with pytest.raises(NotFoundError):
        services.jobs.get(job["id"])
    assert services.jobs.list_jobs() == []


def test_stale_runs_are_failed_on_start(services: Services) -> None:
    saved = services.queries.create_saved("q", "SELECT 1")
    job = services.jobs.create("A", "query", str(saved.id), Schedule())
    run_id = services.jobs.store.create_run(job["id"], "manual")
    services.jobs.store.fail_stale_runs()
    run = services.jobs.store.get_run(run_id)
    assert run["status"] == "failed" and "closed" in run["message"]


def test_query_job_writes_a_table(data: Services) -> None:
    saved = data.queries.create_saved(
        "refresh", "CREATE OR REPLACE TABLE copy AS SELECT * FROM src"
    )
    job = data.jobs.create("Refresh copy", "query", str(saved.id), Schedule())
    started = data.jobs.run_now(job["id"])
    assert started["status"] == "running"
    run = wait_for_run(data, started["id"])
    assert run["status"] == "succeeded", run
    assert "copy" in run["log"] and run["duration_ms"] is not None
    assert data.catalog.get_table("main", "copy").row_count == 100
    described = data.jobs.get(job["id"])
    assert described["last_run"]["status"] == "succeeded" and described["running"] is False


def test_failed_query_job_reports_the_error(data: Services) -> None:
    saved = data.queries.create_saved("broken", "SELECT * FROM nope")
    job = data.jobs.create("Broken", "query", str(saved.id), Schedule())
    run = wait_for_run(data, data.jobs.run_now(job["id"])["id"])
    assert run["status"] == "failed" and "nope" in run["message"]
    data.queries.delete_saved(saved.id)
    run = wait_for_run(data, data.jobs.run_now(job["id"])["id"])
    assert run["status"] == "failed" and "does not exist" in run["message"]


def test_scheduled_fire_runs_and_skips_overlap(data: Services) -> None:
    saved = data.queries.create_saved(
        "slow", "SELECT count(*) FROM range(300000000) t(i) WHERE i % 7 = 0"
    )
    job = data.jobs.create("Slow", "query", str(saved.id), Schedule(type="interval", minutes=5))
    data.jobs._fire(job["id"])
    data.jobs._fire(job["id"])
    runs = data.jobs.store.list_runs(job["id"])
    statuses = [r["status"] for r in runs]
    assert "skipped" in statuses and len(runs) == 2
    first = next(r for r in runs if r["status"] != "skipped")
    assert wait_for_run(data, first["id"])["status"] == "succeeded"
    assert all(r["trigger"] == "schedule" for r in runs)


def test_cancel_a_running_query_job(data: Services) -> None:
    saved = data.queries.create_saved(
        "forever", "SELECT count(*) FROM range(100000000000) t(i) WHERE i % 7 = 0"
    )
    job = data.jobs.create("Forever", "query", str(saved.id), Schedule())
    run_id = data.jobs.run_now(job["id"])["id"]
    with pytest.raises(ConflictError):
        data.jobs.run_now(job["id"])
    time.sleep(1)
    data.jobs.cancel_run(run_id)
    assert wait_for_run(data, run_id, 30)["status"] == "cancelled"


def notebook_cells(*sources: str) -> list[dict[str, Any]]:
    return [{"cell_type": "code", "source": s} for s in sources]


def test_notebook_job_runs_cells_and_logs_output(data: Services) -> None:
    data.notebooks.create(
        "Etl",
        [
            *notebook_cells("print('hello from a job')"),
            {"cell_type": "code", "source": "SELECT count(*) AS n FROM src", "language": "sql"},
            {"cell_type": "markdown", "source": "# ignored"},
            *notebook_cells("cb.sql('CREATE OR REPLACE TABLE from_job AS SELECT * FROM src')"),
        ],
    )
    job = data.jobs.create("Etl", "notebook", "Etl", Schedule())
    run = wait_for_run(data, data.jobs.run_now(job["id"])["id"], 180)
    assert run["status"] == "succeeded", run["log"]
    assert "hello from a job" in run["log"]
    assert data.catalog.get_table("main", "from_job").row_count == 100
    assert not [k for k in data.kernels.list() if k.purpose == "job" and k.status != "dead"]
    assert data.kernels.for_notebook("Etl") is None


def test_notebook_job_failure_stops_and_reports(data: Services) -> None:
    data.notebooks.create(
        "Bad", notebook_cells("print('before')", "raise ValueError('boom')", "print('never-runs')")
    )
    job = data.jobs.create("Bad", "notebook", "Bad", Schedule())
    run = wait_for_run(data, data.jobs.run_now(job["id"])["id"], 180)
    assert run["status"] == "failed"
    assert "Cell 2 failed" in run["message"] and "boom" in run["message"]
    assert "before" in run["log"] and "never-runs" not in run["log"]


def test_notebook_job_can_be_cancelled(data: Services) -> None:
    data.notebooks.create(
        "Long", notebook_cells("import time\nprint('started', flush=True)\ntime.sleep(120)")
    )
    job = data.jobs.create("Long", "notebook", "Long", Schedule())
    run_id = data.jobs.run_now(job["id"])["id"]
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline and "started" not in data.jobs.store.get_run(run_id)["log"]:
        time.sleep(0.5)
    data.jobs.cancel_run(run_id)
    assert wait_for_run(data, run_id, 60)["status"] == "cancelled"


def test_job_api(client: TestClient) -> None:
    saved = client.post("/api/saved-queries", json={"name": "q", "sql": "SELECT 1 AS one"}).json()
    created = client.post(
        "/api/jobs",
        json={
            "name": "API job",
            "kind": "query",
            "target": str(saved["id"]),
            "schedule": {"type": "daily", "time": "07:15"},
        },
    )
    assert created.status_code == 201
    job_id = created.json()["id"]
    assert client.get("/api/jobs").json()[0]["schedule_text"] == "Every day at 07:15"
    preview = client.post(
        "/api/jobs/schedule-preview", json={"schedule": {"type": "interval", "minutes": 30}}
    )
    assert preview.status_code == 200 and len(preview.json()["next_runs"]) == 5
    bad = client.post(
        "/api/jobs/schedule-preview", json={"schedule": {"type": "cron", "expression": "x y"}}
    )
    assert bad.status_code == 422
    assert client.put(f"/api/jobs/{job_id}", json={"enabled": False}).json()["enabled"] is False
    run = client.post(f"/api/jobs/{job_id}/run")
    assert run.status_code == 202
    run_id = run.json()["id"]
    for _ in range(100):
        detail = client.get(f"/api/job-runs/{run_id}").json()
        if detail["status"] != "running":
            break
        time.sleep(0.1)
    assert detail["status"] == "succeeded"
    assert client.get(f"/api/jobs/{job_id}/runs").json()[0]["id"] == run_id
    assert client.post(f"/api/job-runs/{run_id}/cancel").status_code == 409
    assert client.delete(f"/api/jobs/{job_id}").status_code == 204
    assert client.get(f"/api/jobs/{job_id}").status_code == 404


def test_pause_all_jobs_skips_scheduled_fires(client: TestClient) -> None:
    services: Services = client.app.state.services  # type: ignore[attr-defined]
    saved = services.queries.create_saved("quick", "SELECT 1 AS one")
    job = services.jobs.create(
        "Quick", "query", str(saved.id), Schedule(type="interval", minutes=5)
    )
    assert client.put("/api/jobs/state", json={"paused": True}).json() == {"paused": True}
    services.jobs._fire(job["id"])
    assert services.jobs.store.list_runs(job["id"]) == []
    assert client.get("/api/jobs/state").json() == {"paused": True}
    client.put("/api/jobs/state", json={"paused": False})
    services.jobs._fire(job["id"])
    runs = services.jobs.store.list_runs(job["id"])
    assert len(runs) == 1
    assert wait_for_run(services, runs[0]["id"])["status"] == "succeeded"
