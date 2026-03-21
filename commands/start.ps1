# ──────────────────────────────────────────────────────
#  Clui CC - Start (Windows)
#
#  Builds the app and launches Electron.
# ──────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

# Resolve to repo root (one level up from commands/)
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }
Set-Location $RepoRoot

# ── Check dependencies ──

if (-not (Test-Path "node_modules")) {
    Write-Host "Dependencies not installed." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Running npm install..." -ForegroundColor Cyan
    Write-Host ""
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "npm install failed. Run setup first:" -ForegroundColor Red
        Write-Host "  .\commands\setup.bat" -ForegroundColor White
        Write-Host ""
        exit 1
    }
}

# ── Build ──

Write-Host "Building Clui CC..." -ForegroundColor Cyan

npx electron-vite build --mode production
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Build failed. Try:" -ForegroundColor Red
    Write-Host "  Remove-Item -Recurse -Force node_modules" -ForegroundColor White
    Write-Host "  npm install" -ForegroundColor White
    Write-Host ""
    exit 1
}

# ── Launch ──

Write-Host ""
Write-Host "Clui CC running. Alt+Space to toggle. Use .\commands\stop.bat or tray icon > Quit to close." -ForegroundColor Green
Write-Host ""

# Launch Electron (foreground so window stays visible)
npx electron .
