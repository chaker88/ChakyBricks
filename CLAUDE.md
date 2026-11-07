# ChakyBricks — notes for Claude

Single-user offline desktop lakehouse for Windows. **SPEC.md is the source of truth**; follow it exactly and ask before deviating. Work is delivered phase by phase (see SPEC.md "Delivery phases"); at the end of each phase run all checks, confirm the app launches, commit, and stop for review.

## Current status

### Phases completed

- Phase 1 (skeleton) — done, reviewed.
- Phase 2 (data: storage, SQLite catalog, import wizard, catalog UI) — done, reviewed and hand-tested (incl. an 800 MB CSV, Arabic column names, TIMESTAMPTZ). Follow-up fixes: Unicode column names, Arrow-based serialization, pytz/tzdata.
- Phase 3 (SQL editor, result grid, saved queries, history, export) — done, hand-tested and approved (decisions 2–5 approved). Decision 1 follow-up done: the editor supports Delta-backed write statements (see `statements.py` / `writes.py`).
- Phase 4 (notebooks: kernels, cb helper, SQL cells, rich outputs, notebook UI) — implemented and committed; **awaiting the user's hand test and review** (the notebook UI has not been clicked through by Claude).
- Next: Phase 5 (dashboards).

### Phase 4 — still to test by hand

- Notebook list: new, open, rename, delete; Home / Ctrl+K “New notebook”; table page “Open in notebook” (creates “Explore schema.table” with starter cells).
- Kernel: status badge (starting → idle/busy), Run all, Interrupt a long loop, Restart / Restart & clear / Restart & run all, kernel survives navigating away and back.
- Cells: Python / SQL / Markdown switch, Shift+Enter / Ctrl+Enter / Alt+Enter, insert bars, move, delete, execution counts and timings, errors stop the queue (later cells show “Not run”).
- `cb.sql`, `cb.table(..., version=)`, `cb.save` (new table appears in Catalog and SQL editor), `cb.tables()`; `%%sql name` assigns a variable.
- Outputs: DataFrames as grid (Polars, pandas, Arrow), print/stderr streaming, coloured tracebacks, matplotlib images, plotly figures (light/dark), HTML (e.g. scikit-learn estimators), markdown.
- Autocomplete: Python via kernel, table names inside `cb.table("`, SQL cells via catalog.
- Autosave (“Saving…/Saved”), reopen notebook keeps outputs; .ipynb opens in Jupyter.

## Commands (run from repo root, PowerShell)

| Task                                     | Command                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| First-time setup (venv + pip + npm)      | `scripts\setup.ps1`                                                                     |
| Run app (Tauri dev, backend from source) | `scripts\dev.ps1` or `npm run tauri dev`                                                |
| All checks (tests, types, lint, format)  | `scripts\check.ps1`                                                                     |
| Backend tests                            | `cd backend; .venv\Scripts\python -m pytest -q`                                         |
| Backend lint/types                       | `.venv\Scripts\ruff check .`, `.venv\Scripts\ruff format .`, `.venv\Scripts\mypy`       |
| Frontend tests / types / lint / format   | `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`                       |
| Rust                                     | `cd src-tauri; cargo test; cargo clippy --all-targets -- -D warnings; cargo fmt`        |
| Run backend alone                        | `$env:CHAKYBRICKS_TOKEN="dev"; backend\.venv\Scripts\python -m chakybricks --port 8765` |

Python is always `py -3.12` (system) or `backend\.venv\Scripts\python.exe` (project). Never rely on a bare `python`. Set `CHAKYBRICKS_HOME` to use a scratch app home (tests do this via `create_app(token, home)` / `Services(home)`).

## Architecture

