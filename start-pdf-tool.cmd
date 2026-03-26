@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not available on PATH.
  echo Install Node.js from https://nodejs.org/ and run this launcher again.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$connection = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; if ($connection) { exit 0 } else { exit 1 }"

if errorlevel 1 (
  if not exist node_modules (
    echo Installing dependencies for first run...
    call npm install
    if errorlevel 1 (
      echo Dependency installation failed.
      pause
      exit /b 1
    )
  )

  start "PDF Tool Server" cmd /k "cd /d "%~dp0" && npm start"
  timeout /t 4 /nobreak >nul
)

start "" "http://localhost:3000"
exit /b 0