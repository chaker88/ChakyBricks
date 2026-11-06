import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from chakybricks import __version__
from chakybricks.app import create_app

TOKEN = "test-token"


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(TOKEN))


def test_health_requires_token(client: TestClient) -> None:
    assert client.get("/api/health").status_code == 401


def test_health_rejects_wrong_token(client: TestClient) -> None:
    response = client.get("/api/health", headers={"X-ChakyBricks-Token": "nope"})
    assert response.status_code == 401


def test_health_with_header_token(client: TestClient) -> None:
    response = client.get("/api/health", headers={"X-ChakyBricks-Token": TOKEN})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == __version__


def test_token_in_query_param(client: TestClient) -> None:
    assert client.get(f"/api/system?token={TOKEN}").status_code == 200


def test_cors_preflight_is_allowed_without_token(client: TestClient) -> None:
    response = client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:1420",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-chakybricks-token",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:1420"


def test_websocket_requires_token(client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect) as exc, client.websocket_connect("/ws/echo") as ws:
        ws.receive_text()
    assert exc.value.code == 4401


def test_websocket_echo_with_token(client: TestClient) -> None:
    with client.websocket_connect(f"/ws/echo?token={TOKEN}") as ws:
        ws.send_text("ping")
        assert ws.receive_text() == "ping"


def test_create_app_requires_token() -> None:
    with pytest.raises(ValueError):
        create_app("")
