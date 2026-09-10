@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Hualong thin contract server launcher
echo   (hualong-backend\db\testdata\server)
echo ============================================

rem ---- backend is the sibling directory ../hualong-backend (CLAUDE.md 7.3: one copy, or fail loudly)
set "BACKEND=%~dp0..\hualong-backend"
if not exist "%BACKEND%\db\testdata\server\server.mjs" (
  echo [ERROR] not found: %BACKEND%\db\testdata\server\server.mjs
  echo         hualong-backend must sit next to hualong-teacher.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found. Install Node.js 18+ and add it to PATH.
  pause
  exit /b 1
)

rem ---- PostgreSQL must be listening on 5432
netstat -ano | findstr /C:":5432 " | findstr /C:"LISTENING" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] nothing is listening on 5432. Start PostgreSQL first.
  pause
  exit /b 1
)

rem ---- already running? then just say so
set "PORT=3860"
netstat -ano | findstr /C:":%PORT% " | findstr /C:"LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo   server  http://127.0.0.1:%PORT%/api/v1  already running - nothing to do.
  echo   Check:  curl -s -o NUL -w "%%{http_code}" http://127.0.0.1:%PORT%/api/v1/auth/session   ^(401 = alive^)
  pause
  exit /b 0
)

echo.
echo   API      http://127.0.0.1:%PORT%/api/v1
echo   DB       postgres://postgres:postgres@localhost:5432/hualong_test
echo   Health   401 from /auth/session means alive
echo   Ctrl+C to stop. Closing this window kills the server.
echo.

cd /d "%BACKEND%\db\testdata"
node server\server.mjs

echo.
echo Server stopped (exit code %errorlevel%).
pause
endlocal
