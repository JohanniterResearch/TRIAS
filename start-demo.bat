@echo off
REM Spins up the dev/demo stack: Postgres (docker), backend (dotnet run), frontend (npm start).
REM Mirrors the manual steps in README.md "Spin up a demo/dev instance".
setlocal

REM docker-compose.yml requires BACKUP_EXPECTED_DEPLOYMENT_ID at file-parse time even
REM though only the prod-profile `backend` service uses it; dev never starts that service.
if not defined BACKUP_EXPECTED_DEPLOYMENT_ID set BACKUP_EXPECTED_DEPLOYMENT_ID=dev-local

echo [1/3] Starting Postgres via docker compose...
docker compose up -d db
if errorlevel 1 goto :error

echo [2/3] Starting backend (new window)...
start "Ambulanzsystem backend" cmd /k "cd /d "%~dp0backend" && dotnet run --project src\Ambulanzsystem.Api"

echo [3/3] Starting frontend (new window)...
start "Ambulanzsystem frontend" cmd /k "cd /d "%~dp0frontend" && npm install && npm start"

echo.
echo Backend:  http://localhost:5042  (Swagger at /swagger)
echo Frontend: http://localhost:4200
echo Login as admin / dev-admin-password (see README for reseeding notes).
goto :eof

:error
echo docker compose failed to start the database.
exit /b 1
