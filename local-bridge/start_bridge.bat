@echo off
setlocal
cd /d "%~dp0"

if not exist "config.json" (
  echo [bridge] config.json not found.
  echo [bridge] Copy config.example.json to config.json and edit it first.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_bridge.ps1"
if errorlevel 1 pause
