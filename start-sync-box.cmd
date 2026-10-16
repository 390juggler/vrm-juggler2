@echo off
cd /d "%~dp0"
call npm.cmd run build
if errorlevel 1 (
  pause
  exit /b 1
)
echo Open http://127.0.0.1:8080/sync-compose.html
echo Keep this window open while using the app. Press Ctrl+C to stop.
call npm.cmd run serve -- --host 127.0.0.1 --strictPort
pause
