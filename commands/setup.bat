@echo off
echo Clui CC - Setup
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if %ERRORLEVEL% neq 0 pause
