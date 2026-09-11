@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   Hualong API contract - Swagger UI launcher (by module / by screen)
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

rem dry-run: report what would happen, then exit (no windows spawned, no files written)
if defined HL_DRYRUN (
  echo   [dry-run] would run npm run emit:screens first  ^(skip with HL_NO_REFRESH=1^)
  echo   [dry-run] would start Swagger UI  http://127.0.0.1:!PICKED!/
  echo   [dry-run] mock start flag = %STARTMOCK%  ^(1=would start, 0=already running^)
  echo   [dry-run] would open    http://127.0.0.1:!PICKED!/pages
  exit /b 0
)

rem ---- 3a) refresh the two spec tables BEFORE serving ----
rem /pages 与 /roles 是**每次请求现读** db/spec 的两份 tsv 的（screen-operations.tsv、operation-eli10.tsv）。
rem 所以改了小程序页面之后要重扫一次，否则页面上还是旧数据 —— 这段就是那一步，省得手打。
rem 扫的是 miniprogram/ 的 55 页与契约，不写库、不需要后端在跑。
rem 顺带它把「客户端调了、契约里没有的路径」直接打在这里（下面那几行 ④），那正是要看的信号。
echo   refreshing the spec tables ^(npm run emit:screens^) ...
if defined HL_NO_REFRESH (
  echo   [skipped] HL_NO_REFRESH is set
) else (
  if not exist "..\hualong-backend\db\spec" (
    echo   [WARN] ..\hualong-backend\db\spec not found - serving existing tables as-is.
  ) else (
    call npm run --silent emit:screens
    if errorlevel 1 echo   [WARN] emit:screens failed - serving whatever is on disk.
  )
)
echo.

rem ---- 3) start the mock in its own window if the port was free ----
if "%STARTMOCK%"=="1" (
  echo   starting mock  http://127.0.0.1:%MOCKPORT%/api/v1
  start "Hualong mock" cmd /k "cd /d ""%~dp0"" && set PORT=%MOCKPORT% && node mock\server.mjs"
)

rem ---- 4) swagger UI in the foreground with the chosen port ----
set "PORT=!PICKED!"
echo.
echo   Swagger UI    http://127.0.0.1:!PICKED!/
echo   By screen     http://127.0.0.1:!PICKED!/pages
echo   Role matrix   http://127.0.0.1:!PICKED!/roles
echo   Screen spec   http://127.0.0.1:!PICKED!/pages.yaml
echo   Raw contract  http://127.0.0.1:!PICKED!/openapi.yaml
echo   Ctrl+C to stop
echo.

rem open the browser after the server has bound, in a hidden background shell.
rem 用 `ping -n 3` 而不是 `timeout /t 2`：从 bash／MSYS 启动时 PATH 里 coreutils 的 `timeout` 会盖掉
rem Windows 那个，于是这一步报 `timeout: invalid time interval '/t'` 而**浏览器不会打开** ——
rem 在 Explorer 里双击又没事，所以很难发现。ping 两边都在，不挑 PATH。
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://127.0.0.1:!PICKED!/pages"

node tools\swagger\server.mjs

echo.
echo Swagger UI stopped.
pause
endlocal