- `src-tauri/` — Tauri v2 shell. `src/backend.rs` picks a free localhost port and a random 64-hex token, spawns the backend, exposes `backend_info` command, kills the backend on `RunEvent::Exit`.
  - Debug builds: spawns `backend/.venv/Scripts/python.exe -m chakybricks` (override with `CHAKYBRICKS_PYTHON`).
  - Release builds: spawns `<resource_dir>/backend/chakybricks-backend.exe` (PyInstaller onedir, wired up in Phase 7).
  - Backend gets `--port N --watch-stdin` and the token via env `CHAKYBRICKS_TOKEN` (not argv). `--watch-stdin` makes the backend exit when the shell's stdin pipe closes (covers shell crashes).
  - Always spawned with `CREATE_NO_WINDOW` (dev and release); stdout/stderr piped and forwarded to the shell's stderr prefixed `[backend]`.
  - Plugins: `tauri-plugin-dialog` (native file/folder pickers, `dialog:allow-open`). Custom title bar (`decorations: false`). CSP allows `http/ws://127.0.0.1:*`.
- `backend/chakybricks/`
  - `app.py` `create_app(token, home)`; lifespan builds `Services` on `app.state.services`. `ChakyError` subclasses (`errors.py`) map to HTTP status codes (404/409/422). `auth.py` token middleware on every HTTP/WS request.
  - `config.py` — app home = `CHAKYBRICKS_HOME` or `%APPDATA%/ChakyBricks`; `config.json` there holds `workspace` (defaults to app home) and `memory_limit_mb` (null = 60% of RAM).
  - `workspace.py` — `warehouse/<schema>/<table>/` Delta tables, `notebooks/`, `tmp/` (DuckDB spill + dropped-table trash), `meta.db`. Catalog stores table `location` relative to `warehouse/`.
  - `catalog.py` — SQLite (WAL) catalog: `schemas`, `tables` (cached version/row_count/size/columns JSON). Migrations via `PRAGMA user_version` list `MIGRATIONS` (append only). Default schema is **`main`** (DuckDB's default, so unqualified table names work; `default` is a SQL keyword). Identifiers: `^[a-z_][a-z0-9_]{0,62}$`, no `__` prefix.
  - `engine.py` — `Engine`: one in-memory DuckDB root connection with `CREATE VIEW schema.table AS SELECT * FROM __cb_<schema>__<table>`; each view is backed by `DeltaTable(path).to_pyarrow_dataset()`. Registered Arrow objects are **per-connection**, so always query through `with engine.cursor() as cur:` (syncs with meta.db, then registers every dataset on a fresh cursor). `bulk_connection()` = separate connection with `preserve_insertion_order=false`, `TimeZone=UTC`. memory_limit/temp_directory applied to all.
  - `delta.py` — Delta helpers: `table_stats` (from add actions), `history`, `dataset(path, version)` for time travel.
  - `ingest/sources.py` — format detection, DuckDB readers (`read_csv/read_parquet/read_json`; Excel via pandas+openpyxl, ≤50 MB), column-name sanitizing — every name must work unquoted in SQL and Python: NFKC + lowercase; anything but Unicode letters, combining marks, decimal digits and `_` → `_`; repeated `_` collapsed and trimmed; empty → `column_N`; `c_` prefix if it starts with a non-letter or is a DuckDB-reserved/Python keyword; de-duplicated. `column_name_error` validates user-typed names; frontend mirror (characters only) in `lib/import.ts`. Arabic/accented names must survive, type overrides (whitelisted cast types), Delta-safe type mapping (`storage_type`: unsigned → wider signed/decimal, TIME/UUID/INTERVAL → VARCHAR…), row estimates, preview.
  - `ingest/jobs.py` — `ImportManager`: single background worker thread (imports never run concurrently). Streams `relation.to_arrow_reader()` → generator (counts rows, checks cancel) → `write_deltalake`. Cancel = event + `con.interrupt()`; failures of new tables remove the folder. Exceptions raised inside the stream abort the Delta commit (verified).
  - `serialization.py` — `relation_to_json` goes through Arrow (`to_arrow_table`) and formats every type itself: timestamps as ISO (tz-aware → UTC with `Z`, ns precision kept), TIME/INTERVAL as text, DECIMAL as a number only when exact, ints beyond 2^53 as strings, BLOB as escaped hex text, LIST/STRUCT/MAP recursively. Never use DuckDB `fetchall()` for user data (TIMESTAMPTZ needs pytz) or pyarrow `to_pylist()` on tz-aware/ns arrays (needs zoneinfo/pandas).
  - `statements.py` — `parse_statements` (DuckDB `extract_statements`) returns `Statement`s: SELECT/EXPLAIN run in DuckDB (DESCRIBE/SUMMARIZE/FROM-first count as SELECT); CREATE/INSERT/DROP/ALTER are parsed by `parse_write` into a `WriteStatement` for the supported forms only — `CREATE [OR REPLACE] TABLE [IF NOT EXISTS] t AS SELECT`, `INSERT INTO t SELECT|VALUES` (no column list), `DROP TABLE [IF EXISTS] t`, `ALTER TABLE [IF EXISTS] t RENAME TO u`; everything else (SET, COPY, ATTACH, UPDATE, DELETE/TRUNCATE, PRAGMA, views, schemas, temp tables, plain CREATE TABLE) is rejected with a message listing the supported writes. `result_query` = last statement, must be SELECT (export, stats, save-as-table).
  - `writes.py` — `SqlWriter`: executes `WriteStatement`s through Delta + catalog, never DuckDB tables. CTAS/INSERT submit a `QueryImportRequest` to `ImportManager` and wait (cancel propagates to the job); INSERT maps columns **by position** and casts to the target's types (`target_columns`); CTAS sanitizes names; DROP/RENAME reuse `tables.drop/rename`. Returns `{action, table, message, rows_written, version}`.
  - `sql.py` — `QueryRunner`: `run` executes statements in order (each read on a fresh `engine.cursor()`, so tables created earlier in the same run are visible; writes via `SqlWriter`); returns `kind: "rows"` (first `row_limit` rows + exact total: streams Arrow batches until limit+1, then `rel.aggregate("count(*)")` only if needed) or `kind: "write"` with `message`, plus `writes: [...]` for every run; records history. Each run has a `_Run` handle (current connection / job id / cancelled flag); `cancel` interrupts repeatedly until the run ends (a single interrupt sent before DuckDB starts executing is lost) and cancels the import job. Cancelled = HTTP **499** (409 is a real conflict). `export` streams `rel.write_csv/write_parquet` on a bulk connection; `column_stats`. Uses relation APIs and positional `#n` projections, never wraps SQL text. `python_enable_replacements=false` on every connection.
  - `queries.py` — `QueryStore`: saved queries (unique, case-insensitive names) and query history (last 500) in meta.db (migration 2).
  - Save-as-table reuses `ImportManager` with a `QueryImportRequest` (bulk connection with catalog views, positional projection, sanitized column names).
  - `sql_routes.py` — `/api/sql/{run,cancel,stats,export,save-table,history}`, `/api/saved-queries`.
  - Notebooks: `notebooks.py` `NotebookStore` (.ipynb files in `workspace/notebooks`, nbformat 4.5 with cell ids; SQL cells are code cells with `metadata.chakybricks.language = "sql"` and source without the magic; `read` returns plain-string sources). `kernels.py` `KernelRegistry`/`KernelSession`: one kernel per notebook via `jupyter_client.KernelManager` with a custom `KernelSpec` whose argv re-invokes this executable (`kernel_argv()`: frozen → `[exe, --kernel, -f, {connection_file}]`, dev → `[python, -m, chakybricks, --kernel, ...]`; `__main__` dispatches `--kernel` to `ipykernel.kernelapp.launch_new_instance` before importing the server). Blocking client + one iopub reader thread per kernel → events (`queued/started/output/clear_output/done/status`) fanned out to listeners; `start()` waits for the bootstrap (`kernel_init.setup()`) before reporting idle; restart recreates the client (the old one stops receiving after a restart); errors abort the rest of the queue (`done` status `aborted`). Kernel env: workspace + memory limit vars, `PLOTLY_RENDERER=plotly_mimetype`, matplotlib inline, **`CHAKYBRICKS_TOKEN` removed**. Kernels exit with the backend (ipykernel parent polling). Verified: no visible windows for kernel processes when the backend runs with CREATE_NO_WINDOW.
  - `cb.py` (runs in kernels) — `cb.sql` (read-only, Polars DataFrame), `cb.table(name, version=)` (`pl.scan_delta`, lazy), `cb.save(df, name, mode, partition_by)` (Polars/pandas/Arrow/LazyFrame → DuckDB projection with `storage_type` + sanitized names → `write_deltalake` → catalog upsert, `source="notebook"`), `cb.tables()`. Builds its own `Engine` from the env-provided workspace. `kernel_init.py` — registers `cb`, mimebundle formatters for Polars/pandas/Arrow frames and series (`application/vnd.chakybricks.table+json`: first 1000 rows + total), `%%sql [var]` magic with short errors (`SqlCellError._render_traceback_`).
  - `notebook_routes.py` — `/api/notebooks` CRUD + rename, `/api/kernels` start/list/interrupt/restart/shutdown, `WS /ws/kernels/{id}?token=` (client sends `execute {cell_id, code}` and `complete {request_id, code, cursor_pos}`; server pushes kernel events and `complete_reply`).
  - `tables.py` — describe/sample/history/rename (directory move)/drop (move to `tmp/` then delete). `routes.py` — all `/api/*` endpoints.
- `src/` — React 19 + TS + Vite 8 + Tailwind v4 + shadcn/ui (new-york, zinc, lucide), TanStack Query for server state.
  - `lib/backend.ts` — `BackendClient` (`get/post/put/delete`, token header, `ApiError` with FastAPI `detail`), `loadBackendInfo`, `waitForBackend`.
  - `hooks/use-api.ts` — all query/mutation hooks and `queryKeys`; invalidate `queryKeys.catalog` after catalog changes.
  - `components/import/` — `ImportProvider` (`useImport().openImport()` from anywhere; watches running jobs, toasts when the dialog is closed), `ImportWizard` (pick → configure → progress), `ConfigureStep` (destination, partition, CSV options, editable columns, live preview). Pure logic in `lib/import.ts`.
  - `routes/catalog.tsx` (layout with `components/catalog/catalog-tree.tsx`), `routes/table-page.tsx` (schema / sample / history with time-travel sample / details; rename, drop).
  - `components/data-preview.tsx` — simple table for small previews; `components/result-grid.tsx` — virtualized grid (TanStack Table v9 `useTable` + `tableFeatures({columnSizingFeature, columnResizingFeature})`, TanStack Virtual rows, resizable columns, header popover).
  - SQL page `routes/sql.tsx` (lazy-loaded: Monaco + ECharts live in that chunk). Tabs reducer + localStorage in `lib/sql-tabs.ts`; Monaco setup in `lib/monaco.ts` (local worker via `monaco-editor/editor/editor.worker?worker`, `chaky-light/dark` themes, one global SQL completion provider fed by `setCompletionTables`; one model per tab — Monaco owns the text after the model exists, React state only seeds it). Autocomplete logic in `lib/sql-completion.ts`. Per-tab runs in `hooks/use-sql.ts` (`useQueryRunner`; invalidates catalog and table queries when a run returns `writes`). Results panel (write results show a success message instead of the grid): status/counts, Table/Chart, export full result (native save dialog), save as table, column stats on header click.
  - Notebooks: `routes/notebooks.tsx` (list; handles `?new=1` and `?table=`), `routes/notebook.tsx` (lazy; editor with reducer from `lib/notebook.ts` — ipynb conversion, kernel events, stream merging, `\r` handling; autosave 1 s after changes, flush on unmount). `hooks/use-kernel.ts` (start kernel, WebSocket with reconnect, execute/complete/interrupt/restart), `hooks/use-notebooks.ts`. `components/notebook/` — `cell-editor.tsx` (one Monaco model+editor per cell, auto height, Shift/Ctrl/Alt+Enter actions), `notebook-cell.tsx`, `cell-outputs.tsx` (table mime → `ResultGrid`, plotly via lazy `plotly.js-dist-min`, images, sanitized SVG/HTML via DOMPurify, markdown via `marked`, ANSI via `lib/ansi.ts`). Python completion: `setPythonCompleter(model, fn)` in `lib/monaco.ts` (kernel `complete` + catalog table names inside `cb.table("`).
  - Charts: `lib/chart.ts` (validated categorical palette from the dataviz skill, light/dark; one axis; ≤8 series, ≤3 for scatter; pie folds >8 slices into Other) + `components/sql/result-chart.tsx` (tree-shaken `echarts/core`).
  - Theme, nav rail, command palette (Ctrl+K: navigation, import, tables), Ctrl+1..7 shortcuts as in Phase 1.

## Conventions

- Minimal comments; clean, typed code. Python: ruff + mypy strict, line length 100 (pyarrow/pandas/psutil have no stubs — ignored in mypy config). TS: strict, ESLint + Prettier (Tailwind class sorting), `@/` alias → `src/`.
- Context + hook in `src/lib/*.ts`; provider components in `src/components/`; non-component helpers out of `.tsx` files (react-refresh lint).
- shadcn: `npx shadcn@latest add <name>`. The CLI writes `import { cn } from "cn"` — fix to `@/lib/utils` after adding. If it prompts to overwrite `button.tsx`, answer no (`"n" | npx shadcn@latest add …`). Don't use `next-themes` — use `@/lib/theme`.
- Design tokens are CSS variables in `src/index.css`, single accent `--primary` (brick orange). Subtle borders, not heavy shadows. Inter bundled (no CDN).
- Every backend route is token-protected by the middleware; frontend calls go through `BackendClient` / `use-api` hooks.
- Recent library versions — check installed APIs before assuming older ones:
  - **DuckDB 2.0**: a connection with an unfinished `execute()` result blocks further work (fetch everything or use `con.sql(...)` relations). Arrow streaming is `relation.to_arrow_reader(batch_size)` (no `fetch_record_batch` on the connection). `duckdb_views()` column is `view_name`.
  - **deltalake 1.6**: `schema().to_arrow()` / `get_add_actions()` return arro3 objects — wrap with `pa.schema(...)` / `pa.table(...)`. Writing timestamps without tz auto-enables `timestampNtz`.
  - React Router 8, TS 6, Vite 8, Vitest 5, ESLint 10, Tailwind 4, pandas 3.
  - Polars **2.1** (`pl.scan_delta` works with deltalake 1.6), ipykernel 7, jupyter_client 8.10 (use blocking clients in threads — async zmq on Windows' Proactor loop warns), plotly 7, marked 18, plotly.js 4 (no types; declared in `vite-env.d.ts`).
  - TanStack Table **v9** (`useTable`, features registered via `tableFeatures`, `helper.columns([...])`; docs in `node_modules/@tanstack/react-table/skills/`), react-resizable-panels **v4** (`orientation`, sizes as `"45%"` strings — numbers are pixels), ECharts 6, Monaco 0.57 (`monaco-editor/*` maps to `esm/vs/*`).
- Don't use `sed` to write `\u…` escapes (GNU sed turns `\u` into "uppercase next char"); edit such lines with a Python script using `chr(92)`. Tests contain Arabic text, so ruff's RUF001 is ignored under `tests/`.
- Pytest: Starlette TestClient's `httpx` deprecation warning is filtered in `pyproject.toml`. Use `with TestClient(...)` so the lifespan creates services.

## Packaging checklist (Phase 7)

- Kernels re-invoke the backend exe with `--kernel`; PyInstaller must include `ipykernel`, `jupyter_client`, `zmq`, `IPython`, `matplotlib_inline`, `chakybricks.kernel_init`/`chakybricks.cb` (imported only by the bootstrap string), plotly/sklearn/scipy data files. Check kernel processes have no console window with the windowed exe.
- PyInstaller must bundle `pytz` and `tzdata` (include data files, e.g. `collect_data_files("tzdata")`) — Windows has no system time-zone database. Also verify the `duckdb`, `deltalake`, `pyarrow` binaries and `openpyxl`.

## Commits

Commit at the end of each phase with a clear message. Remote: https://github.com/chaker88/ChakyBricks.git (branch `main`). Push only when asked.
