@echo off
echo Clui CC - Stopping...
taskkill /F /IM "Clui CC.exe" 2>nul
taskkill /F /IM "electron.exe" 2>nul
echo Done.
pause
