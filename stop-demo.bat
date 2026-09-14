@echo off
REM Tears down the dev/demo stack started by start-demo.bat.
setlocal

echo [1/2] Closing backend/frontend windows...
taskkill /fi "WindowTitle eq Ambulanzsystem backend*" /t /f >nul 2>&1
taskkill /fi "WindowTitle eq Ambulanzsystem frontend*" /t /f >nul 2>&1

REM Fallback: kill anything still bound to the dev ports (e.g. window closed manually).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5042 " ^| findstr "LISTENING"') do taskkill /pid %%p /f >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4200 " ^| findstr "LISTENING"') do taskkill /pid %%p /f >nul 2>&1

if /i "%~1"=="-v" goto :reset
if /i "%~1"=="--reset" goto :reset

echo [2/2] Stopping Postgres container...
docker compose stop db
echo Done. Data volume kept (stop-demo.bat -v to wipe it for a fresh reseed).
goto :eof

:reset
echo [2/2] Stopping Postgres and wiping its data volume...
docker compose down -v
echo Done. Next start-demo.bat reseeds admin/dev-admin-password and responder-demo fresh.
