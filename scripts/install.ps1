# ============================================================================
# Clui CC — Windows Installer Script
# Usage: irm https://raw.githubusercontent.com/lcoutodemos/clui-cc/main/scripts/install.ps1 | iex
# ============================================================================

$ErrorActionPreference = 'Stop'

# --- Configuration ---
$repo       = 'lcoutodemos/clui-cc'
$installDir = "$env:LOCALAPPDATA\CluiCC"
$apiUrl     = "https://api.github.com/repos/$repo/releases/latest"

# --- Banner ---
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "         Installing Clui CC...              " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

try {
    # -----------------------------------------------------------------
    # Step 1 — Query GitHub for the latest release
    # -----------------------------------------------------------------
    Write-Host "[1/6] Fetching latest release information..." -ForegroundColor Yellow

    $release = Invoke-RestMethod -Uri $apiUrl -Headers @{
        'User-Agent' = 'CluiCC-Installer'
    }

    $version = $release.tag_name
    Write-Host "       Latest version: $version" -ForegroundColor Gray

    # -----------------------------------------------------------------
    # Step 2 — Locate the Windows .zip asset
    # -----------------------------------------------------------------
    Write-Host "[2/6] Looking for Windows asset..." -ForegroundColor Yellow

    $asset = $release.assets | Where-Object {
        $_.name -match 'win' -and $_.name -like '*.zip'
    } | Select-Object -First 1

    if (-not $asset) {
        throw "Could not find a Windows .zip asset in the latest release. Please check the releases page: https://github.com/$repo/releases"
    }

    $downloadUrl = $asset.browser_download_url
    $assetName   = $asset.name
    Write-Host "       Found asset: $assetName" -ForegroundColor Gray

    # -----------------------------------------------------------------
    # Step 3 — Download the asset to a temp file
    # -----------------------------------------------------------------
    Write-Host "[3/6] Downloading $assetName..." -ForegroundColor Yellow

    $tempZip = Join-Path $env:TEMP $assetName

    $ProgressPreference = 'Continue'
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempZip -UseBasicParsing

    Write-Host "       Download complete." -ForegroundColor Gray

    # -----------------------------------------------------------------
    # Step 4 — Extract to install directory
    # -----------------------------------------------------------------
    Write-Host "[4/6] Extracting to $installDir..." -ForegroundColor Yellow

    # Create the install directory if it doesn't exist
    if (-not (Test-Path $installDir)) {
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    }

    Expand-Archive -Path $tempZip -DestinationPath $installDir -Force

    Write-Host "       Extraction complete." -ForegroundColor Gray

    # -----------------------------------------------------------------
    # Step 5 — Clean up the downloaded zip
    # -----------------------------------------------------------------
    Write-Host "[5/6] Cleaning up temporary files..." -ForegroundColor Yellow

    Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue

    Write-Host "       Temp files removed." -ForegroundColor Gray

    # -----------------------------------------------------------------
    # Step 6 — Create Start Menu shortcut
    # -----------------------------------------------------------------
    Write-Host "[6/6] Creating Start Menu shortcut..." -ForegroundColor Yellow

    $startMenuDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
    $shortcutPath = Join-Path $startMenuDir "Clui CC.lnk"

    # Look for the main executable inside the install directory
    $exePath = Get-ChildItem -Path $installDir -Filter "*.exe" -Recurse |
               Select-Object -First 1

    if ($exePath) {
        $wshShell = New-Object -ComObject WScript.Shell
        $shortcut = $wshShell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath       = $exePath.FullName
        $shortcut.WorkingDirectory = $installDir
        $shortcut.Description      = "Clui CC — AI-powered CLI assistant"
        $shortcut.Save()

        # Release the COM object
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($wshShell) | Out-Null

        Write-Host "       Shortcut created in Start Menu." -ForegroundColor Gray
    } else {
        Write-Host "       No .exe found — skipping shortcut creation." -ForegroundColor DarkYellow
    }

    # -----------------------------------------------------------------
    # Add install directory to user PATH (if not already present)
    # -----------------------------------------------------------------
    Write-Host ""
    Write-Host "Configuring PATH..." -ForegroundColor Yellow

    $currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')

    if ($currentPath -notlike "*$installDir*") {
        $newPath = "$currentPath;$installDir"
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        Write-Host "       Added $installDir to user PATH." -ForegroundColor Gray
    } else {
        Write-Host "       $installDir is already in PATH." -ForegroundColor Gray
    }

    # -----------------------------------------------------------------
    # Success message
    # -----------------------------------------------------------------
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "   Clui CC installed successfully!          " -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Version:  $version"                         -ForegroundColor White
    Write-Host "  Location: $installDir"                      -ForegroundColor White
    Write-Host ""
    Write-Host "  To get started:"                            -ForegroundColor White
    Write-Host "    1. Open a NEW terminal (so PATH updates take effect)" -ForegroundColor White
    Write-Host "    2. Run 'clui-cc' from the command line"   -ForegroundColor White
    Write-Host "       or launch it from the Start Menu."     -ForegroundColor White
    Write-Host ""

} catch {
    # -----------------------------------------------------------------
    # Error handling — clean up and report
    # -----------------------------------------------------------------
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Red
    Write-Host "   Installation failed                      " -ForegroundColor Red
    Write-Host "============================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Error: $($_.Exception.Message)"             -ForegroundColor Red
    Write-Host ""
    Write-Host "  Troubleshooting tips:"                      -ForegroundColor Yellow
    Write-Host "    - Check your internet connection"         -ForegroundColor White
    Write-Host "    - Ensure you have write access to $env:LOCALAPPDATA" -ForegroundColor White
    Write-Host "    - Try running PowerShell as Administrator" -ForegroundColor White
    Write-Host "    - Visit https://github.com/$repo/releases for manual download" -ForegroundColor White
    Write-Host ""

    # Clean up partial downloads if they exist
    if (Test-Path $tempZip -ErrorAction SilentlyContinue) {
        Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue
    }

    exit 1
}
