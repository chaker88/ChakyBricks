$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$venvPython = Join-Path $backend ".venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "Creating backend virtualenv (Python 3.12)..."
    py -3.12 -m venv (Join-Path $backend ".venv")
    if ($LASTEXITCODE -ne 0) { throw "Failed to create virtualenv" }
}

Write-Host "Installing backend dependencies..."
& $venvPython -m pip install --upgrade pip --quiet
& $venvPython -m pip install -c (Join-Path $backend "constraints.txt") -e "$backend[dev]" --quiet
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Write-Host "Installing frontend dependencies..."
Push-Location $root
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
} finally {
    Pop-Location
}

Write-Host "Setup complete. Run scripts\dev.ps1 to start the app."
