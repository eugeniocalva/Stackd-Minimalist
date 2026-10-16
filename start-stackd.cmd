@echo off
rem Stack'd - double-click to run the app on this computer.
rem
rem Double-clicking index.html also works, but from disk the app runs a
rem bundled copy without reminders, offline install or the shared task list.
rem This serves the folder on http://localhost (the full app) and opens it in
rem your default browser once the server is listening.
rem Close this window to stop the server. Needs Node.js (https://nodejs.org).
rem
rem Optional: set STACKD_PORT to use another port (default 8123),
rem           set STACKD_NO_BROWSER=1 to start the server without opening it.

setlocal
cd /d "%~dp0"
if not defined STACKD_PORT set "STACKD_PORT=8123"
set "OPEN=-o"
if defined STACKD_NO_BROWSER set "OPEN="

where npx >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed to run Stack'd locally. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

echo Starting Stack'd on http://localhost:%STACKD_PORT%  - close this window to stop it.
call npx --yes http-server . -p %STACKD_PORT% -c-1 %OPEN%

echo.
echo The server stopped. If port %STACKD_PORT% is already in use, close the other
echo server or run:  set STACKD_PORT=8124 ^& start-stackd.cmd
pause
