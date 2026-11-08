# 10 GB load test

Acceptance test from SPEC.md: import a ~10 GB CSV, run a GROUP BY over all rows and load a dashboard on it, on a 16 GB machine, without running out of memory.

## Reproduce

```powershell
backend\.venv\Scripts\python scripts\make_test_data.py D:\testdata\sales_events.csv --size-gb 10
backend\.venv\Scripts\python scripts\load_test.py D:\testdata\sales_events.csv --home D:\testdata\apphome --workspace D:\testdata\workspace
```

`load_test.py` starts the backend with its own app home (your normal settings are untouched), keeps the Delta table and the DuckDB spill files under `--workspace`, samples the memory of the backend every 0.25 s and prints a JSON report.

## Result (2026-11-08)

Machine: 12 logical cores, 15.4 GB RAM (DuckDB memory limit 9.2 GB = 60% default). Data: 88,509,578 rows, 14 columns, 10.2 GB CSV → 5.0 GB Delta (Parquet, snappy).

| Step                                           | Time   | Peak backend memory |
| ---------------------------------------------- | ------ | ------------------- |
| Import CSV → Delta                             | 60.8 s | 2.0 GB              |
| `SELECT count(*)`                              | 0.5 s  | 0.4 GB              |
| GROUP BY category, region, status (160 groups) | 2.5 s  | 1.1 GB              |
| GROUP BY month (72 groups)                     | 1.1 s  | 1.0 GB              |
| GROUP BY customer_id, top 10 (2 M groups)      | 5.8 s  | 4.4 GB              |
| `count(DISTINCT (customer_id, product_id))`    | 4.9 s  | 3.0 GB              |
| Dashboard, 10 tiles, first load                | 20.6 s | 8.1 GB              |
| Dashboard, second load (result cache)          | 0.08 s | 0.5 GB              |
| Dashboard with a date filter, first load       | 12.5 s | 2.3 GB              |
| Dashboard with a date filter, second load      | 0.06 s | —                   |

No out-of-memory errors; no spill to disk in the final run. The dashboard's first load has four tiles scanning the whole table at once, which uses most of the memory limit — the machine had about 1 GB free at the worst moment.

## What the test found

The first run of the dashboard step spilled more than 100 GB to the `tmp/` folder: tiles with a breakdown (stacked bar, heatmap) read their source through a CTE that DuckDB materialized (`SELECT *` of all 88 M rows) when four such tiles ran together. The CTE is now `NOT MATERIALIZED`, which removed the spill entirely and brought the first load to ~21 s.
