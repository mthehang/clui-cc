# ──────────────────────────────────────────────────────
#  Clui CC - Stop (Windows)
#
#  Kills all Clui CC and Electron processes.
# ──────────────────────────────────────────────────────

$stopped = $false

# ── Kill by process name ──

$targets = @("Clui CC", "electron")

foreach ($name in $targets) {
    $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
    if ($procs) {
        foreach ($proc in $procs) {
            try {
                $proc.Kill()
                $stopped = $true
                Write-Host "  Stopped: $($proc.ProcessName) (PID $($proc.Id))" -ForegroundColor Green
            } catch {
                Write-Host "  Could not stop: $($proc.ProcessName) (PID $($proc.Id)) - $($_.Exception.Message)" -ForegroundColor Red
            }
        }
    }
}

# ── Also check for any electron processes running from this repo ──

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $repoRoot) { $repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }

$allElectron = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try {
        $_.Path -and $_.Path -like "*$repoRoot*"
    } catch {
        $false
    }
}

foreach ($proc in $allElectron) {
    try {
        $proc.Kill()
        $stopped = $true
        Write-Host "  Stopped: $($proc.ProcessName) (PID $($proc.Id))" -ForegroundColor Green
    } catch {
        # Already killed or access denied
    }
}

# ── Report ──

Write-Host ""
if ($stopped) {
    Write-Host "Clui CC stopped." -ForegroundColor Green
} else {
    Write-Host "Clui CC was not running." -ForegroundColor Yellow
}
