import queue
import time
from collections.abc import Iterator
from typing import Any

import pyarrow as pa
import pytest
from fastapi.testclient import TestClient

from chakybricks.kernel_init import TABLE_MIME
from chakybricks.kernels import KernelSession
from chakybricks.services import Services
from tests.conftest import TOKEN
from tests.test_sql import add_table


class Recorder:
    def __init__(self, session: KernelSession) -> None:
        self.events: queue.Queue[dict[str, Any]] = queue.Queue()
        session.add_listener(self.events.put)
        self.session = session

    def run(self, cell_id: str, code: str, timeout: float = 60) -> list[dict[str, Any]]:
        self.session.execute(cell_id, code)
        return self.until_done(cell_id, timeout)

    def until_done(self, cell_id: str, timeout: float = 60) -> list[dict[str, Any]]:
        seen: list[dict[str, Any]] = []
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                event = self.events.get(timeout=0.5)
            except queue.Empty:
                continue
            if event.get("cell_id") != cell_id:
                continue
            seen.append(event)
            if event["type"] == "done":
                return seen
        raise AssertionError(f"cell {cell_id} did not finish: {seen}")


def outputs(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [e["output"] for e in events if e["type"] == "output"]


def stdout(events: list[dict[str, Any]]) -> str:
    return "".join(
        o["text"] for o in outputs(events) if o["output_type"] == "stream" and o["name"] == "stdout"
    )


@pytest.fixture
def kernel(services: Services) -> Iterator[tuple[Services, KernelSession, Recorder]]:
    add_table(services, "main", "sales", pa.table({"id": [1, 2, 3], "amount": [1.0, 2.0, 3.0]}))
    services.notebooks.create("Test")
    session = services.kernels.start("Test")
    recorder = Recorder(session)
    yield services, session, recorder
    services.kernels.shutdown_all()


def test_execute_streams_outputs_and_results(
    kernel: tuple[Services, KernelSession, Recorder],
) -> None:
    _, session, recorder = kernel
    events = recorder.run("c1", "print('hello')\n1 + 41")
    kinds = [e["type"] for e in events]
    assert kinds[0] == "queued" and kinds[-1] == "done"
    started = next(e for e in events if e["type"] == "started")
    assert started["execution_count"] == 1
    assert stdout(events) == "hello\n"
    result = next(o for o in outputs(events) if o["output_type"] == "execute_result")
    assert result["data"]["text/plain"] == "42"
    assert events[-1]["status"] == "ok"
    assert events[-1]["duration_ms"] >= 0
    assert session.status == "idle"


def test_cb_and_sql_magic_render_tables(kernel: tuple[Services, KernelSession, Recorder]) -> None:
    _, _, recorder = kernel
    events = recorder.run("c1", "cb.sql('SELECT sum(amount) AS total FROM sales')")
    payload = outputs(events)[0]["data"][TABLE_MIME]
    assert payload["rows"] == [[6.0]]
    assert payload["columns"] == [{"name": "total", "type": "DOUBLE"}]

    events = recorder.run("c2", "%%sql top\nSELECT * FROM sales ORDER BY id DESC LIMIT 2")
    assert outputs(events)[0]["data"][TABLE_MIME]["rows"] == [[3, 3.0], [2, 2.0]]
    events = recorder.run("c3", "print(top.height, type(top).__name__)")
    assert stdout(events) == "2 DataFrame\n"

    events = recorder.run("c4", "cb.table('sales').collect().height")
    assert outputs(events)[0]["data"]["text/plain"] == "3"


def test_errors_and_aborted_queue(kernel: tuple[Services, KernelSession, Recorder]) -> None:
    _, session, recorder = kernel
    session.execute("bad", "1 / 0")
    session.execute("later", "print('should not run')")
    bad = recorder.until_done("bad")
    error = outputs(bad)[0]
    assert error["output_type"] == "error"
    assert error["ename"] == "ZeroDivisionError"
    assert bad[-1]["status"] == "error"
    assert recorder.until_done("later")[-1]["status"] == "aborted"

    sql_error = recorder.run("sql", "%%sql\nSELECT * FROM missing_table")
    message = outputs(sql_error)[0]
    assert message["output_type"] == "error"
    assert "missing_table" in "".join(message["traceback"])
    assert len(message["traceback"]) == 1


def test_interrupt_and_restart(kernel: tuple[Services, KernelSession, Recorder]) -> None:
    _, session, recorder = kernel
    recorder.run("set", "x = 5")
    session.execute("slow", "import time\nfor _ in range(600):\n    time.sleep(0.1)")
    deadline = time.monotonic() + 10
    while session.status != "busy" and time.monotonic() < deadline:
        time.sleep(0.05)
    time.sleep(0.5)
    session.interrupt()
    events = recorder.until_done("slow", timeout=20)
    assert outputs(events)[-1]["ename"] == "KeyboardInterrupt"
    assert stdout(recorder.run("alive", "print(x)")) == "5\n"

    session.restart()
    events = recorder.run("after", "print('x' in globals(), 'cb' in globals())")
    assert stdout(events) == "False True\n"
    assert next(e for e in events if e["type"] == "started")["execution_count"] == 1


def test_plots_render_inline(kernel: tuple[Services, KernelSession, Recorder]) -> None:
    _, _, recorder = kernel
    events = recorder.run("mpl", "import matplotlib.pyplot as plt\nplt.plot([1, 2, 3])\nplt.show()")
    assert any("image/png" in o.get("data", {}) for o in outputs(events))
    events = recorder.run(
        "plotly", "import plotly.express as px\npx.bar(x=['a', 'b'], y=[1, 2])", timeout=90
    )
    assert any("application/vnd.plotly.v1+json" in o.get("data", {}) for o in outputs(events))


def test_save_in_kernel_is_visible_to_backend(
    kernel: tuple[Services, KernelSession, Recorder],
) -> None:
    services, _, recorder = kernel
    events = recorder.run(
        "save",
        "import polars as pl\n"
        "r = cb.save(pl.DataFrame({'k': ['a', 'b'], 'v': [1, 2]}), 'reports.kv')\n"
        "print(r['table'], r['rows'])",
    )
    assert stdout(events) == "reports.kv 2\n", events
    assert services.catalog.get_table("reports", "kv").row_count == 2
    result = services.sql.run("SELECT sum(v) FROM reports.kv", "after-save")
    assert result["rows"] == [[3]]


def test_kernel_does_not_see_the_session_token(
    kernel: tuple[Services, KernelSession, Recorder], monkeypatch: pytest.MonkeyPatch
) -> None:
    services, _, _ = kernel
    monkeypatch.setenv("CHAKYBRICKS_TOKEN", "secret-token")
    services.kernels.shutdown_all()
    session = services.kernels.start("Test")
    recorder = Recorder(session)
    events = recorder.run("env", "import os\nprint(os.environ.get('CHAKYBRICKS_TOKEN'))")
    assert stdout(events) == "None\n"


def test_completion(kernel: tuple[Services, KernelSession, Recorder]) -> None:
    _, session, recorder = kernel
    recorder.run("def", "revenue_total = 1")
    reply = session.complete("revenue_t", 9)
    assert "revenue_total" in reply["matches"]
    assert reply["cursor_start"] == 0


def test_kernel_websocket(client: TestClient) -> None:
    client.post("/api/notebooks", json={"name": "WS"})
    kernel = client.post("/api/kernels", json={"notebook": "WS"}).json()
    assert kernel["status"] == "idle"
    assert client.post("/api/kernels", json={"notebook": "WS"}).json()["id"] == kernel["id"]
    with client.websocket_connect(f"/ws/kernels/{kernel['id']}?token={TOKEN}") as ws:
        assert ws.receive_json() == {"type": "status", "state": "idle"}
        ws.send_json({"type": "execute", "cell_id": "a", "code": "print(6 * 7)"})
        seen: list[dict[str, Any]] = []
        while not seen or seen[-1].get("type") != "done":
            event = ws.receive_json()
            if event.get("cell_id") == "a":
                seen.append(event)
        assert any(e.get("output", {}).get("text") == "42\n" for e in seen)
        ws.send_json({"type": "complete", "request_id": 1, "code": "pri", "cursor_pos": 3})
        while (event := ws.receive_json())["type"] != "complete_reply":
            pass
        assert "print" in event["matches"]
    assert client.post(f"/api/kernels/{kernel['id']}/interrupt").status_code == 200
    assert client.delete(f"/api/kernels/{kernel['id']}").status_code == 204
    assert client.post(f"/api/kernels/{kernel['id']}/restart").status_code == 404
