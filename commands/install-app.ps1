# ──────────────────────────────────────────────────────
#  Clui CC - Full Installation (Windows)
#
#  1. Set up dependencies (runs setup.ps1)
#  2. Optionally install whisper-cpp via winget
#  3. Build a standalone Windows app
#  4. Report success with output path
# ──────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

# Resolve to repo root (one level up from commands/)
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }
Set-Location $RepoRoot

$AppName = "Clui CC"

function Write-Step([string]$StepNum, [string]$Total, [string]$Message) {
    Write-Host ""
    Write-Host ("=" * 50) -ForegroundColor Cyan
    Write-Host " Step $StepNum/$Total - $Message" -ForegroundColor Cyan
    Write-Host ("=" * 50) -ForegroundColor Cyan
    Write-Host ""
}

# ── 1. Setup ──

Write-Step "1" "4" "Setting up environment and dependencies"

$setupScript = Join-Path $PSScriptRoot "setup.ps1"
& $setupScript
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Setup failed. Fix the issues above, then run this script again." -ForegroundColor Red
    Write-Host ""
    exit 1
}

# ── 2. Whisper (optional, for voice input) ──

Write-Step "2" "4" "Checking voice support (Whisper)"

$whisperFound = $false
foreach ($cmd in @("whisper-cli", "whisper", "whisper-cpp")) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) {
        Write-Host "Whisper is already installed: $cmd" -ForegroundColor Green
        $whisperFound = $true
        break
    }
}

if (-not $whisperFound) {
    Write-Host "Whisper is not installed. Attempting to install via winget..." -ForegroundColor Yellow
    Write-Host ""

    if (Get-Command "winget" -ErrorAction SilentlyContinue) {
        try {
            # Try to find and install whisper-cpp via winget
            $wingetSearch = winget search "whisper" --source winget 2>$null
            if ($wingetSearch -match "whisper") {
                Write-Host "Searching winget for whisper packages..." -ForegroundColor Cyan
                winget install --id "Const-me.Whisper" --accept-package-agreements --accept-source-agreements 2>$null
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "Whisper installed successfully via winget." -ForegroundColor Green
                    $whisperFound = $true
                }
            }
        } catch {
            # Silently continue
        }
    }

    if (-not $whisperFound) {
        Write-Host ""
        Write-Host "Whisper could not be installed automatically." -ForegroundColor Yellow
        Write-Host "Voice input will be unavailable. You can install it manually later." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Options:" -ForegroundColor White
        Write-Host "    - Download from: https://github.com/ggerganov/whisper.cpp/releases" -ForegroundColor White
        Write-Host "    - Or: pip install openai-whisper" -ForegroundColor White
        Write-Host ""
        Write-Host "Continuing without Whisper..." -ForegroundColor Yellow
    }
}

# ── 3. Build ──

Write-Step "3" "4" "Building $AppName for Windows"

npm run dist:win
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Build failed." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Try these steps one at a time:" -ForegroundColor Yellow
    Write-Host "    Remove-Item -Recurse -Force node_modules" -ForegroundColor White
    Write-Host "    npm install" -ForegroundColor White
    Write-Host "    npm run dist:win" -ForegroundColor White
    Write-Host ""
    exit 1
}

# ── 4. Report ──

Write-Step "4" "4" "Installation Complete"

# Look for built output
$releaseDir = Join-Path $RepoRoot "release"
$builtExe = $null

if (Test-Path $releaseDir) {
    $exeFiles = Get-ChildItem -Path $releaseDir -Filter "*.exe" -Recurse -ErrorAction SilentlyContinue
    if ($exeFiles) {
        $builtExe = $exeFiles | Select-Object -First 1
    }

    # Also check for unpacked app
    $unpackedDirs = Get-ChildItem -Path $releaseDir -Directory -Filter "win-*" -ErrorAction SilentlyContinue
    if ($unpackedDirs) {
        $unpackedExe = Get-ChildItem -Path $unpackedDirs[0].FullName -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    }
}

Write-Host "Build complete!" -ForegroundColor Green
Write-Host ""

if ($builtExe) {
    Write-Host "  Installer: $($builtExe.FullName)" -ForegroundColor White
    Write-Host ""
    Write-Host "  To install, double-click the installer above." -ForegroundColor Cyan
}

if ($unpackedExe) {
    Write-Host "  Portable:  $($unpackedExe.FullName)" -ForegroundColor White
    Write-Host ""
    Write-Host "  To run without installing, use the portable executable." -ForegroundColor Cyan
}

if (-not $builtExe -and -not $unpackedExe) {
    Write-Host "  Check the release/ folder for output:" -ForegroundColor Yellow
    Write-Host "    $releaseDir" -ForegroundColor White
}

Write-Host ""
Write-Host "  Shortcut: Alt+Space to toggle the overlay" -ForegroundColor Cyan
Write-Host ""
