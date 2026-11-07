param([switch]$CleanRuntime)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$release = Join-Path $root "src-tauri\target\release"
$stale = @(
    (Join-Path $release "python"),
    (Join-Path $root "backend\build")
)

Write-Host "Removing stale build outputs..."
foreach ($path in $stale) {
    if (Test-Path $path) {
        Remove-Item -Recurse -Force $path
        Write-Host "  removed $path"
    }
}

Write-Host "Refreshing the bundled runtime with the current backend..."
$runtimeArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "build_runtime.ps1"))
if ($CleanRuntime) { $runtimeArgs += "-Clean" }
& powershell @runtimeArgs
if ($LASTEXITCODE -ne 0) { throw "Building the runtime failed" }

$runtimePython = Join-Path $root "src-tauri\resources\python\python.exe"
$check = Join-Path $PSScriptRoot "check_runtime.py"
& $runtimePython $check
if ($LASTEXITCODE -ne 0) { throw "The bundled runtime failed the package check" }

Push-Location $root
try {
    npx tauri build --config src-tauri/tauri.bundle.conf.json
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
} finally {
    Pop-Location
}

& (Join-Path $release "python\python.exe") $check
if ($LASTEXITCODE -ne 0) { throw "The runtime copied into the release build failed the package check" }

$installer = Get-ChildItem (Join-Path $release "bundle\nsis") -Filter "*-setup.exe" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host ("Installer: {0} ({1:N1} MiB)" -f $installer.FullName, ($installer.Length / 1MB))
