$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path (Join-Path $root "backend\.venv\Scripts\python.exe"))) {
    & (Join-Path $PSScriptRoot "setup.ps1")
}

Push-Location $root
try {
    npm run tauri dev
} finally {
    Pop-Location
}
