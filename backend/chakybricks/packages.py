import queue
import re
import subprocess
import threading
import time
import uuid
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from chakybricks.errors import ConflictError, InvalidInputError, NotFoundError
from chakybricks.kernel_env import KernelEnvironment, subprocess_flags

MAX_JOBS = 30
MAX_OUTPUT_CHARS = 200_000
_REQUIREMENT = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._-]*"
    r"(\[[A-Za-z0-9._,-]+\])?"
    r"((===|==|>=|<=|~=|!=|>|<)[A-Za-z0-9.*+!_-]+)?"
    r"(,(===|==|>=|<=|~=|!=|>|<)[A-Za-z0-9.*+!_-]+)*$"
)
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class PackageAction(StrEnum):
    INSTALL = "install"
    UNINSTALL = "uninstall"
    RESET = "reset"


class JobState(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass
class PackageJob:
    action: PackageAction
    packages: list[str]
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    state: JobState = JobState.QUEUED
    output: str = ""
    error: str | None = None
    started_at: float | None = None
    finished_at: float | None = None

    @property
    def done(self) -> bool:
        return self.state in (JobState.SUCCEEDED, JobState.FAILED)

    def append(self, text: str) -> None:
        self.output = (self.output + text)[-MAX_OUTPUT_CHARS:]

    def to_dict(self) -> dict[str, Any]:
        end = self.finished_at or time.time()
        return {
            "id": self.id,
            "action": self.action.value,
            "packages": self.packages,
            "state": self.state.value,
            "output": self.output,
            "error": self.error,
            "elapsed_seconds": round(end - self.started_at, 1) if self.started_at else 0,
        }


def parse_requirements(text: str) -> list[str]:
    specs = text.replace(",", " ,").split()
    merged: list[str] = []
    for spec in specs:
        if spec.startswith(",") and merged:
            merged[-1] += spec
        else:
            merged.append(spec)
    if not merged:
        raise InvalidInputError("Enter at least one package, e.g. xgboost or polars==2.1.0")
    for spec in merged:
        if not _REQUIREMENT.match(spec):
            raise InvalidInputError(
                f"'{spec}' is not a package requirement; use names like xgboost, "
                "lightgbm==4.5.0 or scikit-learn>=1.5"
            )
    return merged


class PackageManager:
    """Runs pip in the notebook environment, one job at a time, keeping the output."""

    def __init__(self, environment: KernelEnvironment, before_reset: Callable[[], None]) -> None:
        self.environment = environment
        self.before_reset = before_reset
        self._jobs: OrderedDict[str, PackageJob] = OrderedDict()
        self._queue: queue.Queue[PackageJob | None] = queue.Queue()
        self._worker = threading.Thread(target=self._work, name="packages", daemon=True)
        self._worker.start()

    def listing(self) -> dict[str, Any]:
        installed = self.environment.installed()
        overridden = {p.name.lower() for p in installed}
        return {
            "environment": self.environment.info(),
            "installed": [p.to_dict() for p in installed],
            "defaults": [
                {**p.to_dict(), "overridden": p.name.lower() in overridden}
                for p in self.environment.defaults()
            ],
        }

    def install(self, text: str) -> PackageJob:
        return self._submit(PackageAction.INSTALL, parse_requirements(text))

    def uninstall(self, name: str) -> PackageJob:
        if not _NAME.match(name):
            raise InvalidInputError(f"'{name}' is not a package name")
        if name.lower() not in {p.name.lower() for p in self.environment.installed()}:
            if name.lower() in {p.name.lower() for p in self.environment.defaults()}:
                raise ConflictError(
                    f"{name} is a default package and cannot be uninstalled; "
                    "use Reset to defaults to remove upgrades"
                )
            raise NotFoundError(f"{name} is not installed in the notebook environment")
        return self._submit(PackageAction.UNINSTALL, [name])

    def reset(self) -> PackageJob:
        return self._submit(PackageAction.RESET, [])

    def get(self, job_id: str) -> PackageJob:
        job = self._jobs.get(job_id)
        if job is None:
            raise NotFoundError(f"Package job {job_id} not found")
        return job

    def wait(self, job_id: str, timeout: float = 300) -> PackageJob:
        deadline = time.time() + timeout
        job = self.get(job_id)
        while not job.done and time.time() < deadline:
            time.sleep(0.05)
        return job

    def shutdown(self) -> None:
        self._queue.put(None)

    def _submit(self, action: PackageAction, packages: list[str]) -> PackageJob:
        job = PackageJob(action, packages)
        self._jobs[job.id] = job
        while len(self._jobs) > MAX_JOBS:
            oldest = next(iter(self._jobs.values()))
            if not oldest.done:
                break
            self._jobs.popitem(last=False)
        self._queue.put(job)
        return job

    def _work(self) -> None:
        while (job := self._queue.get()) is not None:
            job.state = JobState.RUNNING
            job.started_at = time.time()
            try:
                self._run(job)
                job.state = JobState.SUCCEEDED
            except Exception as exc:
                job.error = str(exc) or type(exc).__name__
                job.state = JobState.FAILED
            job.finished_at = time.time()

    def _run(self, job: PackageJob) -> None:
        if job.action == PackageAction.RESET:
            job.append("Shutting down running kernels…\n")
            self.before_reset()
            job.append("Recreating the notebook environment…\n")
            self.environment.reset()
            job.append("Done. The environment has the default packages only.\n")
            return
        self.environment.ensure()
        python = str(self.environment.python)
        if job.action == PackageAction.INSTALL:
            command = [python, "-m", "pip", "install", *job.packages]
        else:
            command = [python, "-m", "pip", "uninstall", "-y", *job.packages]
        job.append(f"$ pip {' '.join(command[3:])}\n")
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=self.environment.environment(),
            creationflags=subprocess_flags(),
        )
        assert process.stdout is not None
        for line in process.stdout:
            job.append(line)
        if process.wait() != 0:
            raise RuntimeError(f"pip exited with code {process.returncode}")
