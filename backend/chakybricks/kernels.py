import logging
import os
import queue
import sys
import threading
import time
import uuid
from collections.abc import Callable
from typing import Any

from jupyter_client.blocking.client import BlockingKernelClient
from jupyter_client.kernelspec import KernelSpec
from jupyter_client.manager import KernelManager

from chakybricks.cb import MEMORY_ENV, WORKSPACE_ENV
from chakybricks.config import Settings
from chakybricks.errors import NotFoundError
from chakybricks.workspace import Workspace

log = logging.getLogger(__name__)

READY_TIMEOUT = 90
COMPLETE_TIMEOUT = 5
ALIVE_CHECK_SECONDS = 2
BOOTSTRAP = "import chakybricks.kernel_init as __cb_init; __cb_init.setup(); del __cb_init"
HIDDEN_ENV = ("CHAKYBRICKS_TOKEN",)
BOOTSTRAP_CELL = "__bootstrap__"

Listener = Callable[[dict[str, Any]], None]


def kernel_argv() -> list[str]:
    """Kernels re-invoke this process' executable: the frozen backend or the venv Python."""
    if getattr(sys, "frozen", False):
        return [sys.executable, "--kernel", "-f", "{connection_file}"]
    return [sys.executable, "-m", "chakybricks", "--kernel", "-f", "{connection_file}"]


