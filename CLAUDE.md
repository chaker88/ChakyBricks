# ChakyBricks — notes for Claude

Single-user offline desktop lakehouse for Windows. **SPEC.md is the source of truth**; follow it exactly and ask before deviating. Work is delivered phase by phase (see SPEC.md "Delivery phases"); at the end of each phase run all checks, confirm the app launches, commit, and stop for review.

## Status

- Phase 1 (skeleton) — done.
- Next: Phase 2 (data: storage layout, SQLite catalog, import wizard, catalog UI).

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

Python is always `py -3.12` (system) or `backend\.venv\Scripts\python.exe` (project). Never rely on a bare `python`.

## Architecture

- `src-tauri/` — Tauri v2 shell. `src/backend.rs` picks a free localhost port and a random 64-hex token, spawns the backend, exposes `backend_info` command, kills the backend on `RunEvent::Exit`.
  - Debug builds: spawns `backend/.venv/Scripts/python.exe -m chakybricks` (override with `CHAKYBRICKS_PYTHON`).
  - Release builds: spawns `<resource_dir>/backend/chakybricks-backend.exe` (PyInstaller onedir, wired up in Phase 7).
  - Backend gets `--port N --watch-stdin` and the token via env `CHAKYBRICKS_TOKEN` (not argv, so it is not visible in process listings). `--watch-stdin` makes the backend exit when the shell's stdin pipe closes (covers shell crashes).
  - The backend is always spawned with `CREATE_NO_WINDOW` (dev and release); its stdout/stderr are piped and forwarded to the shell's stderr prefixed with `[backend]`.
  - Custom title bar (`decorations: false`); window permissions in `capabilities/default.json`. CSP in `tauri.conf.json` allows `http/ws://127.0.0.1:*`.
- `backend/chakybricks/` — FastAPI app (`app.py: create_app(token)`), `auth.py` ASGI middleware requires the token on every HTTP request (`X-ChakyBricks-Token` header) and WebSocket (`?token=` query param; rejected with close code 4401). CORS preflight passes without token. Entry point `__main__.py`.
- `src/` — React 19 + TS + Vite 8 + Tailwind v4 + shadcn/ui (new-york, zinc, lucide).
  - `lib/backend.ts` — `BackendClient` (adds token header), `loadBackendInfo` (Tauri `invoke`, or `VITE_BACKEND_PORT`/`VITE_BACKEND_TOKEN` in a plain browser), `waitForBackend` (polls `/api/health`).
  - `components/backend-provider.tsx` + `lib/backend-context.ts` — `useBackend()` → `connecting | ready{client,health} | error`.
  - `components/theme-provider.tsx` + `lib/theme.ts` — `useTheme()`; light/dark/system persisted in localStorage `chakybricks.theme`; toggles `.dark` on `<html>`.
  - `components/app-shell.tsx` — title bar, nav rail, `<Outlet/>`, command palette (Ctrl+K), Ctrl+1..7 section shortcuts. Nav items in `lib/nav.ts`.
  - Routes in `src/routes/` (HashRouter). `components/page.tsx` has `Page` and `EmptyState`.

## Conventions

- Minimal comments; clean, typed code. Python: ruff + mypy strict, line length 100. TS: strict, ESLint + Prettier (with Tailwind class sorting), `@/` alias → `src/`.
- Context + hook live in `src/lib/*.ts`; provider components in `src/components/` (keeps react-refresh lint happy).
- shadcn components live in `src/components/ui/` and may be edited. Add more with `npx shadcn@latest add <name>`; check that output lands in `src/components/ui` and imports `cn` from `@/lib/utils`. Don't use `next-themes` — use `@/lib/theme`.
- Design tokens are CSS variables in `src/index.css` (`:root` + `.dark`), single brand accent `--primary` (brick orange). Use subtle borders, not heavy shadows. Inter via `@fontsource-variable/inter` (offline; no CDN fonts).
- Every new backend route is automatically token-protected by the middleware; frontend must call through `BackendClient`.
- Tool versions are recent (React Router 8, TS 6, Vite 8, Vitest 5, ESLint 10, Tailwind 4); check installed package APIs before assuming older ones.
- Pytest: `httpx` is used by Starlette's TestClient; its deprecation warning is filtered in `pyproject.toml`.

## Commits

Commit at the end of each phase with a clear message. Remote: https://github.com/chaker88/ChakyBricks.git (branch `main`). Don't push unless asked.
