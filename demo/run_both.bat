@echo off
REM Run desktop (5050) and mobile (5051) Smart-Shield demos together.
REM Usage: double-click or run from demo folder in two terminals manually.

echo Smart-Shield — start BOTH demos in separate windows...
echo.
start "Smart-Shield Desktop :5050" cmd /k "cd /d %~dp0 && python api_server.py"
timeout /t 2 /nobreak >nul
start "Smart-Shield Mobile :5051" cmd /k "cd /d %~dp0 && python mobile_server.py"
echo.
echo Desktop: http://127.0.0.1:5050
echo Mobile:  http://127.0.0.1:5051
echo Phone:   use LAN URL printed in the Mobile window
