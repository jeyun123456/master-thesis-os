@echo off
setlocal
cd /d "%~dp0"

rem start_bridge.ps1 resolves MTO_BRIDGE_CONFIG, shared config, and the repository fallback.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_bridge.ps1"
if errorlevel 1 pause
