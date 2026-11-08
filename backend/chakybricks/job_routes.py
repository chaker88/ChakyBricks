from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from chakybricks.jobs import JobKind
from chakybricks.routes import ServicesDep
from chakybricks.schedules import Schedule

router = APIRouter(prefix="/api")


class JobCreate(BaseModel):
    name: str
    kind: JobKind
    target: str
    schedule: Schedule = Schedule()
    enabled: bool = True


class JobUpdate(BaseModel):
    name: str | None = None
    kind: JobKind | None = None
    target: str | None = None
    schedule: Schedule | None = None
    enabled: bool | None = None


class SchedulePreview(BaseModel):
    schedule: Schedule
    count: int = Field(default=5, ge=1, le=20)


@router.get("/jobs")
def list_jobs(services: ServicesDep) -> list[dict[str, Any]]:
    return services.jobs.list_jobs()


@router.post("/jobs", status_code=201)
def create_job(body: JobCreate, services: ServicesDep) -> dict[str, Any]:
    return services.jobs.create(body.name, body.kind, body.target, body.schedule, body.enabled)


@router.post("/jobs/schedule-preview")
def preview_schedule(body: SchedulePreview, services: ServicesDep) -> dict[str, Any]:
    schedule = body.schedule.validated()
    return {
        "description": schedule.describe(),
        "next_runs": [t.isoformat() for t in schedule.next_runs(body.count)],
    }


class PauseUpdate(BaseModel):
    paused: bool


@router.get("/jobs/state")
def jobs_state(services: ServicesDep) -> dict[str, bool]:
    return {"paused": services.jobs.paused}


@router.put("/jobs/state")
def set_jobs_state(body: PauseUpdate, services: ServicesDep) -> dict[str, bool]:
    services.jobs.set_paused(body.paused)
    return {"paused": services.jobs.paused}


@router.get("/jobs/{job_id}")
def get_job(job_id: int, services: ServicesDep) -> dict[str, Any]:
    return services.jobs.get(job_id)


@router.put("/jobs/{job_id}")
def update_job(job_id: int, body: JobUpdate, services: ServicesDep) -> dict[str, Any]:
    changes = {k: getattr(body, k) for k in body.model_fields_set if getattr(body, k) is not None}
    return services.jobs.update(job_id, **changes)


@router.delete("/jobs/{job_id}", status_code=204)
def delete_job(job_id: int, services: ServicesDep) -> None:
    services.jobs.delete(job_id)


@router.post("/jobs/{job_id}/run", status_code=202)
def run_job(job_id: int, services: ServicesDep) -> dict[str, Any]:
    return services.jobs.run_now(job_id)


@router.get("/jobs/{job_id}/runs")
def list_runs(
    job_id: int, services: ServicesDep, limit: Annotated[int, Query(ge=1, le=200)] = 50
) -> list[dict[str, Any]]:
    return services.jobs.store.list_runs(job_id, limit)


@router.get("/job-runs/{run_id}")
def get_run(run_id: int, services: ServicesDep) -> dict[str, Any]:
    return services.jobs.store.get_run(run_id)


@router.post("/job-runs/{run_id}/cancel")
def cancel_run(run_id: int, services: ServicesDep) -> dict[str, Any]:
    return services.jobs.cancel_run(run_id)
