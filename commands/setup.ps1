# ──────────────────────────────────────────────────────
#  Clui CC - Setup (Windows)
#
#  Checks environment prerequisites, installs npm
#  dependencies, and verifies critical package versions.
# ──────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

# Resolve to repo root (one level up from commands/)
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }
Set-Location $RepoRoot

# ── Helpers ──

$script:FailCount = 0

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "--- $Message" -ForegroundColor Cyan
}

function Write-Pass([string]$Message) {
    Write-Host "  OK: $Message" -ForegroundColor Green
}

function Write-Fail([string]$Message) {
    Write-Host "  FAIL: $Message" -ForegroundColor Red
    $script:FailCount++
}

function Write-Fix([string]$Command) {
    Write-Host ""
    Write-Host "  To fix, run this command:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    $Command" -ForegroundColor White
    Write-Host ""
}

function Write-Warn([string]$Message) {
    Write-Host "  WARN: $Message" -ForegroundColor Yellow
}

function Test-CommandExists([string]$Command) {
    $null = Get-Command $Command -ErrorAction SilentlyContinue
    return $?
}

function Compare-Version([string]$Current, [string]$Required) {
    # Returns $true if $Current >= $Required
    try {
        $c = [Version]($Current -replace '^v', '' -replace '-.*$', '')
        $r = [Version]($Required -replace '^v', '' -replace '-.*$', '')
        return $c -ge $r
    } catch {
        return $false
    }
}

# ── Preflight Checks ──

Write-Step "Checking environment"

# Windows version
$osVersion = [System.Environment]::OSVersion.Version
$osBuild = (Get-CimInstance Win32_OperatingSystem).Caption
Write-Pass "Windows: $osBuild (Build $($osVersion.Build))"

# Node.js
if (Test-CommandExists "node") {
    $nodeVer = (node --version 2>$null) -replace '^v', ''
    if (Compare-Version $nodeVer "18.0.0") {
        Write-Pass "Node.js v$nodeVer"
    } else {
        Write-Fail "Node.js v$nodeVer is too old. Clui CC requires Node 18+."
        Write-Fix "winget install OpenJS.NodeJS.LTS"
    }
} else {
    Write-Fail "Node.js is not installed."
    Write-Fix "winget install OpenJS.NodeJS.LTS"
}

# npm
if (Test-CommandExists "npm") {
    $npmVer = npm --version 2>$null
    Write-Pass "npm $npmVer"
} else {
    Write-Fail "npm is not installed (should come with Node.js)."
    Write-Fix "winget install OpenJS.NodeJS.LTS"
}

# Python 3 (needed for node-gyp native modules)
$pythonCmd = $null
if (Test-CommandExists "python3") {
    $pythonCmd = "python3"
} elseif (Test-CommandExists "python") {
    # On Windows, python3 may not exist; check that 'python' is Python 3
    $pyTestVer = python --version 2>&1
    if ($pyTestVer -match 'Python 3') {
        $pythonCmd = "python"
    }
}

if ($pythonCmd) {
    $pyVer = & $pythonCmd --version 2>&1
    $pyVer = ($pyVer -replace 'Python\s*', '').Trim()
    Write-Pass "Python $pyVer"
} else {
    Write-Fail "Python 3 is not installed (needed by node-gyp for native modules)."
    Write-Fix "winget install Python.Python.3.11"
}

# C++ Build Tools (for node-gyp)
$hasVSBuildTools = $false
$vsWherePath = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vsWherePath) {
    $vsInstalls = & $vsWherePath -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName 2>$null
    if ($vsInstalls) {
        $hasVSBuildTools = $true
        Write-Pass "C++ Build Tools: $($vsInstalls | Select-Object -First 1)"
    }
}
if (-not $hasVSBuildTools) {
    # Check via npm config
    $npmConfig = npm config get msvs_version 2>$null
    if ($npmConfig -and $npmConfig -ne "undefined") {
        Write-Pass "C++ Build Tools (npm msvs_version: $npmConfig)"
        $hasVSBuildTools = $true
    }
}
if (-not $hasVSBuildTools) {
    Write-Warn "Visual Studio C++ Build Tools not detected (may be needed for native modules)."
    Write-Host "    Install from: https://visualstudio.microsoft.com/visual-cpp-build-tools/" -ForegroundColor Yellow
    Write-Host "    Or run: npm install -g windows-build-tools" -ForegroundColor Yellow
}

