import os
import platform
import sys
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from chakybricks import __version__
from chakybricks.auth import TokenAuthMiddleware
from chakybricks.config import app_home
from chakybricks.dashboard_routes import router as dashboard_router
from chakybricks.errors import ChakyError
from chakybricks.notebook_routes import router as notebook_router
from chakybricks.routes import router
from chakybricks.services import Services
from chakybricks.sql_routes import router as sql_router

ALLOWED_ORIGINS = [
    "http://localhost:1420",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
]


def create_app(token: str, home: Path | None = None) -> FastAPI:
    if not token:
        raise ValueError("A session token is required")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.services = Services(home or app_home())
        yield
        app.state.services.close()

    app = FastAPI(
        title="ChakyBricks", version=__version__, docs_url=None, redoc_url=None, lifespan=lifespan
    )
    started_at = time.time()

    app.add_middleware(TokenAuthMiddleware, token=token)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    app.include_router(sql_router)
    app.include_router(notebook_router)
    app.include_router(dashboard_router)

    @app.exception_handler(ChakyError)
    async def handle_error(_: Request, exc: ChakyError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=exc.status_code)

    @app.get("/api/health")
    def health() -> dict[str, object]:
        return {
            "status": "ok",
            "version": __version__,
            "uptime_seconds": round(time.time() - started_at, 1),
        }

    @app.get("/api/system")
    def system() -> dict[str, object]:
        return {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "pid": os.getpid(),
            "frozen": bool(getattr(sys, "frozen", False)),
        }

    @app.websocket("/ws/echo")
    async def echo(websocket: WebSocket) -> None:
        await websocket.accept()
        try:
            while True:
                await websocket.send_text(await websocket.receive_text())
        except WebSocketDisconnect:
            pass

    return app
