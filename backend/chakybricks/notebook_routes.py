import asyncio
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from chakybricks.errors import ChakyError
from chakybricks.routes import ServicesDep
from chakybricks.services import Services

router = APIRouter()


class NotebookCreate(BaseModel):
    name: str | None = None
    cells: list[dict[str, Any]] | None = None


class NotebookRename(BaseModel):
    name: str


class KernelStart(BaseModel):
    notebook: str


@router.get("/api/notebooks")
def list_notebooks(services: ServicesDep) -> list[dict[str, Any]]:
    return services.notebooks.entries()


@router.post("/api/notebooks", status_code=201)
def create_notebook(body: NotebookCreate, services: ServicesDep) -> dict[str, Any]:
    name = services.notebooks.create(body.name, body.cells)
    return {"name": name}


@router.get("/api/notebooks/{name}")
def read_notebook(name: str, services: ServicesDep) -> dict[str, Any]:
    return services.notebooks.read(name)


@router.put("/api/notebooks/{name}")
def save_notebook(name: str, body: dict[str, Any], services: ServicesDep) -> dict[str, Any]:
    return services.notebooks.save(name, body)


@router.post("/api/notebooks/{name}/rename")
def rename_notebook(name: str, body: NotebookRename, services: ServicesDep) -> dict[str, Any]:
    new_name = services.notebooks.rename(name, body.name)
    services.kernels.rename_notebook(name, new_name)
    services.jobs.store.notebook_renamed(name, new_name)
    return {"name": new_name}


@router.delete("/api/notebooks/{name}", status_code=204)
def delete_notebook(name: str, services: ServicesDep) -> None:
    services.notebooks.delete(name)
    services.kernels.notebook_deleted(name)


@router.post("/api/kernels")
def start_kernel(body: KernelStart, services: ServicesDep) -> dict[str, Any]:
    services.notebooks.read(body.notebook)
    return services.kernels.start(body.notebook).to_dict()


@router.get("/api/kernels")
def list_kernels(services: ServicesDep) -> list[dict[str, Any]]:
    return [k.to_dict() for k in services.kernels.list()]


@router.post("/api/kernels/{kernel_id}/interrupt")
def interrupt_kernel(kernel_id: str, services: ServicesDep) -> dict[str, Any]:
    session = services.kernels.get(kernel_id)
    session.interrupt()
    return session.to_dict()


@router.post("/api/kernels/{kernel_id}/restart")
def restart_kernel(kernel_id: str, services: ServicesDep) -> dict[str, Any]:
    session = services.kernels.get(kernel_id)
    session.restart()
    return session.to_dict()


@router.delete("/api/kernels/{kernel_id}", status_code=204)
def shutdown_kernel(kernel_id: str, services: ServicesDep) -> None:
    services.kernels.shutdown(kernel_id)


class PackageInstall(BaseModel):
    packages: str


@router.get("/api/packages")
def list_packages(services: ServicesDep) -> dict[str, Any]:
    return services.packages.listing()


@router.post("/api/packages/install", status_code=202)
def install_packages(body: PackageInstall, services: ServicesDep) -> dict[str, Any]:
    return services.packages.install(body.packages).to_dict()


@router.post("/api/packages/{name}/uninstall", status_code=202)
def uninstall_package(name: str, services: ServicesDep) -> dict[str, Any]:
    return services.packages.uninstall(name).to_dict()


@router.post("/api/packages/reset", status_code=202)
def reset_packages(services: ServicesDep) -> dict[str, Any]:
    return services.packages.reset().to_dict()


@router.get("/api/packages/jobs/{job_id}")
def package_job(job_id: str, services: ServicesDep) -> dict[str, Any]:
    return services.packages.get(job_id).to_dict()


@router.websocket("/ws/kernels/{kernel_id}")
async def kernel_socket(websocket: WebSocket, kernel_id: str) -> None:
    services: Services = websocket.app.state.services
    try:
        session = services.kernels.get(kernel_id)
    except ChakyError:
        await websocket.close(code=4404)
        return
    await websocket.accept()
    loop = asyncio.get_running_loop()
    events: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    def listener(event: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(events.put_nowait, event)

    session.add_listener(listener)
    await events.put({"type": "status", "state": session.status})

    async def pump() -> None:
        while True:
            await websocket.send_json(await events.get())

    sender = asyncio.create_task(pump())
    try:
        while True:
            message = await websocket.receive_json()
            kind = message.get("type")
            try:
                if kind == "execute":
                    await run_in_threadpool(
                        session.execute, str(message["cell_id"]), str(message["code"])
                    )
                elif kind == "complete":
                    reply = await run_in_threadpool(
                        session.complete, str(message["code"]), int(message["cursor_pos"])
                    )
                    await events.put(
                        {"type": "complete_reply", "request_id": message.get("request_id"), **reply}
                    )
            except ChakyError as exc:
                await events.put(
                    {"type": "error", "cell_id": message.get("cell_id"), "message": str(exc)}
                )
    except WebSocketDisconnect:
        pass
    finally:
        session.remove_listener(listener)
        sender.cancel()
