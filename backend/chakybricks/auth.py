import secrets
from urllib.parse import parse_qs

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

TOKEN_HEADER = "x-chakybricks-token"
TOKEN_QUERY_PARAM = "token"


class TokenAuthMiddleware:
    """Rejects every HTTP and WebSocket request that does not carry the session token."""

    def __init__(self, app: ASGIApp, token: str) -> None:
        self.app = app
        self.token = token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "http" and scope["method"] == "OPTIONS":
            await self.app(scope, receive, send)
            return
        if self._is_authorized(scope):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4401})
            return
        response = JSONResponse({"detail": "Invalid or missing session token"}, status_code=401)
        await response(scope, receive, send)

    def _is_authorized(self, scope: Scope) -> bool:
        provided = _header(scope, TOKEN_HEADER) or _query_param(scope, TOKEN_QUERY_PARAM)
        return provided is not None and secrets.compare_digest(provided, self.token)


def _header(scope: Scope, name: str) -> str | None:
    target = name.encode("latin-1")
    for key, value in scope.get("headers", []):
        if key.lower() == target:
            return str(value.decode("latin-1"))
    return None


def _query_param(scope: Scope, name: str) -> str | None:
    values = parse_qs(scope.get("query_string", b"").decode("latin-1")).get(name)
    return values[0] if values else None
