"""Acceptance load test: import a big CSV, GROUP BY over all rows, load a dashboard.

    backend/.venv/Scripts/python scripts/load_test.py CSV --home APP_HOME --workspace WORKSPACE

Starts the backend with its own app home (so the normal settings are never touched), stores the
Delta table, DuckDB spill files and metadata under WORKSPACE, and samples the memory of the
backend process tree every 0.25 s. Prints a JSON report.
"""

import argparse
import json
import os
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import psutil

PORT = 8897
TOKEN = secrets.token_hex(16)


def call(method: str, path: str, body: object | None = None, timeout: float = 3600) -> Any:
    request = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"X-ChakyBricks-Token": TOKEN, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read() or b"null")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"{method} {path}: {exc.code} {exc.read().decode()[:500]}") from exc


class MemoryMonitor:
    def __init__(self, root: psutil.Process, spill_dir: Path) -> None:
        self.root = root
        self.spill_dir = spill_dir
        self.peak_spill = 0
        self.peak_rss = 0
        self.peak_private = 0
        self.min_available = psutil.virtual_memory().available
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join()

    def reset(self) -> None:
        self.peak_rss = 0
        self.peak_private = 0
        self.peak_spill = 0
        self.min_available = psutil.virtual_memory().available

    def _run(self) -> None:
        while not self._stop.wait(0.25):
            try:
                procs = [self.root, *self.root.children(recursive=True)]
                rss = private = 0
                for proc in procs:
                    try:
                        info = proc.memory_full_info()
                    except (psutil.Error, OSError):
                        continue
                    rss += info.rss
                    private += getattr(info, "uss", info.rss)
                self.peak_rss = max(self.peak_rss, rss)
                self.peak_private = max(self.peak_private, private)
                self.peak_spill = max(self.peak_spill, self._spill())
                self.min_available = min(self.min_available, psutil.virtual_memory().available)
            except psutil.Error:
                continue

    def _spill(self) -> int:
        total = 0
        for entry in self.spill_dir.glob("*"):
            try:
                total += entry.stat().st_size
            except OSError:
                continue
        return total

    def snapshot(self, total: int) -> dict[str, float]:
        return {
            "peak_working_set_gb": round(self.peak_rss / 1024**3, 2),
            "peak_private_gb": round(self.peak_private / 1024**3, 2),
            "peak_spill_gb": round(self.peak_spill / 1024**3, 2),
            "min_system_available_gb": round(self.min_available / 1024**3, 2),
            "system_used_peak_gb": round((total - self.min_available) / 1024**3, 2),
        }


def timed(fn: Any) -> tuple[Any, float]:
    started = time.perf_counter()
    result = fn()
    return result, round(time.perf_counter() - started, 2)


def tile(kind: str, source: str, config: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": kind,
        "source": {"kind": "table", "table": source},
        "config": config,
        "conditions": [],
    }


def metric(agg: str, column: str | None, label: str) -> dict[str, Any]:
    return {"agg": agg, "column": column, "label": label}


def dashboard_tiles(table: str) -> dict[str, dict[str, Any]]:
    total = metric("sum", "total", "Revenue")
    return {
        "kpi revenue": tile("kpi", table, {"metrics": [total]}),
        "kpi orders": tile("kpi", table, {"metrics": [metric("count", None, "Orders")]}),
        "kpi customers": tile(
            "kpi", table, {"metrics": [metric("count_distinct", "customer_id", "Customers")]}
        ),
        "kpi avg price": tile("kpi", table, {"metrics": [metric("avg", "unit_price", "Avg price")]}),
        "revenue by month": tile(
            "chart",
            table,
            {
                "chart": "combo",
                "dimension": {"column": "event_time", "grain": "month"},
                "metrics": [total],
            },
        ),
        "revenue by category": tile(
            "chart", table, {"chart": "bar", "dimension": {"column": "category"}, "metrics": [total]}
        ),
        "status donut": tile(
            "chart", table, {"chart": "donut", "dimension": {"column": "status"}, "metrics": [total]}
        ),
        "region x channel": tile(
            "chart",
            table,
            {
                "chart": "stacked_bar",
                "dimension": {"column": "region"},
                "breakdown": {"column": "channel"},
                "metrics": [total],
            },
        ),
        "top products": tile(
            "chart",
            table,
            {
                "chart": "bar",
                "dimension": {"column": "product_id"},
                "metrics": [total],
                "limit": 10,
            },
        ),
        "country x category heatmap": tile(
            "chart",
            table,
            {
                "chart": "heatmap",
                "dimension": {"column": "country"},
                "breakdown": {"column": "category"},
                "metrics": [total],
            },
        ),
    }


