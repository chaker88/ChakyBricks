# ChakyBricks — Product & Technical Spec

ChakyBricks is a single-user, offline desktop lakehouse for Windows: import data up to ~10 GB, work with it in Python notebooks and a SQL editor, and build Looker-style dashboards. Distributed as a downloadable `.exe` installer.

## Non-negotiable requirements

1. Ships as a Windows `.exe` installer (no Python/Node needed on the user's machine).
2. Imported data is queryable from both Python and SQL — same tables, same names.
3. Handles datasets up to 10 GB on a 16 GB RAM machine without crashing (larger-than-memory execution).
4. Polished, modern UI (dark + light themes), comparable in feel to Databricks / Linear / Vercel.
5. Dashboard builder similar to Looker Studio: tiles from queries, several chart types, global filters, drag/resize layout.

## Non-goals (v1)

Multi-user/auth, clusters/distributed compute, cloud storage connectors, MLflow, Spark compatibility, macOS/Linux builds (keep code portable, but only Windows is built and tested).

## Stack

| Layer            | Choice                                                                       |
| ---------------- | ---------------------------------------------------------------------------- |
| Desktop shell    | Tauri v2 (NSIS `.exe` installer)                                             |
| Frontend         | React + TypeScript + Vite, Tailwind, shadcn/ui, lucide icons                 |
| Editors          | Monaco (SQL + Python, with autocomplete of table/column names)               |
| Result grid      | TanStack Table + virtualization (handles 100k+ displayed rows)               |
| Charts           | Apache ECharts                                                               |
| Dashboard layout | react-grid-layout                                                            |
| Backend          | Python 3.12, FastAPI + uvicorn, frozen with PyInstaller as a Tauri sidecar   |
| Query engine     | DuckDB                                                                       |
| DataFrames       | Polars and pandas (both available in notebooks)                              |
| Table format     | Delta Lake via `deltalake` (delta-rs)                                        |
| Notebooks        | Jupyter kernels via `jupyter_client` + `ipykernel`; files stored as `.ipynb` |
| Metadata         | SQLite (catalog, saved queries, dashboards, jobs, run history)               |
| Scheduler        | APScheduler (jobs run only while the app is open — state this in the UI)     |

## Architecture

- **Sidecar:** Tauri launches the frozen backend on a random free localhost port with a random session token. Every API/WebSocket request must carry the token. Backend shuts down when the app closes.
- **Kernels in a frozen app:** `sys.executable` is the backend exe, so kernels are launched by re-invoking it with a `--kernel -f <connection_file>` flag that dispatches to `ipykernel.kernelapp.launch_new_instance()`. Do not rely on a system Python.
- **Storage layout** (in `%APPDATA%/ChakyBricks/` by default, user-configurable workspace folder):
  - `warehouse/<schema>/<table>/` — Delta tables
  - `notebooks/` — `.ipynb` files
  - `meta.db` — SQLite metadata
  - `tmp/` — DuckDB spill directory
- **No shared DuckDB file.** DuckDB allows only one read-write process per database file, and the backend and kernels are separate processes. Each process opens its own in-memory DuckDB connection and registers every catalog table as a view over `DeltaTable(path).to_pyarrow_dataset()` (lazy, with filter/projection pushdown). Writes go through `deltalake.write_deltalake`. Catalog changes are read from `meta.db`, so new tables appear in all processes.
- **Memory safety:** set DuckDB `memory_limit` (default 60% of RAM, configurable), `temp_directory` to `tmp/`, and `preserve_insertion_order=false` for large imports. Never materialize a full table into the frontend; the SQL editor returns the first 10,000 rows plus total row count, with "Export full result" to CSV/Parquet.

## Features

### 1. Data import & catalog

- Import via native file dialog (path passed to backend, no HTTP upload of the file body). Formats: CSV, TSV, Parquet, JSON/NDJSON, Excel (`.xlsx`, small files only).
- Import wizard: preview first 100 rows, inferred schema with editable column types, target schema + table name, optional partition column.
- Large-file ingestion streams through DuckDB into Parquet/Delta with a progress bar and cancel button; runs in a background task and never blocks the UI.
- Catalog sidebar: schemas → tables → columns (type icons). Table page: schema, row count, size on disk, sample data, Delta version history, "Open in SQL", "Open in notebook", drop/rename.
- Delta time travel: `SELECT ... FROM table VERSION AS OF n` is not native DuckDB syntax, so expose time travel through a helper (`cb.table("sales", version=3)`) and in the table page's history tab.

### 2. SQL editor

- Multiple tabs, Monaco with schema-aware autocomplete, run selection / run all (Ctrl+Enter), cancel running query.
- Results: virtualized grid, column stats on header click, quick chart toggle, export CSV/Parquet, "Save as table" (CTAS into Delta), "Save query" (named, used by dashboards).
- Query history panel.

### 3. Python notebooks

- Cells: Python, SQL (`%%sql` or a cell-type toggle; result shown as the same grid as the SQL editor), Markdown.
- Kernel preloaded with a `cb` helper module:
  - `cb.sql("SELECT ...")` → Polars DataFrame (`.to_pandas()` available)
  - `cb.table("schema.table")` → lazy Polars frame
  - `cb.save(df, "schema.table", mode="overwrite"|"append")` → writes Delta, registers in catalog
  - `cb.tables()` → catalog listing
- Rich outputs: DataFrames render as the grid component, matplotlib/plotly figures render inline, stdout/stderr streamed, tracebacks formatted.
- Kernel controls: run cell, run all, interrupt, restart; execution counter and per-cell timing.
- Bundled packages (users cannot pip install into the frozen app in v1): pandas, polars, numpy, pyarrow, duckdb, deltalake, matplotlib, plotly, scikit-learn, scipy.

### 4. Dashboards (Looker-style)

- Dashboard = grid of tiles; drag, resize, duplicate, delete; edit mode vs view mode.
- Tile types: chart (bar, stacked bar, line, area, pie/donut, scatter, heatmap, combo bar+line), KPI scorecard (value + comparison delta), table, text/markdown.
- Each tile is bound to a saved query or a table with a no-code builder: dimension, metric(s) with aggregation (sum, avg, count, count distinct, min, max), breakdown, sort, limit.
- Global filter controls: date range, dropdown (single/multi select), numeric range. Filters are injected into tile queries as parameters (never string-concatenated SQL).
- Cross-filtering: clicking a bar/slice filters other tiles (toggleable).
- Theme per dashboard (palette, background), auto-refresh interval, export dashboard to PNG and PDF.
- Tile queries cached by (query, filters, table version) for fast re-render.

### 5. Jobs

- Schedule a notebook or saved query (cron or simple presets); run history with status, duration, logs; run now; enable/disable.

### 6. App shell & UX

- Left icon rail: Home, Catalog, SQL, Notebooks, Dashboards, Jobs, Settings.
- Home: recent items, quick actions (Import data, New notebook, New query, New dashboard).
- Command palette (Ctrl+K), keyboard shortcuts, toasts, empty states with guidance, loading skeletons.
- Settings: workspace folder, memory limit, theme, default row limit.
- Design: Inter font, consistent spacing scale, subtle borders instead of heavy shadows, a single brand accent color, smooth but minimal transitions. App name and a simple logo mark ("ChakyBricks") in the title bar and installer.

## Build & release

- `npm run tauri dev` for development with the backend run from source.
- `scripts/build_backend.ps1`: PyInstaller (onedir preferred for startup speed) → copied into Tauri sidecar binaries with the correct target-triple name.
- `npm run tauri build` → NSIS `.exe` installer in `src-tauri/target/release/bundle/nsis/`.
- GitHub Actions workflow on `windows-latest`: on tag `v*`, build backend + frontend, produce installer, attach to GitHub Release.

## Quality bar

- Backend: pytest for catalog, ingestion, SQL execution, `cb` helpers, dashboard query builder.
- Frontend: vitest for logic; type-check with `tsc --noEmit`; ESLint + Prettier.
- `scripts/make_test_data.py`: generates a synthetic ~10 GB CSV (e.g. sales events) for load testing. Acceptance: import it, run a GROUP BY over all rows, and render a dashboard on it, on a 16 GB RAM machine, without out-of-memory errors.
- Installed `.exe` smoke test: install, launch, import a CSV, query in SQL and Python, build a dashboard.

## Delivery phases (commit and verify at the end of each)

1. **Skeleton:** repo layout, Tauri + React shell with navigation and theming, FastAPI sidecar with token handshake, dev scripts, CLAUDE.md.
2. **Data:** storage layout, catalog in SQLite, import wizard with streaming ingestion, catalog UI.
3. **SQL:** SQL editor, result grid, saved queries, history, export.
4. **Notebooks:** kernel management (including frozen-exe kernel launch), notebook UI, `cb` helpers, SQL cells, rich outputs.
5. **Dashboards:** builder, chart tiles, KPI, filters, cross-filtering, export.
6. **Jobs:** scheduler and run history.
7. **Packaging:** PyInstaller sidecar, NSIS installer, GitHub Actions release workflow, 10 GB load test, polish pass.

## Repo layout

```
CHaky-Bricks/
  src/                # React frontend
  src-tauri/          # Tauri app + sidecar config
  backend/
    chakybricks/      # FastAPI app, catalog, engine, kernels, dashboards, jobs, cb helper
    tests/
  scripts/
  .github/workflows/
  SPEC.md
  CLAUDE.md
  README.md
```
