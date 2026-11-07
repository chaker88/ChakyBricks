import base64
import binascii
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from chakybricks.dashboard_models import DashboardSpec, OptionsQuery, Source, TileQuery
from chakybricks.demo import create_sample_dashboard
from chakybricks.errors import InvalidInputError
from chakybricks.routes import ServicesDep

router = APIRouter(prefix="/api")

EXPORT_SUFFIXES = {".png", ".pdf"}
MAX_EXPORT_BYTES = 100 * 1024 * 1024


class DashboardCreate(BaseModel):
    name: str
    description: str = ""
    spec: DashboardSpec | None = None


class DashboardUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    spec: DashboardSpec | None = None


class ColumnsRequest(BaseModel):
    source: Source


class FileSave(BaseModel):
    path: str
    data_base64: str


@router.get("/dashboards")
def list_dashboards(services: ServicesDep) -> list[dict[str, Any]]:
    return [d.summary() for d in services.dashboards.list()]


@router.post("/dashboards", status_code=201)
def create_dashboard(body: DashboardCreate, services: ServicesDep) -> dict[str, Any]:
    return services.dashboards.create(body.name, body.spec, body.description).to_dict()


@router.post("/dashboards/sample", status_code=201)
def create_sample(services: ServicesDep) -> dict[str, Any]:
    return create_sample_dashboard(services).to_dict()


@router.post("/dashboards/query")
def run_tile_query(body: TileQuery, services: ServicesDep) -> dict[str, Any]:
    return services.dashboard_queries.run(body)


@router.post("/dashboards/options")
def filter_options(body: OptionsQuery, services: ServicesDep) -> dict[str, Any]:
    return services.dashboard_queries.options(body)


@router.post("/dashboards/columns")
def source_columns(body: ColumnsRequest, services: ServicesDep) -> list[dict[str, str]]:
    return services.dashboard_queries.columns(body.source)


@router.get("/dashboards/{dashboard_id}")
def get_dashboard(dashboard_id: int, services: ServicesDep) -> dict[str, Any]:
    return services.dashboards.get(dashboard_id).to_dict()


@router.put("/dashboards/{dashboard_id}")
def update_dashboard(
    dashboard_id: int, body: DashboardUpdate, services: ServicesDep
) -> dict[str, Any]:
    return services.dashboards.update(
        dashboard_id, name=body.name, description=body.description, spec=body.spec
    ).to_dict()


@router.post("/dashboards/{dashboard_id}/duplicate", status_code=201)
def duplicate_dashboard(dashboard_id: int, services: ServicesDep) -> dict[str, Any]:
    return services.dashboards.duplicate(dashboard_id).to_dict()


@router.delete("/dashboards/{dashboard_id}", status_code=204)
def delete_dashboard(dashboard_id: int, services: ServicesDep) -> None:
    services.dashboards.delete(dashboard_id)


@router.post("/export/file")
def save_export_file(body: FileSave) -> dict[str, Any]:
    """Writes a PNG/PDF the frontend rendered to a path the user picked in a save dialog."""
    target = Path(body.path)
    if not target.is_absolute() or target.suffix.lower() not in EXPORT_SUFFIXES:
        raise InvalidInputError("Exports are saved as .png or .pdf files")
    if not target.parent.is_dir():
        raise InvalidInputError(f"Cannot write to {body.path}")
    try:
        data = base64.b64decode(body.data_base64, validate=True)
    except binascii.Error as exc:
        raise InvalidInputError("The export data is not valid") from exc
    if len(data) > MAX_EXPORT_BYTES:
        raise InvalidInputError("The export is too large")
    target.write_bytes(data)
    return {"path": str(target), "size_bytes": len(data)}
