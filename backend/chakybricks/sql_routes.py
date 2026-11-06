import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from chakybricks.config import MAX_ROW_LIMIT
from chakybricks.ingest.jobs import QueryImportRequest
from chakybricks.routes import ServicesDep
from chakybricks.sql import ExportFormat

router = APIRouter(prefix="/api")


class RunRequest(BaseModel):
    sql: str
    query_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    limit: int | None = Field(default=None, ge=1, le=MAX_ROW_LIMIT)


class StatsRequest(BaseModel):
    sql: str
    column: str


class ExportRequest(BaseModel):
    sql: str
    path: str
    format: ExportFormat
    query_id: str = Field(default_factory=lambda: uuid.uuid4().hex)


class SavedQueryCreate(BaseModel):
    name: str
    sql: str
    description: str = ""


class SavedQueryUpdate(BaseModel):
    name: str | None = None
    sql: str | None = None
    description: str | None = None


@router.post("/sql/run")
def run_query(body: RunRequest, services: ServicesDep) -> dict[str, Any]:
    return services.sql.run(body.sql, body.query_id, body.limit)


@router.post("/sql/cancel/{query_id}")
def cancel_query(query_id: str, services: ServicesDep) -> dict[str, bool]:
    return {"cancelled": services.sql.cancel(query_id)}


@router.post("/sql/stats")
def column_stats(body: StatsRequest, services: ServicesDep) -> dict[str, Any]:
    return services.sql.column_stats(body.sql, body.column)


@router.post("/sql/export")
def export_result(body: ExportRequest, services: ServicesDep) -> dict[str, Any]:
    return services.sql.export(body.sql, body.path, body.format, body.query_id)


@router.post("/sql/save-table", status_code=202)
def save_as_table(body: QueryImportRequest, services: ServicesDep) -> dict[str, Any]:
    return services.imports.submit(body).to_dict()


@router.get("/sql/history")
def query_history(
    services: ServicesDep, limit: Annotated[int, Query(ge=1, le=500)] = 100
) -> list[dict[str, Any]]:
    return services.queries.history(limit)


@router.delete("/sql/history", status_code=204)
def clear_history(services: ServicesDep) -> None:
    services.queries.clear_history()


@router.get("/saved-queries")
def list_saved(services: ServicesDep) -> list[dict[str, Any]]:
    return [q.to_dict() for q in services.queries.list_saved()]


@router.post("/saved-queries", status_code=201)
def create_saved(body: SavedQueryCreate, services: ServicesDep) -> dict[str, Any]:
    return services.queries.create_saved(body.name, body.sql, body.description).to_dict()


@router.get("/saved-queries/{query_id}")
def get_saved(query_id: int, services: ServicesDep) -> dict[str, Any]:
    return services.queries.get_saved(query_id).to_dict()


@router.put("/saved-queries/{query_id}")
def update_saved(query_id: int, body: SavedQueryUpdate, services: ServicesDep) -> dict[str, Any]:
    return services.queries.update_saved(
        query_id, name=body.name, sql=body.sql, description=body.description
    ).to_dict()


@router.delete("/saved-queries/{query_id}", status_code=204)
def delete_saved(query_id: int, services: ServicesDep) -> None:
    services.queries.delete_saved(query_id)