class KernelSession:
    def __init__(self, notebook: str, workspace: Workspace, settings: Settings) -> None:
        self.id = uuid.uuid4().hex
        self.notebook = notebook
        self.workspace = workspace
        self.settings = settings
        self.status = "starting"
        self._manager: KernelManager | None = None
        self._client: BlockingKernelClient | None = None
        self._listeners: set[Listener] = set()
        self._cells: dict[str, str] = {}
        self._pending: list[str] = []
        self._started: dict[str, float] = {}
        self._failed: set[str] = set()
        self._lock = threading.RLock()
        self._shell_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._bootstrapped = threading.Event()
        self._bootstrap_error: list[str] = []

    def add_listener(self, listener: Listener) -> None:
        with self._lock:
            self._listeners.add(listener)

    def remove_listener(self, listener: Listener) -> None:
        with self._lock:
            self._listeners.discard(listener)

    def start(self) -> None:
        manager = KernelManager()
        manager._kernel_spec = KernelSpec(
            argv=kernel_argv(),
            display_name="ChakyBricks (Python 3.12)",
            language="python",
            interrupt_mode="signal",
        )
        manager.start_kernel(cwd=str(self.workspace.notebooks), env=self._environment())
        self._manager = manager
        self._connect()

    def execute(self, cell_id: str, code: str) -> str:
        with self._lock:
            client = self._require_client()
            msg_id: str = client.execute(code, store_history=True, allow_stdin=False)
            self._cells[msg_id] = cell_id
            self._pending.append(msg_id)
        self._emit({"type": "queued", "cell_id": cell_id})
        return msg_id

    def complete(self, code: str, cursor_pos: int) -> dict[str, Any]:
        with self._shell_lock:
            client = self._require_client()
            msg_id = client.complete(code, cursor_pos)
            deadline = time.monotonic() + COMPLETE_TIMEOUT
            while time.monotonic() < deadline:
                try:
                    reply = client.get_shell_msg(timeout=0.2)
                except queue.Empty:
                    continue
                if reply["parent_header"].get("msg_id") == msg_id:
                    content: dict[str, Any] = reply["content"]
                    return {
                        "matches": content.get("matches", []),
                        "cursor_start": content.get("cursor_start", cursor_pos),
                        "cursor_end": content.get("cursor_end", cursor_pos),
                    }
        return {"matches": [], "cursor_start": cursor_pos, "cursor_end": cursor_pos}

    def interrupt(self) -> None:
        if self._manager is not None:
            self._manager.interrupt_kernel()

    def restart(self) -> None:
        self._set_status("restarting")
        self._disconnect()
        self._abort_pending()
        if self._manager is None:
            raise NotFoundError("Kernel is not running")
        self._manager.restart_kernel(now=True, env=self._environment())
        self._connect()

    def shutdown(self) -> None:
        self._disconnect()
        if self._manager is not None:
            try:
                self._manager.shutdown_kernel(now=True)
            except Exception:
                log.exception("Kernel %s did not shut down cleanly", self.id)
        self._set_status("dead")

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "notebook": self.notebook, "status": self.status}

    def _environment(self) -> dict[str, str]:
        env = {k: v for k, v in os.environ.items() if k not in HIDDEN_ENV}
        env[WORKSPACE_ENV] = str(self.workspace.root)
        env[MEMORY_ENV] = str(self.settings.effective_memory_limit_mb)
        env["PLOTLY_RENDERER"] = "plotly_mimetype"
        env["PYTHONIOENCODING"] = "utf-8"
        env["MPLBACKEND"] = "module://matplotlib_inline.backend_inline"
        return env

    def _connect(self) -> None:
        assert self._manager is not None
        client = self._manager.blocking_client()
        client.start_channels()
        client.wait_for_ready(timeout=READY_TIMEOUT)
        with self._lock:
            self._client = client
        self._stop = threading.Event()
        self._bootstrapped = threading.Event()
        self._bootstrap_error = []
        with self._lock:
            bootstrap = client.execute(BOOTSTRAP, silent=True, store_history=False)
            self._cells[bootstrap] = BOOTSTRAP_CELL
        self._thread = threading.Thread(
            target=self._read_iopub,
            args=(client, self._stop),
            name=f"kernel-{self.id[:8]}",
            daemon=True,
        )
        self._thread.start()
        if not self._bootstrapped.wait(READY_TIMEOUT):
            raise RuntimeError("The notebook kernel did not finish starting")
        if self._bootstrap_error:
            raise RuntimeError("Kernel setup failed:\n" + "\n".join(self._bootstrap_error))
        self._set_status("idle")

    def _disconnect(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        with self._lock:
            client, self._client = self._client, None
        if client is not None:
            client.stop_channels()

    def _require_client(self) -> BlockingKernelClient:
        if self._client is None or self.status in ("dead", "restarting"):
            raise NotFoundError("Kernel is not running; restart it")
        return self._client

    def _read_iopub(self, client: BlockingKernelClient, stop: threading.Event) -> None:
        last_check = time.monotonic()
        while not stop.is_set():
            try:
                message = client.get_iopub_msg(timeout=0.25)
            except queue.Empty:
                if time.monotonic() - last_check > ALIVE_CHECK_SECONDS:
                    last_check = time.monotonic()
                    if self._manager is not None and not self._manager.is_alive():
                        self._abort_pending()
                        self._set_status("dead")
                        return
                continue
            except Exception:
                if stop.is_set():
                    return
                log.exception("Reading kernel messages failed")
                continue
            try:
                self._handle(message)
            except Exception:
                log.exception("Handling kernel message failed")

    def _handle(self, message: dict[str, Any]) -> None:
        kind = message["msg_type"]
        content = message["content"]
        parent = message["parent_header"].get("msg_id")
        with self._lock:
            cell_id = self._cells.get(parent) if parent else None

        if kind == "status":
            state = content["execution_state"]
            if cell_id == BOOTSTRAP_CELL:
                if state == "idle":
                    self._finish(parent, cell_id)
                return
            if state in ("busy", "idle"):
                self._set_status(state if state == "busy" or not self._pending else "busy")
            if state == "idle" and parent and cell_id:
                self._finish(parent, cell_id)
            return
        if cell_id is None:
            return
        if cell_id == BOOTSTRAP_CELL:
            if kind == "error":
                self._bootstrap_error.extend(content.get("traceback", []))
            return
        if kind == "execute_input":
            with self._lock:
                self._started[parent] = time.monotonic()
            self._emit(
                {
                    "type": "started",
                    "cell_id": cell_id,
                    "execution_count": content.get("execution_count"),
                }
            )
        elif kind == "stream":
            self._output(
                cell_id, {"output_type": "stream", "name": content["name"], "text": content["text"]}
            )
        elif kind in ("execute_result", "display_data"):
            output = {
                "output_type": kind,
                "data": content.get("data", {}),
                "metadata": content.get("metadata", {}),
            }
            if kind == "execute_result":
                output["execution_count"] = content.get("execution_count")
            self._output(cell_id, output)
        elif kind == "error":
            with self._lock:
                self._failed.add(parent)
            self._output(
                cell_id,
                {
                    "output_type": "error",
                    "ename": content.get("ename", ""),
                    "evalue": content.get("evalue", ""),
                    "traceback": content.get("traceback", []),
                },
            )
        elif kind == "clear_output":
            self._emit(
                {"type": "clear_output", "cell_id": cell_id, "wait": content.get("wait", False)}
            )

    def _finish(self, msg_id: str, cell_id: str) -> None:
        with self._lock:
            started = self._started.pop(msg_id, None)
            failed = msg_id in self._failed
            self._failed.discard(msg_id)
            self._cells.pop(msg_id, None)
            aborted: list[tuple[str, str]] = []
            if msg_id in self._pending:
                index = self._pending.index(msg_id)
                self._pending.pop(index)
                if failed:
                    aborted = [(m, self._cells.pop(m, "")) for m in self._pending[index:]]
                    del self._pending[index:]
            if not self._pending:
                self.status = "idle"
        if cell_id == BOOTSTRAP_CELL:
            self._bootstrapped.set()
            return
        duration = int((time.monotonic() - started) * 1000) if started else None
        self._emit(
            {
                "type": "done",
                "cell_id": cell_id,
                "status": "error" if failed else "ok",
                "duration_ms": duration,
            }
        )
        for _, aborted_cell in aborted:
            if aborted_cell:
                self._emit(
                    {
                        "type": "done",
                        "cell_id": aborted_cell,
                        "status": "aborted",
                        "duration_ms": None,
                    }
                )
        if not self._pending:
            self._emit({"type": "status", "state": "idle"})

    def _abort_pending(self) -> None:
        with self._lock:
            pending = [(m, self._cells.pop(m, "")) for m in self._pending]
            self._pending.clear()
            self._started.clear()
            self._failed.clear()
        for _, cell_id in pending:
            if cell_id:
                self._emit(
                    {"type": "done", "cell_id": cell_id, "status": "aborted", "duration_ms": None}
                )

    def _output(self, cell_id: str, output: dict[str, Any]) -> None:
        self._emit({"type": "output", "cell_id": cell_id, "output": output})

    def _set_status(self, status: str) -> None:
        with self._lock:
            changed = status != self.status
            self.status = status
        if changed:
            self._emit({"type": "status", "state": status})

    def _emit(self, event: dict[str, Any]) -> None:
        with self._lock:
            listeners = list(self._listeners)
        for listener in listeners:
            try:
                listener(event)
            except Exception:
                log.exception("Kernel event listener failed")


class KernelRegistry:
    def __init__(self, workspace: Workspace, settings: Callable[[], Settings]) -> None:
        self.workspace = workspace
        self.settings = settings
        self._sessions: dict[str, KernelSession] = {}
        self._lock = threading.Lock()

    def start(self, notebook: str) -> KernelSession:
        with self._lock:
            for session in self._sessions.values():
                if session.notebook == notebook and session.status != "dead":
                    return session
            session = KernelSession(notebook, self.workspace, self.settings())
            self._sessions[session.id] = session
        try:
            session.start()
        except Exception:
            with self._lock:
                self._sessions.pop(session.id, None)
            session.shutdown()
            raise
        return session

    def get(self, kernel_id: str) -> KernelSession:
        session = self._sessions.get(kernel_id)
        if session is None:
            raise NotFoundError(f"Kernel {kernel_id} not found")
        return session

    def for_notebook(self, notebook: str) -> KernelSession | None:
        return next(
            (s for s in self._sessions.values() if s.notebook == notebook and s.status != "dead"),
            None,
        )

    def shutdown(self, kernel_id: str) -> None:
        with self._lock:
            session = self._sessions.pop(kernel_id, None)
        if session is not None:
            session.shutdown()

    def rename_notebook(self, old: str, new: str) -> None:
        for session in self._sessions.values():
            if session.notebook == old:
                session.notebook = new

    def notebook_deleted(self, notebook: str) -> None:
        for session in list(self._sessions.values()):
            if session.notebook == notebook:
                self.shutdown(session.id)

    def shutdown_all(self) -> None:
        for kernel_id in list(self._sessions):
            self.shutdown(kernel_id)

    def list(self) -> list[KernelSession]:
        return list(self._sessions.values())