# Claude Code CLI
if (Test-CommandExists "claude") {
    Write-Pass "Claude Code CLI found"
} else {
    Write-Fail "Claude Code CLI is not installed."
    Write-Fix "npm install -g @anthropic-ai/claude-code"
}

# Whisper (optional for voice input)
$whisperFound = $false
foreach ($cmd in @("whisper-cli", "whisper", "whisper-cpp")) {
    if (Test-CommandExists $cmd) {
        Write-Pass "Whisper found: $cmd"
        $whisperFound = $true
        break
    }
}
if (-not $whisperFound) {
    Write-Warn "Whisper not found (optional - needed for voice input)."
    Write-Host "    Voice input will be unavailable without Whisper." -ForegroundColor Yellow
}

# ── Bail if critical checks failed ──

if ($script:FailCount -gt 0) {
    Write-Host ""
    Write-Host "Some checks failed. Fix the issues above, then rerun:" -ForegroundColor Red
    Write-Host ""
    Write-Host "  .\commands\setup.bat" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "All checks passed." -ForegroundColor Green

# ── Install dependencies ──

Write-Step "Installing dependencies"

try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
} catch {
    Write-Host ""
    Write-Host "npm install failed. Most common fixes:" -ForegroundColor Red
    Write-Host ""
    Write-Host "  1. Install Visual Studio C++ Build Tools" -ForegroundColor White
    Write-Host "  2. Ensure Python 3 is in PATH" -ForegroundColor White
    Write-Host "  3. Rerun: .\commands\setup.bat" -ForegroundColor White
    Write-Host ""
    exit 1
}

# ── Verify critical dependency versions ──

try {
    $installedBuilder = node -p "require('./node_modules/electron-builder/package.json').version" 2>$null
    $installedElectron = node -p "require('./node_modules/electron/package.json').version" 2>$null
} catch {
    $installedBuilder = ""
    $installedElectron = ""
}

if (-not $installedBuilder -or -not $installedElectron) {
    Write-Host ""
    Write-Host "Could not verify installed Electron dependencies." -ForegroundColor Red
    Write-Host "Try:" -ForegroundColor Yellow
    Write-Host "  Remove-Item -Recurse -Force node_modules, package-lock.json" -ForegroundColor White
    Write-Host "  npm install" -ForegroundColor White
    Write-Host "  .\commands\setup.bat" -ForegroundColor White
    Write-Host ""
    exit 1
}

$needsUpgrade = $false
if (-not (Compare-Version $installedBuilder "26.8.1")) { $needsUpgrade = $true }
if (-not (Compare-Version $installedElectron "35.7.5")) { $needsUpgrade = $true }

if ($needsUpgrade) {
    Write-Host ""
    Write-Host "Detected outdated install (electron-builder $installedBuilder, electron $installedElectron)." -ForegroundColor Yellow
    Write-Host "Applying required security baseline..." -ForegroundColor Yellow
    Write-Host ""
    npm install -D "electron-builder@^26.8.1" "electron@^35.7.5"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to upgrade Electron dependencies." -ForegroundColor Red
        exit 1
    }
}

$finalBuilder = node -p "require('./node_modules/electron-builder/package.json').version" 2>$null
$finalElectron = node -p "require('./node_modules/electron/package.json').version" 2>$null
Write-Host "Installed: electron-builder $finalBuilder, electron $finalElectron" -ForegroundColor Green

Write-Host ""
Write-Host "Setup complete. To launch the app, run:" -ForegroundColor Green
Write-Host ""
Write-Host "  .\commands\start.bat" -ForegroundColor White
Write-Host ""
