"""Generate a synthetic sales-events CSV for load testing.

    backend/.venv/Scripts/python scripts/make_test_data.py OUT.csv --size-gb 10

Rows are written in chunks by DuckDB (one process, multi-threaded), so memory stays small. The
row count is calibrated from a 200k-row sample to land near the requested size.
"""

import argparse
import sys
import time
from pathlib import Path

import duckdb

CHUNK_ROWS = 5_000_000
HEADER = (
    "event_id,event_time,customer_id,product_id,category,region,channel,country,"
    "quantity,unit_price,discount,total,status,note"
)


def select(first: int, count: int) -> str:
    return f"""
    SELECT
        id AS event_id,
        TIMESTAMP '2020-01-01' + to_seconds((hash(id) % 189216000)::BIGINT) AS event_time,
        1 + hash(id * 7) % 2000000 AS customer_id,
        1 + hash(id * 13) % 50000 AS product_id,
        ['Electronics','Grocery','Home','Toys','Fashion','Sports','Books','Beauty']
            [1 + (hash(id * 17) % 8)::BIGINT] AS category,
        ['North','South','East','West','Central'][1 + (hash(id * 19) % 5)::BIGINT] AS region,
        ['Web','Store','Mobile','Partner'][1 + (hash(id * 23) % 4)::BIGINT] AS channel,
        ['US','CA','GB','DE','FR','ES','IT','TN','AE','JP','BR','IN'][1 + (hash(id * 29) % 12)::BIGINT]
            AS country,
        1 + hash(id * 31) % 12 AS quantity,
        round(1 + (hash(id * 37) % 49900) / 100.0, 2) AS unit_price,
        round((hash(id * 41) % 31) / 100.0, 2) AS discount,
        round((1 + hash(id * 31) % 12) * (1 + (hash(id * 37) % 49900) / 100.0)
            * (1 - (hash(id * 41) % 31) / 100.0), 2) AS total,
        ['completed','completed','completed','pending','returned','cancelled']
            [1 + (hash(id * 43) % 6)::BIGINT] AS status,
        substr(md5(id::VARCHAR) || md5((id * 3)::VARCHAR), 1, 8 + (hash(id * 47) % 40)::BIGINT) AS note
    FROM range({first}, {first + count}) t(id)
    """


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--size-gb", type=float, default=10.0)
    args = parser.parse_args()

    con = duckdb.connect()
    sample = args.output.with_suffix(".sample.csv")
    con.execute(f"COPY ({select(0, 200_000)}) TO '{sample.as_posix()}' (HEADER, DELIMITER ',')")
    bytes_per_row = sample.stat().st_size / 200_000
    sample.unlink()
    total_rows = int(args.size_gb * 1024**3 / bytes_per_row)
    print(f"{bytes_per_row:.1f} bytes/row -> {total_rows:,} rows", flush=True)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    with args.output.open("wb") as out:
        out.write(HEADER.encode() + b"\n")
        part = args.output.with_suffix(".part")
        first = 0
        while first < total_rows:
            count = min(CHUNK_ROWS, total_rows - first)
            con.execute(
                f"COPY ({select(first, count)}) TO '{part.as_posix()}' (HEADER false, DELIMITER ',')"
            )
            with part.open("rb") as chunk:
                while block := chunk.read(8 * 1024 * 1024):
                    out.write(block)
            first += count
            elapsed = time.perf_counter() - started
            print(f"{first:,}/{total_rows:,} rows, {out.tell() / 1024**3:.2f} GB, "
                  f"{elapsed:.0f}s", flush=True)
        part.unlink()
    return 0


if __name__ == "__main__":
    sys.exit(main())
