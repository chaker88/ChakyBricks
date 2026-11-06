from pathlib import Path
from typing import Annotated, Any

import duckdb
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from chakybricks import tables
from chakybricks.config import (
    MAX_ROW_LIMIT,
    MIN_MEMORY_LIMIT_MB,
    MIN_ROW_LIMIT,
    default_memory_limit_mb,
    total_memory_mb,
)
from chakybricks.ingest.jobs import ImportRequest
from chakybricks.ingest.sources import (
    ColumnSpec,
    SourceFormat,
    SourceOptions,
    detect_format,
    preview,
    resolve_source,
)
from chakybricks.services import Services

router = APIRouter(prefix="/api")


def get_services(request: Request) -> Services:
    services: Services = request.app.state.services
    return services


ServicesDep = Annotated[Services, Depends(get_services)]


class SettingsUpdate(BaseModel):
    workspace: str | None = None
    memory_limit_mb: int | None = Field(default=None, ge=MIN_MEMORY_LIMIT_MB)
    row_limit: int | None = Field(default=None, ge=MIN_ROW_LIMIT, le=MAX_ROW_LIMIT)


class SchemaCreate(BaseModel):
    name: str


class TableRename(BaseModel):
    schema_name: str
    name: str


class PreviewRequest(BaseModel):
    path: str
    format: SourceFormat | None = None
    options: SourceOptions = SourceOptions()
    columns: list[ColumnSpec] | None = None


def _settings_payload(services: Services) -> dict[str, Any]:
    settings = services.settings
    return {
        "workspace": str(services.workspace.root),
        "memory_limit_mb": settings.memory_limit_mb,
        "effective_memory_limit_mb": settings.effective_memory_limit_mb,
        "default_memory_limit_mb": default_memory_limit_mb(),
        "total_memory_mb": total_memory_mb(),
        "row_limit": settings.row_limit,
    }


@router.get("/settings")
def get_settings(services: ServicesDep) -> dict[str, Any]:
    return _settings_payload(services)


@router.put("/settings")
def update_settings(body: SettingsUpdate, services: ServicesDep) -> dict[str, Any]:
    changes: dict[str, object] = {}
    if "workspace" in body.model_fields_set and body.workspace:
        changes["workspace"] = Path(body.workspace)
    if "memory_limit_mb" in body.model_fields_set:
        changes["memory_limit_mb"] = body.memory_limit_mb
    if body.row_limit is not None:
        changes["row_limit"] = body.row_limit
    services.update_settings(changes)
    return _settings_payload(services)


@router.get("/catalog")
def get_catalog(services: ServicesDep) -> dict[str, Any]:
    all_tables = services.catalog.list_tables()
    return {
        "schemas": [
            {
                "name": schema,
                "tables": [tables.table_summary(t) for t in all_tables if t.schema == schema],
            }
            for schema in services.catalog.list_schemas()
        ]
    }


@router.post("/schemas", status_code=201)
def create_schema(body: SchemaCreate, services: ServicesDep) -> dict[str, str]:
    return {"name": services.catalog.create_schema(body.name)}


@router.delete("/schemas/{schema}", status_code=204)
def drop_schema(schema: str, services: ServicesDep) -> None:
    services.catalog.drop_schema(schema)


@router.get("/tables/{schema}/{table}")
def get_table(schema: str, table: str, services: ServicesDep) -> dict[str, Any]:
    return tables.describe(services, schema, table)


@router.get("/tables/{schema}/{table}/sample")
def get_sample(
    schema: str,
    table: str,
    services: ServicesDep,
    limit: Annotated[int, Query(ge=1, le=tables.MAX_SAMPLE_ROWS)] = 100,
    version: Annotated[int | None, Query(ge=0)] = None,
) -> dict[str, Any]:
    return tables.sample(services, schema, table, limit, version)


@router.get("/tables/{schema}/{table}/history")
def get_history(schema: str, table: str, services: ServicesDep) -> list[dict[str, Any]]:
    return tables.history(services, schema, table)


@router.post("/tables/{schema}/{table}/rename")
def rename_table(
    schema: str, table: str, body: TableRename, services: ServicesDep
) -> dict[str, Any]:
    renamed = tables.rename(services, schema, table, body.schema_name, body.name)
    return tables.table_summary(renamed)


@router.delete("/tables/{schema}/{table}", status_code=204)
def drop_table(schema: str, table: str, services: ServicesDep) -> None:
    tables.drop(services, schema, table)


@router.post("/imports/preview")
def preview_import(body: PreviewRequest, services: ServicesDep) -> dict[str, Any]:
    path = resolve_source(body.path)
    fmt = body.format or detect_format(path)
    with duckdb.connect() as con:
        return preview(con, path, fmt, body.options, body.columns)


@router.post("/imports", status_code=202)
def start_import(body: ImportRequest, services: ServicesDep) -> dict[str, Any]:
    return services.imports.submit(body).to_dict()


@router.get("/imports")
def list_imports(services: ServicesDep) -> list[dict[str, Any]]:
    return [job.to_dict() for job in services.imports.list()]


@router.get("/imports/{job_id}")
def get_import(job_id: str, services: ServicesDep) -> dict[str, Any]:
    return services.imports.get(job_id).to_dict()


@router.post("/imports/{job_id}/cancel")
def cancel_import(job_id: str, services: ServicesDep) -> dict[str, Any]:
    return services.imports.cancel(job_id).to_dict()
