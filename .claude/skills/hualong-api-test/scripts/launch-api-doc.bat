@echo off
setlocal enabledelayedexpansion
rem This script lives in .claude/skills/hualong-api-test/scripts/ so the whole skill
rem can be shared as one unit. Four levels up is the repo root:
rem   scripts -> hualong-api-test -> skills -> .claude -> repo root
cd /d "%~dp0..\..\..\..\"

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
  echo [HINT] node_modules\swagger-ui-dist not found. Install deps first.
  echo        Install OUTSIDE this repo: npm cannot write into the Google Drive path.
  echo        It reports success and leaves 0-byte files behind.
  echo            1. mkdir "%USERPROFILE%\.hualong-teacher-deps"
  echo            2. cd /d "%USERPROFILE%\.hualong-teacher-deps"
  echo            3. copy the package.json from this repo here, then npm install
  echo            4. copy node_modules from there into this repo root
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
rem
rem **先把 3830-3837 上还活着的旧服务收干净，再挑埠。**
rem
rem 2026-09-12 实撞：一个更早启动的服务还占着 3830，它载的是**旧码**（`server.mjs` 只在
rem 启动时读一次模块，没有热加载）。于是这段挑埠逻辑跳开 3830、在 3831 起了新的 ——
rem 但用户手上那个旧的 3830 分页还在，而**旧码与新码的页面长得一样，只是没有文字**。
rem 用户连报两次「還是沒有文字」，还去清了浏览器 cache —— 清 cache 当然没用，
rem 因为**旧的是服务端，不是缓存**。实测两份页面：3830 是 1,103,583 字节（旧），
rem 3831 是 1,453,839 字节（新）。
rem
rem 两个后果：① 用户看不出来自己开的是哪一个；② 每次双击都多留一个孤儿，
rem 八个占满就整个起不来。所以「挑空闲的」这条思路是错的 —— 应当**先收干净再起一个**。
echo   stopping any earlier server on 3830-3837 ...
set "STOPPED=0"
for %%P in (3830 3831 3832 3833 3834 3835 3836 3837) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /C:":%%P " ^| findstr /C:"LISTENING"') do (
    taskkill /F /PID %%A >nul 2>nul
    if not errorlevel 1 (
      echo     stopped PID %%A on port %%P
      set "STOPPED=1"
    )
  )
)
if "!STOPPED!"=="1" (
  echo     an earlier server was serving the code as it was when *it* started.
  echo     That is why a page can look complete and still carry no text.
  ping -n 2 127.0.0.1 >nul
)

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
rem It scans the pages under miniprogram/ and the contract. The page count is measured,
rem never written down here - it changes with every screen added.
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

rem ---- 3b) the OTHER half: --emit writes the two tables but NOT the wiring report ----
rem /pages reads its service-layer column from the newest docs/audit/wiring-*.json, and
rem --emit does not write it (scan-wiring.mjs documents them as two separate paths).
rem So a stale column is the default state - measured 56 minutes on 2026-09-12.
node tools\check-report-freshness.mjs
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
echo   Review (write) http://127.0.0.1:!PICKED!/review
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
