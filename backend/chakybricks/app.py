import os
import platform
import sys
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from chakybricks import __version__
from chakybricks.auth import TokenAuthMiddleware

ALLOWED_ORIGINS = [
    "http://localhost:1420",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
]


def create_app(token: str) -> FastAPI:
    if not token:
        raise ValueError("A session token is required")

    app = FastAPI(title="ChakyBricks", version=__version__, docs_url=None, redoc_url=None)
    started_at = time.time()

    app.add_middleware(TokenAuthMiddleware, token=token)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )

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
