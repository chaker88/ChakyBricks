# ChakyBricks — notes for Claude

Single-user offline desktop lakehouse for Windows. **SPEC.md is the source of truth**; follow it exactly and ask before deviating. Work is delivered phase by phase (see SPEC.md "Delivery phases"); at the end of each phase run all checks, confirm the app launches, commit, and stop for review.

## Status

- Phase 1 (skeleton) — done.
- Phase 2 (data: storage, SQLite catalog, import wizard, catalog UI) — done.
- Next: Phase 3 (SQL editor, result grid, saved queries, history, export). The table page already navigates to `/sql?table=schema.table` and `/notebooks?table=schema.table`; Phases 3/4 should read that param.

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
  - `tables.py` — describe/sample/history/rename (directory move)/drop (move to `tmp/` then delete). `routes.py` — all `/api/*` endpoints.
- `src/` — React 19 + TS + Vite 8 + Tailwind v4 + shadcn/ui (new-york, zinc, lucide), TanStack Query for server state.
  - `lib/backend.ts` — `BackendClient` (`get/post/put/delete`, token header, `ApiError` with FastAPI `detail`), `loadBackendInfo`, `waitForBackend`.
  - `hooks/use-api.ts` — all query/mutation hooks and `queryKeys`; invalidate `queryKeys.catalog` after catalog changes.
  - `components/import/` — `ImportProvider` (`useImport().openImport()` from anywhere; watches running jobs, toasts when the dialog is closed), `ImportWizard` (pick → configure → progress), `ConfigureStep` (destination, partition, CSV options, editable columns, live preview). Pure logic in `lib/import.ts`.
  - `routes/catalog.tsx` (layout with `components/catalog/catalog-tree.tsx`), `routes/table-page.tsx` (schema / sample / history with time-travel sample / details; rename, drop).
  - `components/data-preview.tsx` — simple table for ≤1000 rows (Phase 3 adds the virtualized grid).
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
- Don't use `sed` to write `\u…` escapes (GNU sed turns `\u` into "uppercase next char"); edit such lines with a Python script using `chr(92)`. Tests contain Arabic text, so ruff's RUF001 is ignored under `tests/`.
- Pytest: Starlette TestClient's `httpx` deprecation warning is filtered in `pyproject.toml`. Use `with TestClient(...)` so the lifespan creates services.

## Packaging checklist (Phase 7)

- PyInstaller must bundle `pytz` and `tzdata` (include data files, e.g. `collect_data_files("tzdata")`) — Windows has no system time-zone database. Also verify the `duckdb`, `deltalake`, `pyarrow` binaries and `openpyxl`.

## Commits

Commit at the end of each phase with a clear message. Remote: https://github.com/chaker88/ChakyBricks.git (branch `main`). Push only when asked.
