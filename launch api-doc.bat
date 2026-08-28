@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   Hualong API contract - Swagger UI launcher
echo ============================================

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found. Install Node.js 18+ and add it to PATH.
  pause
  exit /b 1
)

if not exist "node_modules\swagger-ui-dist\swagger-ui-bundle.js" (
  echo [HINT] node_modules\swagger-ui-dist not found. Install deps first:
  echo        cd C:\Users\Herman\.hualong-teacher-deps ^&^& npm install
  echo        then copy node_modules into this repo root.
  pause
  exit /b 1
)

rem ---- 1) local contract mock (port 3820, needed by Try-it-out) ----
set "MOCKPORT=3820"
set "STARTMOCK=1"
netstat -ano | findstr /C:":3820 " | findstr /C:"LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo   mock  127.0.0.1:%MOCKPORT%  already running - skip start.
  set "STARTMOCK=0"
)

rem ---- 2) swagger UI port rotation (first free of eight) ----
set "PICKED="
for %%P in (3830 3831 3832 3833 3834 3835 3836 3837) do (
  if not defined PICKED (
    netstat -ano | findstr /C:":%%P " | findstr /C:"LISTENING" >nul 2>nul
    if errorlevel 1 set "PICKED=%%P"
  )
)
if not defined PICKED (
  echo [ERROR] ports 3830-3837 all in use. Free one, or run manually:
  echo        set PORT=3830 ^&^& node tools\swagger\server.mjs
  pause
  exit /b 1
)

rem dry-run: report what would happen, then exit (no windows spawned)
if defined HL_DRYRUN (
  echo   [dry-run] would start Swagger UI  http://127.0.0.1:!PICKED!/
  echo   [dry-run] mock start flag = %STARTMOCK%  ^(1=would start, 0=already running^)
  exit /b 0
)

rem ---- 3) start the mock in its own window if the port was free ----
if "%STARTMOCK%"=="1" (
  echo   starting mock  http://127.0.0.1:%MOCKPORT%/api/v1
  start "Hualong mock" cmd /k "cd /d ""%~dp0"" && set PORT=%MOCKPORT% && node mock\server.mjs"
)

rem ---- 4) swagger UI in the foreground with the chosen port ----
set "PORT=!PICKED!"
echo.
echo   Swagger UI    http://127.0.0.1:!PICKED!/
echo   Role matrix   http://127.0.0.1:!PICKED!/roles
echo   Raw contract  http://127.0.0.1:!PICKED!/openapi.yaml
echo   Ctrl+C to stop
echo.

rem open the browser after the server has bound, in a hidden background shell
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:!PICKED!/"

node tools\swagger\server.mjs

echo.
echo Swagger UI stopped.
pause
endlocal
