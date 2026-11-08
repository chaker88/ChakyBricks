from __future__ import annotations

import json
import logging
import queue
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal

from apscheduler.schedulers.background import BackgroundScheduler
from tzlocal import get_localzone

from chakybricks.catalog import Catalog, now_iso
from chakybricks.errors import (
    ChakyError,
    ConflictError,
    InvalidInputError,
    NotFoundError,
    QueryCancelledError,
)
from chakybricks.schedules import Schedule

if TYPE_CHECKING:
    from chakybricks.services import Services

log = logging.getLogger(__name__)

JobKind = Literal["notebook", "query"]
MAX_NAME_LENGTH = 120
MAX_RUNS_KEPT = 200
MAX_LOG_CHARS = 200_000
LOG_FLUSH_SECONDS = 1.0
MAX_CONCURRENT_RUNS = 3
MAX_OUTPUT_CHARS = 4_000
MISFIRE_GRACE_SECONDS = 300
_ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


@dataclass(frozen=True)
class Job:
    id: int
    name: str
    kind: str
    target: str
    schedule: Schedule
    enabled: bool
    created_at: str
    updated_at: str


class JobStore:
    """Jobs and their run history in meta.db."""

    def __init__(self, catalog: Catalog) -> None:
        self.catalog = catalog

    def list_jobs(self) -> list[Job]:
        with self.catalog.connect() as conn:
            rows = conn.execute("SELECT * FROM jobs ORDER BY name COLLATE NOCASE").fetchall()
        return [_job(r) for r in rows]

    def get(self, job_id: int) -> Job:
        with self.catalog.connect() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise NotFoundError(f"Job {job_id} does not exist")
        return _job(row)

    def create(self, name: str, kind: str, target: str, schedule: Schedule, enabled: bool) -> Job:
        timestamp = now_iso()
        name = _clean_name(name)
        try:
            with self.catalog.connect() as conn:
                cursor = conn.execute(
                    "INSERT INTO jobs (name, kind, target, schedule, enabled, created_at, "
                    "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        name,
                        kind,
                        target,
                        schedule.model_dump_json(),
                        int(enabled),
                        timestamp,
                        timestamp,
                    ),
                )
                job_id = int(cursor.lastrowid or 0)
        except Exception as exc:
            if "UNIQUE" in str(exc):
                raise ConflictError(f"A job named '{name}' already exists") from exc
            raise
        return self.get(job_id)

    def update(self, job_id: int, **changes: Any) -> Job:
        current = self.get(job_id)
        name = _clean_name(changes["name"]) if changes.get("name") is not None else current.name
        schedule: Schedule = changes.get("schedule") or current.schedule
        enabled = changes["enabled"] if changes.get("enabled") is not None else current.enabled
        try:
            with self.catalog.connect() as conn:
                conn.execute(
                    "UPDATE jobs SET name = ?, kind = ?, target = ?, schedule = ?, enabled = ?, "
                    "updated_at = ? WHERE id = ?",
                    (
                        name,
                        changes.get("kind") or current.kind,
                        changes.get("target") or current.target,
                        schedule.model_dump_json(),
                        int(enabled),
                        now_iso(),
                        job_id,
                    ),
                )
        except Exception as exc:
            if "UNIQUE" in str(exc):
                raise ConflictError(f"A job named '{name}' already exists") from exc
            raise
        return self.get(job_id)

    def delete(self, job_id: int) -> None:
        self.get(job_id)
        with self.catalog.connect() as conn:
            conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))

    def notebook_renamed(self, old: str, new: str) -> None:
        with self.catalog.connect() as conn:
            conn.execute(
                "UPDATE jobs SET target = ? WHERE kind = 'notebook' AND target = ?", (new, old)
            )

    def last_runs(self) -> dict[int, dict[str, Any]]:
        with self.catalog.connect() as conn:
            rows = conn.execute(
                "SELECT r.id, r.job_id, r.trigger, r.status, r.started_at, r.finished_at, "
                "r.duration_ms, r.message FROM job_runs r "
                "WHERE r.id = (SELECT MAX(id) FROM job_runs WHERE job_id = r.job_id)"
            ).fetchall()
        return {r["job_id"]: dict(r) for r in rows}

    def create_run(
        self, job_id: int, trigger: str, status: str = "running", message: str = ""
    ) -> int:
        timestamp = now_iso()
        finished = timestamp if status != "running" else None
        with self.catalog.connect() as conn:
            cursor = conn.execute(
                "INSERT INTO job_runs (job_id, trigger, status, started_at, finished_at, "
                "duration_ms, message) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (job_id, trigger, status, timestamp, finished, 0 if finished else None, message),
            )
            run_id = int(cursor.lastrowid or 0)
            conn.execute(
                "DELETE FROM job_runs WHERE job_id = ? AND id NOT IN "
                "(SELECT id FROM job_runs WHERE job_id = ? ORDER BY id DESC LIMIT ?)",
                (job_id, job_id, MAX_RUNS_KEPT),
            )
        return run_id

    def set_log(self, run_id: int, text: str) -> None:
        with self.catalog.connect() as conn:
            conn.execute("UPDATE job_runs SET log = ? WHERE id = ?", (text, run_id))

    def finish_run(
        self, run_id: int, status: str, message: str, text: str, duration_ms: int
    ) -> None:
        with self.catalog.connect() as conn:
            conn.execute(
                "UPDATE job_runs SET status = ?, message = ?, log = ?, finished_at = ?, "
                "duration_ms = ? WHERE id = ?",
                (status, message, text, now_iso(), duration_ms, run_id),
            )

    def get_run(self, run_id: int) -> dict[str, Any]:
        with self.catalog.connect() as conn:
            row = conn.execute("SELECT * FROM job_runs WHERE id = ?", (run_id,)).fetchone()
        if row is None:
            raise NotFoundError(f"Run {run_id} does not exist")
        return dict(row)

    def list_runs(self, job_id: int, limit: int = 50) -> list[dict[str, Any]]:
        self.get(job_id)
        with self.catalog.connect() as conn:
            rows = conn.execute(
                "SELECT id, job_id, trigger, status, started_at, finished_at, duration_ms, message "
                "FROM job_runs WHERE job_id = ? ORDER BY id DESC LIMIT ?",
                (job_id, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def fail_stale_runs(self) -> None:
        """Runs still marked running belong to an app that was closed mid-run."""
        with self.catalog.connect() as conn:
            conn.execute(
                "UPDATE job_runs SET status = 'failed', finished_at = ?, "
                "message = 'ChakyBricks was closed while this run was in progress' "
                "WHERE status = 'running'",
                (now_iso(),),
            )


class _Cancelled(Exception):
    pass


class _RunLog:
    """Collects a run's log and saves it to meta.db at most once a second while it grows."""

    def __init__(self, store: JobStore, run_id: int) -> None:
        self.store = store
        self.run_id = run_id
        self._parts: list[str] = []
        self._size = 0
        self._truncated = False
        self._last_flush = 0.0
        self._lock = threading.Lock()

    def line(self, text: str = "") -> None:
        self.write(text + "\n")

    def stamp(self, text: str) -> None:
        self.line(f"[{datetime.now().strftime('%H:%M:%S')}] {text}")

    def write(self, text: str) -> None:
        with self._lock:
            if self._truncated:
                return
            room = MAX_LOG_CHARS - self._size
            if len(text) > room:
                text = text[: max(room, 0)] + "\n… log truncated …\n"
                self._truncated = True
            self._parts.append(text)
            self._size += len(text)
        self.flush()

    def flush(self, force: bool = False) -> None:
        if not force and time.monotonic() - self._last_flush < LOG_FLUSH_SECONDS:
            return
        self._last_flush = time.monotonic()
        self.store.set_log(self.run_id, self.text)

    @property
    def text(self) -> str:
        with self._lock:
            return "".join(self._parts)


class _ActiveRun:
    def __init__(self, run_id: int, job_id: int) -> None:
        self.run_id = run_id
        self.job_id = job_id
        self.query_id = uuid.uuid4().hex
        self.cancelled = False
        self.session: Any = None


def _clean_name(name: str) -> str:
    cleaned = " ".join(name.split())
    if not cleaned:
        raise InvalidInputError("Enter a name for the job")
    if len(cleaned) > MAX_NAME_LENGTH:
        raise InvalidInputError(f"Job names are limited to {MAX_NAME_LENGTH} characters")
    return cleaned


def _job(row: Any) -> Job:
    return Job(
        id=row["id"],
        name=row["name"],
        kind=row["kind"],
        target=row["target"],
        schedule=Schedule.model_validate(json.loads(row["schedule"])),
        enabled=bool(row["enabled"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


class JobManager:
    """Schedules jobs while the app is open and runs notebooks and saved queries on demand."""

    def __init__(self, services: Services) -> None:
        self.services = services
        self.store = JobStore(services.catalog)
        self._scheduler = BackgroundScheduler(
            timezone=get_localzone(),
            job_defaults={
                "coalesce": True,
                "max_instances": 1,
                "misfire_grace_time": MISFIRE_GRACE_SECONDS,
            },
        )
        self._executor = ThreadPoolExecutor(
            max_workers=MAX_CONCURRENT_RUNS, thread_name_prefix="job-run"
        )
        self._active: dict[int, _ActiveRun] = {}
        self._lock = threading.Lock()

    def start(self) -> None:
        self.store.fail_stale_runs()
        self._scheduler.start()
        for job in self.store.list_jobs():
            self._schedule(job)

    def shutdown(self) -> None:
        with self._lock:
            active = list(self._active.values())
        for handle in active:
            self._cancel_handle(handle)
        self._scheduler.shutdown(wait=False)
        self._executor.shutdown(wait=True, cancel_futures=True)

    # --- CRUD -------------------------------------------------------------------------------

    def create(
        self, name: str, kind: JobKind, target: str, schedule: Schedule, enabled: bool = True
    ) -> dict[str, Any]:
        schedule.validated()
        self._check_target(kind, target)
        job = self.store.create(name, kind, target, schedule, enabled)
        self._schedule(job)
        return self.describe(job)

    def update(self, job_id: int, **changes: Any) -> dict[str, Any]:
        current = self.store.get(job_id)
        if changes.get("schedule") is not None:
            changes["schedule"].validated()
        if changes.get("kind") or changes.get("target"):
            self._check_target(
                changes.get("kind") or current.kind, changes.get("target") or current.target
            )
        job = self.store.update(job_id, **changes)
        self._schedule(job)
        return self.describe(job)

    def delete(self, job_id: int) -> None:
        self.store.get(job_id)
        for handle in self._handles_for(job_id):
            self._cancel_handle(handle)
        self._unschedule(job_id)
        self.store.delete(job_id)

    def list_jobs(self) -> list[dict[str, Any]]:
        last = self.store.last_runs()
        return [self.describe(job, last.get(job.id)) for job in self.store.list_jobs()]

    def get(self, job_id: int) -> dict[str, Any]:
        job = self.store.get(job_id)
        return self.describe(job, self.store.last_runs().get(job_id))

    def describe(self, job: Job, last_run: dict[str, Any] | None = None) -> dict[str, Any]:
        scheduled = self._scheduler.get_job(_scheduler_id(job.id))
        next_run = getattr(scheduled, "next_run_time", None) if scheduled else None
        return {
            "id": job.id,
            "name": job.name,
            "kind": job.kind,
            "target": job.target,
            "schedule": job.schedule.model_dump(),
            "schedule_text": job.schedule.describe(),
            "enabled": job.enabled,
            "next_run_at": next_run.isoformat() if next_run else None,
            "last_run": last_run,
            "running": bool(self._handles_for(job.id)),
            "created_at": job.created_at,
            "updated_at": job.updated_at,
        }

    # --- running ----------------------------------------------------------------------------

    def run_now(self, job_id: int) -> dict[str, Any]:
        return self._start_run(job_id, "manual")

    def cancel_run(self, run_id: int) -> dict[str, Any]:
        with self._lock:
            handle = self._active.get(run_id)
        if handle is None:
            raise ConflictError("This run has already finished")
        self._cancel_handle(handle)
        return self.store.get_run(run_id)

    def _fire(self, job_id: int) -> None:
        try:
            self._start_run(job_id, "schedule")
        except ConflictError:
            self.store.create_run(
                job_id, "schedule", "skipped", "Skipped: the previous run was still in progress"
            )
        except ChakyError:
            log.exception("Could not start scheduled job %s", job_id)

    def _start_run(self, job_id: int, trigger: str) -> dict[str, Any]:
        job = self.store.get(job_id)
        with self._lock:
            if any(h.job_id == job_id for h in self._active.values()):
                raise ConflictError("This job is already running")
            run_id = self.store.create_run(job_id, trigger)
            handle = _ActiveRun(run_id, job_id)
            self._active[run_id] = handle
        self._executor.submit(self._execute, job, handle)
        return self.store.get_run(run_id)

    def _execute(self, job: Job, handle: _ActiveRun) -> None:
        run_log = _RunLog(self.store, handle.run_id)
        started = time.monotonic()
        status, message = "succeeded", ""
        run_log.stamp(f"Started {job.kind} job '{job.name}'")
        try:
            message = (
                self._run_query(job, handle, run_log)
                if job.kind == "query"
                else self._run_notebook(job, handle, run_log)
            )
        except (_Cancelled, QueryCancelledError):
            status, message = "cancelled", "Cancelled"
        except ChakyError as exc:
            status, message = "failed", str(exc)
        except Exception as exc:
            log.exception("Job %s failed unexpectedly", job.id)
            status, message = "failed", f"{type(exc).__name__}: {exc}"
        elapsed = time.monotonic() - started
        run_log.stamp(
            f"{status.capitalize()} after {elapsed:.1f} s" + (f": {message}" if message else "")
        )
        try:
            self.store.finish_run(
                handle.run_id, status, message[:500], run_log.text, int(elapsed * 1000)
            )
        except Exception:
            log.exception("Could not save the result of run %s", handle.run_id)
        finally:
            with self._lock:
                self._active.pop(handle.run_id, None)

    def _run_query(self, job: Job, handle: _ActiveRun, run_log: _RunLog) -> str:
        saved = self.services.queries.get_saved(int(job.target))
        run_log.line(f"Saved query: {saved.name}")
        run_log.line(saved.sql.strip()[:2000])
        if handle.cancelled:
            raise _Cancelled
        result = self.services.sql.run(saved.sql, handle.query_id, limit=1)
        for write in result.get("writes", []):
            run_log.line(write["message"])
        if result["kind"] == "write":
            return str(result["message"])
        run_log.line(f"Returned {result['row_count']:,} rows")
        return f"{result['row_count']:,} rows"

    def _run_notebook(self, job: Job, handle: _ActiveRun, run_log: _RunLog) -> str:
        notebook = self.services.notebooks.read(job.target)
        cells = [c for c in notebook["cells"] if c["cell_type"] == "code" and c["source"].strip()]
        run_log.line(f"Notebook: {job.target} ({len(cells)} code cells)")
        if handle.cancelled:
            raise _Cancelled
        session = self.services.kernels.start_job_kernel(job.target)
        handle.session = session
        events: queue.Queue[dict[str, Any]] = queue.Queue()
        session.add_listener(events.put)
        try:
            for index, cell in enumerate(cells, start=1):
                if handle.cancelled:
                    raise _Cancelled
                source = cell["source"]
                is_sql = (cell.get("metadata", {}).get("chakybricks") or {}).get(
                    "language"
                ) == "sql"
                run_log.line(f"\n--- Cell {index}/{len(cells)} ---")
                run_log.line(source.strip().splitlines()[0][:200])
                cell_id = f"job-cell-{index}"
                session.execute(cell_id, f"%%sql\n{source}" if is_sql else source)
                self._wait_for_cell(session, events, cell_id, index, handle, run_log)
        finally:
            session.remove_listener(events.put)
            self.services.kernels.shutdown(session.id)
            handle.session = None
        return f"{len(cells)} cells ran"

    def _wait_for_cell(
        self,
        session: Any,
        events: queue.Queue[dict[str, Any]],
        cell_id: str,
        index: int,
        handle: _ActiveRun,
        run_log: _RunLog,
    ) -> None:
        error = ""
        while True:
            if handle.cancelled:
                raise _Cancelled
            try:
                event = events.get(timeout=1)
            except queue.Empty:
                if session.status == "dead":
                    raise ChakyError("The notebook kernel stopped unexpectedly") from None
                continue
            if event.get("cell_id") != cell_id:
                continue
            kind = event["type"]
            if kind == "output":
                error = _log_output(event["output"], run_log) or error
            elif kind == "done":
                if event["status"] == "error":
                    raise ChakyError(f"Cell {index} failed: {error or 'see the log'}")
                return

    # --- scheduling -------------------------------------------------------------------------

    def _schedule(self, job: Job) -> None:
        self._unschedule(job.id)
        trigger = job.schedule.trigger() if job.enabled else None
        if trigger is not None:
            self._scheduler.add_job(
                self._fire, trigger, args=[job.id], id=_scheduler_id(job.id), replace_existing=True
            )

    def _unschedule(self, job_id: int) -> None:
        if self._scheduler.get_job(_scheduler_id(job_id)):
            self._scheduler.remove_job(_scheduler_id(job_id))

    def _check_target(self, kind: str, target: str) -> None:
        if kind == "query":
            try:
                self.services.queries.get_saved(int(target))
            except ValueError as exc:
                raise InvalidInputError("Choose a saved query") from exc
        elif kind == "notebook":
            self.services.notebooks.read(target)
        else:
            raise InvalidInputError("A job runs a notebook or a saved query")

    def _handles_for(self, job_id: int) -> list[_ActiveRun]:
        with self._lock:
            return [h for h in self._active.values() if h.job_id == job_id]

    def _cancel_handle(self, handle: _ActiveRun) -> None:
        handle.cancelled = True
        self.services.sql.cancel(handle.query_id)
        session = handle.session
        if session is not None:
            try:
                session.interrupt()
            except Exception:
                log.exception("Could not interrupt the job kernel")


def _scheduler_id(job_id: int) -> str:
    return f"job-{job_id}"


def _log_output(output: dict[str, Any], run_log: _RunLog) -> str:
    """Writes one kernel output to the log; returns a short error summary for failures."""
    kind = output.get("output_type")
    if kind == "stream":
        run_log.write(output.get("text", ""))
    elif kind == "error":
        trace = _ANSI.sub("", "\n".join(output.get("traceback", [])))
        run_log.line(trace[-MAX_OUTPUT_CHARS:] or f"{output.get('ename')}: {output.get('evalue')}")
        return f"{output.get('ename', 'Error')}: {output.get('evalue', '')}"
    elif kind in ("execute_result", "display_data"):
        text = output.get("data", {}).get("text/plain")
        if text:
            run_log.line(str(text)[:MAX_OUTPUT_CHARS])
    return ""
