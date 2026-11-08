$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$devPort = 1420

if (-not (Test-Path (Join-Path $root "backend\.venv\Scripts\python.exe"))) {
    & (Join-Path $PSScriptRoot "setup.ps1")
}

# Stops a leftover dev server (or app) from an earlier run that still holds the Vite port, but only
# if it is node/vite or chakybricks started from this project. Anything else is left alone.
function Stop-StaleDevProcess {
    $owners = netstat.exe -ano -p TCP |
        Select-String -Pattern ":$devPort\s+\S+\s+LISTENING\s+(\d+)\s*$" |
        ForEach-Object { [int]$_.Matches[0].Groups[1].Value } |
        Sort-Object -Unique
    foreach ($owner in $owners) {
        $info = Get-CimInstance Win32_Process -Filter "ProcessId = $owner" -ErrorAction SilentlyContinue
        if (-not $info) { continue }
        $name = $info.Name.ToLowerInvariant()
        $command = "$($info.CommandLine) $($info.ExecutablePath)"
        $ours = ($name -in @("node.exe", "chakybricks.exe")) -and $command.Contains($root)
        if (-not $ours) {
            throw "Port $devPort is in use by '$($info.Name)' (PID $($info.ProcessId)), which is not part of ChakyBricks. Free the port and run again."
        }
        Write-Host "Stopping stale $($info.Name) (PID $($info.ProcessId)) on port $devPort"
        & taskkill.exe /PID $info.ProcessId /T /F | Out-Null
    }
    # An app window from an earlier run (debug build of this project) would keep its backend alive.
    Get-CimInstance Win32_Process -Filter "Name = 'chakybricks.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root) } |
        ForEach-Object {
            Write-Host "Stopping stale ChakyBricks app (PID $($_.ProcessId))"
            & taskkill.exe /PID $_.ProcessId /T /F | Out-Null
        }
    Start-Sleep -Milliseconds 500
}

Stop-StaleDevProcess

Push-Location $root
try {
    npm run tauri dev
} finally {
    Pop-Location
}