def load_dashboard(tiles: dict[str, dict[str, Any]], conditions: list[dict[str, Any]]) -> dict:
    def one(item: tuple[str, dict[str, Any]]) -> tuple[str, float, float]:
        name, body = item
        started = time.perf_counter()
        result = call("POST", "/api/dashboards/query", {**body, "conditions": conditions})
        cached = bool(result.get("cached", False))
        return name, round(time.perf_counter() - started, 2), float(cached)

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=10) as pool:
        per_tile = list(pool.map(one, tiles.items()))
    return {
        "wall_seconds": round(time.perf_counter() - started, 2),
        "tiles": {name: seconds for name, seconds, _ in per_tile},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", type=Path)
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--table", default="sales_events")
    args = parser.parse_args()

    args.home.mkdir(parents=True, exist_ok=True)
    args.workspace.mkdir(parents=True, exist_ok=True)
    (args.home / "config.json").write_text(
        json.dumps({"workspace": str(args.workspace)}), encoding="utf-8"
    )
    env = {
        **os.environ,
        "CHAKYBRICKS_TOKEN": TOKEN,
        "CHAKYBRICKS_HOME": str(args.home),
        "TEMP": str(args.workspace / "tmp"),
        "TMP": str(args.workspace / "tmp"),
    }
    (args.workspace / "tmp").mkdir(exist_ok=True)
    backend = subprocess.Popen(
        [sys.executable, "-m", "chakybricks", "--port", str(PORT)],
        env=env,
        stdin=subprocess.DEVNULL,
    )
    total_memory = psutil.virtual_memory().total
    monitor = MemoryMonitor(psutil.Process(backend.pid), args.workspace / "tmp")
    monitor.start()
    report: dict[str, Any] = {"csv_gb": round(args.csv.stat().st_size / 1024**3, 2)}
    try:
        for _ in range(100):
            try:
                call("GET", "/api/health", timeout=2)
                break
            except (OSError, RuntimeError):
                time.sleep(0.3)
        settings = call("GET", "/api/settings")
        report["workspace"] = settings["workspace"]
        report["memory_limit_mb"] = settings["effective_memory_limit_mb"]
        report["total_ram_gb"] = round(total_memory / 1024**3, 1)

        preview, seconds = timed(
            lambda: call("POST", "/api/imports/preview", {"path": str(args.csv)})
        )
        report["preview_seconds"] = seconds
        report["estimated_rows"] = preview["estimated_rows"]

        exists = any(
            t["name"] == args.table
            for sch in call("GET", "/api/catalog")["schemas"]
            for t in sch["tables"]
        )
        if exists:
            print("table exists; skipping the import", flush=True)
        else:
            monitor.reset()
            started = time.perf_counter()
            job = call(
                "POST",
                "/api/imports",
                {
                    "path": str(args.csv),
                    "format": "csv",
                    "columns": preview["source_columns"],
                    "schema_name": "main",
                    "table": args.table,
                },
            )
            last = 0.0
            while job["state"] in ("queued", "running"):
                time.sleep(2)
                job = call("GET", f"/api/imports/{job['id']}")
                if time.perf_counter() - last > 30:
                    last = time.perf_counter()
                    print(f"  import {job['rows_written']:,} rows", flush=True)
            report["import"] = {
                "state": job["state"],
                "error": job["error"],
                "rows": job["rows_written"],
                "seconds": round(time.perf_counter() - started, 1),
                **monitor.snapshot(total_memory),
            }
            print("import:", report["import"], flush=True)
            if job["state"] != "succeeded":
                    raise SystemExit(1)

        table = call("GET", f"/api/tables/main/{args.table}")
        report["table"] = {
            "rows": table["row_count"],
            "delta_gb": round(table["size_bytes"] / 1024**3, 2),
        }

        queries = {
            "count": f"SELECT count(*) FROM {args.table}",
            "group by category/region/status": (
                f"SELECT category, region, status, count(*) AS n, sum(total) AS revenue, "
                f"avg(unit_price) AS price FROM {args.table} GROUP BY ALL ORDER BY ALL"
            ),
            "group by month": (
                f"SELECT date_trunc('month', event_time) AS m, sum(total) FROM {args.table} "
                f"GROUP BY 1 ORDER BY 1"
            ),
            "group by customer (2M groups)": (
                f"SELECT customer_id, count(*) AS n, sum(total) AS revenue FROM {args.table} "
                f"GROUP BY 1 ORDER BY revenue DESC LIMIT 10"
            ),
            "count distinct customer x product": (
                f"SELECT count(DISTINCT (customer_id, product_id)) FROM {args.table}"
            ),
        }
        report["queries"] = {}
        for name, sql in queries.items():
            monitor.reset()
            result, seconds = timed(lambda sql=sql: call("POST", "/api/sql/run", {"sql": sql}))
            report["queries"][name] = {
                "seconds": seconds,
                "rows_returned": result.get("total_rows", result.get("row_count")),
                **monitor.snapshot(total_memory),
            }
            print(name, report["queries"][name], flush=True)

        tiles = dashboard_tiles(f"main.{args.table}")
        range_filter = [
            {
                "column": "event_time",
                "kind": "date_range",
                "start": "2024-01-01",
                "end": "2024-12-31",
            }
        ]
        report["dashboard"] = {}
        for label, conditions in [
            ("first load, no filters", []),
            ("second load (cached)", []),
            ("with date filter (first)", range_filter),
            ("with date filter (cached)", range_filter),
        ]:
            monitor.reset()
            report["dashboard"][label] = {
                **load_dashboard(tiles, conditions),
                **monitor.snapshot(total_memory),
            }
            print("dashboard", label, report["dashboard"][label]["wall_seconds"], flush=True)
    finally:
        monitor.stop()
        report["overall_peak"] = monitor.snapshot(total_memory)
        backend.terminate()
        try:
            backend.wait(timeout=30)
        except subprocess.TimeoutExpired:
            backend.kill()
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
