# ChakyBricks

A single-user, offline desktop lakehouse for Windows: import data, query it with SQL and Python notebooks, and build dashboards. See [SPEC.md](SPEC.md).

## Requirements (development)

- Windows 10/11 with WebView2
- Python 3.12 (`py -3.12`), Node.js 20+, Rust (MSVC toolchain), Visual Studio C++ Build Tools

## Getting started

```powershell
scripts\setup.ps1   # backend venv + npm install
scripts\dev.ps1     # launch the app (Tauri dev, backend from source)
scripts\check.ps1   # tests, type-checks, linters
```

## Layout

```
src/          React frontend
src-tauri/    Tauri shell (spawns the backend sidecar)
backend/      FastAPI backend (chakybricks package) + tests
scripts/      Dev and build scripts
```
