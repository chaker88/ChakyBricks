param([switch]$Clean)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$release = "20261026"
$pythonVersion = "3.12.16"
$asset = "cpython-$pythonVersion+$release-x86_64-pc-windows-msvc-install_only_stripped.tar.gz"
$sha256 = "1f2ab53880fc67ea323398c6388e05af28addc99a8e389209f08a51fdff4b149"
$url = "https://github.com/astral-sh/python-build-standalone/releases/download/$release/$asset"

$cache = Join-Path $root "build\cache"
$archive = Join-Path $cache $asset
$resources = Join-Path $root "src-tauri\resources"
$runtime = Join-Path $resources "python"
$python = Join-Path $runtime "python.exe"
$devPython = Join-Path $root "backend\.venv\Scripts\python.exe"

New-Item -ItemType Directory -Force $cache | Out-Null
if (-not (Test-Path $archive)) {
    Write-Host "Downloading $asset..."
    Invoke-WebRequest -Uri $url -OutFile "$archive.part" -UseBasicParsing
    Move-Item "$archive.part" $archive
}
$actual = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLower()
if ($actual -ne $sha256) {
    Remove-Item $archive
    throw "Checksum mismatch for $asset (got $actual)"
}

if ($Clean -and (Test-Path $runtime)) { Remove-Item -Recurse -Force $runtime }
if (-not (Test-Path $python)) {
    Write-Host "Extracting Python $pythonVersion..."
    New-Item -ItemType Directory -Force $resources | Out-Null
    tar -xzf $archive -C $resources
    if ($LASTEXITCODE -ne 0) { throw "Extracting $asset failed" }
}

Write-Host "Installing the backend and notebook packages into the runtime..."
$constraints = Join-Path $cache "constraints.txt"
& $devPython -m pip freeze --exclude-editable --disable-pip-version-check |
    Where-Object { $_ -notmatch "^(-e|chakybricks)" } |
    Set-Content -Encoding utf8 $constraints
$env:PYTHONNOUSERSITE = "1"
& $python -m pip install --disable-pip-version-check --no-warn-script-location --no-cache-dir `
    -c $constraints (Join-Path $root "backend")
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
& $python -m pip install --disable-pip-version-check --no-warn-script-location --no-cache-dir `
    --force-reinstall --no-deps (Join-Path $root "backend")
if ($LASTEXITCODE -ne 0) { throw "Reinstalling the backend package failed" }

Write-Host "Pruning test suites and caches..."
$site = Join-Path $runtime "Lib\site-packages"
$pruned = Get-ChildItem $site -Recurse -Directory -Force |
    Where-Object { $_.Name -in @("tests", "__pycache__") -and $_.FullName -notmatch "\\(numpy|IPython)\\testing\\" }
foreach ($dir in $pruned) {
    if (Test-Path $dir.FullName) { Remove-Item -Recurse -Force $dir.FullName }
}
Get-ChildItem $runtime -Recurse -Directory -Filter "__pycache__" -Force | Remove-Item -Recurse -Force

Write-Host "Precompiling bytecode so the first launch is fast..."
& $python -m compileall -q -j 0 --invalidation-mode unchecked-hash (Join-Path $runtime "Lib") | Out-Null

& $python -c "import chakybricks.cb, chakybricks.app, ipykernel, sklearn, scipy, plotly, matplotlib; print('runtime imports ok')"
if ($LASTEXITCODE -ne 0) { throw "Runtime import check failed" }

$size = (Get-ChildItem $runtime -Recurse -File | Measure-Object -Sum Length).Sum
$files = (Get-ChildItem $runtime -Recurse -File | Measure-Object).Count
Write-Host ("Runtime ready: {0:N0} MB in {1:N0} files at {2}" -f ($size / 1MB), $files, $runtime)
