$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root "backend\.venv\Scripts"
$failed = @()

function Step([string]$name, [string]$dir, [scriptblock]$cmd) {
    Write-Host "`n==> $name" -ForegroundColor Cyan
    Push-Location $dir
    try {
        & $cmd
        if ($LASTEXITCODE -ne 0) { $script:failed += $name }
    } finally {
        Pop-Location
    }
}

$backend = Join-Path $root "backend"
$tauri = Join-Path $root "src-tauri"

Step "backend: pytest" $backend { & "$venv\python.exe" -m pytest -q }
Step "backend: ruff check" $backend { & "$venv\ruff.exe" check . }
Step "backend: ruff format" $backend { & "$venv\ruff.exe" format --check . }
Step "backend: mypy" $backend { & "$venv\mypy.exe" }
Step "frontend: vitest" $root { npm test --silent }
Step "frontend: tsc" $root { npm run typecheck --silent }
Step "frontend: eslint" $root { npm run lint --silent }
Step "frontend: prettier" $root { npm run format:check --silent }
Step "notices: THIRD_PARTY_NOTICES.txt up to date" $root { & "$venv\python.exe" scripts\generate_notices.py --check }
Step "tauri: cargo test" $tauri { cargo test --quiet }
Step "tauri: clippy" $tauri { cargo clippy --all-targets --quiet -- -D warnings }
Step "tauri: rustfmt" $tauri { cargo fmt --check }

if ($failed.Count -gt 0) {
    Write-Host "`nFailed: $($failed -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host "`nAll checks passed." -ForegroundColor Green
