"""Packaging smoke test: run with the bundled runtime from a release build.

    src-tauri/target/release/python/python.exe scripts/smoke_test.py

Starts the backend like the desktop shell does, imports a CSV, starts a notebook kernel (which
creates the workspace environment), runs cb.sql, a matplotlib plot, `%pip install xgboost` and
`import xgboost`, then shuts everything down.
"""

import asyncio
import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any

import websockets

PORT = 8899
TOKEN = secrets.token_hex(16)
home = Path(tempfile.mkdtemp(prefix="chakybricks-smoke-"))


def call(method: str, path: str, body: object | None = None, timeout: float = 300) -> Any:
    request = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"X-ChakyBricks-Token": TOKEN, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read() or b"null")


async def run_cells(kernel_id: str, cells: list[tuple[str, str]]) -> dict[str, list[dict[str, Any]]]:
    url = f"ws://127.0.0.1:{PORT}/ws/kernels/{kernel_id}?token={TOKEN}"
    results: dict[str, list[dict[str, Any]]] = {}
    async with websockets.connect(url, max_size=None) as ws:
        for cell_id, code in cells:
            started = time.perf_counter()
            await ws.send(json.dumps({"type": "execute", "cell_id": cell_id, "code": code}))
            events: list[dict[str, Any]] = []
            while True:
                event = json.loads(await asyncio.wait_for(ws.recv(), timeout=600))
                if event.get("cell_id") != cell_id:
                    continue
                events.append(event)
                if event["type"] == "done":
                    break
            results[cell_id] = events
            print(f"  {cell_id}: {events[-1]['status']} in {time.perf_counter() - started:.1f}s")
    return results


def text(events: list[dict[str, Any]]) -> str:
    parts = []
    for event in events:
        output = event.get("output", {})
        if output.get("output_type") == "stream":
            parts.append(output["text"])
        elif output.get("output_type") == "error":
            parts.append("\n".join(output["traceback"]))
    return "".join(parts)


def mimes(events: list[dict[str, Any]]) -> set[str]:
    return {m for e in events for m in e.get("output", {}).get("data", {})}


def main() -> int:
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONHOME", "PYTHONPATH")}
    env.update(CHAKYBRICKS_TOKEN=TOKEN, CHAKYBRICKS_HOME=str(home), PYTHONNOUSERSITE="1")
    started = time.perf_counter()
    log = (home / "backend.log").open("w", encoding="utf-8")
    backend = subprocess.Popen(
        [sys.executable, "-m", "chakybricks", "--port", str(PORT), "--watch-stdin"],
        env=env,
        stdin=subprocess.PIPE,
        stdout=log,
        stderr=subprocess.STDOUT,
        creationflags=0x08000000,
    )
    failures: list[str] = []
    try:
        for _ in range(150):
            try:
                call("GET", "/api/health", timeout=2)
                break
            except OSError:
                time.sleep(0.2)
        print(f"backend ready in {time.perf_counter() - started:.1f}s ({sys.executable})")

        csv = home / "sales.csv"
        csv.write_text("region,amount\nnorth,10\nsouth,20\nnorth,5\n")
        preview = call("POST", "/api/imports/preview", {"path": str(csv)})
        job = call(
            "POST",
            "/api/imports",
            {
                "path": str(csv),
                "format": "csv",
                "columns": preview["source_columns"],
                "schema_name": "main",
                "table": "sales",
            },
        )
        while job["state"] in ("queued", "running"):
            time.sleep(0.2)
            job = call("GET", f"/api/imports/{job['id']}")
        print(f"import: {job['state']}")

        call("POST", "/api/notebooks", {"name": "Smoke"})
        t = time.perf_counter()
        kernel = call("POST", "/api/kernels", {"notebook": "Smoke"})
        print(f"kernel {kernel['status']} in {time.perf_counter() - t:.1f}s (includes creating the venv)")

        results = asyncio.run(
            run_cells(
                kernel["id"],
                [
                    ("sql", "df = cb.sql('SELECT region, sum(amount) AS total FROM sales GROUP BY 1 ORDER BY 1')\nprint(df.to_dicts())"),
                    ("plot", "import matplotlib.pyplot as plt\nplt.plot([1, 3, 2])\nplt.show()"),
                    ("pip", "%pip install xgboost"),
                    ("import", "import xgboost, sys\nprint(xgboost.__version__, xgboost.__file__)"),
                ],
            )
        )
        sql_out = text(results["sql"])
        if "'north', 'total': 15" not in sql_out:
            failures.append(f"cb.sql: {sql_out}")
        if "image/png" not in mimes(results["plot"]):
            failures.append("matplotlib produced no image")
        if "Successfully installed" not in text(results["pip"]):
            failures.append(f"pip: {text(results['pip'])[-800:]}")
        import_out = text(results["import"])
        print(f"  xgboost: {import_out.strip()}")
        if ".venv" not in import_out:
            failures.append(f"xgboost not imported from the workspace venv: {import_out}")
        packages = call("GET", "/api/packages")
        installed = {p["name"].lower() for p in packages["installed"]}
        print(f"  installed in venv: {sorted(installed)}")
        if "xgboost" not in installed:
            failures.append("xgboost missing from /api/packages")
    except Exception as exc:
        failures.append(f"{type(exc).__name__}: {exc}")
    finally:
        backend.terminate()
        backend.wait(15)
        log.close()
    if failures:
        tail = (home / "backend.log").read_text(encoding="utf-8", errors="replace")[-3000:]
        print("--- backend log (tail) ---\n" + tail)
    print("SMOKE TEST PASSED" if not failures else "SMOKE TEST FAILED:\n" + "\n".join(failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
