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
rem ** Stop any earlier server on 3830-3837 first, then pick a port. **
rem
rem 2026-09-12: a server started earlier was still holding 3830, serving the code
rem as it was when IT started - server.mjs reads its modules once at startup and
rem has no hot reload. This block used to skip 3830 and start a second server on
rem 3831, while the tab the user already had open kept showing 3830. The two pages
rem look identical; the old one is simply missing text. Measured: 3830 was
rem 1,103,583 bytes, 3831 was 1,453,839 bytes. The user cleared their browser
rem cache twice, which cannot help - the stale thing is the server.
rem
rem Two consequences, both fixed by stopping first: the user could not tell which
rem server they were reading, and every double-click left another orphan behind
rem until all eight ports were busy and the launcher refused to start.
rem
rem NOTE: comments in this file are ASCII on purpose. cmd parses a UTF-8 .bat in
rem the console codepage, and Chinese comment bytes get mis-read - characters are
rem eaten across line boundaries and fragments of the next line run as commands.
rem Observed: `'s' is not recognized` and `'etstat' is not recognized` (the `n`
rem of netstat consumed by the previous line). A .bat is not a safe place for
rem non-ASCII comments; the reasoning belongs in docs, not here.
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
)

rem Wait for the kernel to release the listening socket: measured about 1 second.
rem A fixed 3-second wait, deliberately not a polling goto loop - that was tried
rem and did not work, cmd behaves badly with goto inside parenthesised blocks.
if "!STOPPED!"=="1" ping -n 4 127.0.0.1 >nul

rem Prefer 3830 so the address never drifts. Only fall back if something we did
rem not start is holding it.
set "PICKED="
netstat -ano | findstr /C:":3830 " | findstr /C:"LISTENING" >nul 2>nul
if errorlevel 1 (
  set "PICKED=3830"
) else (
  echo   [WARN] port 3830 is held by something we did not start - falling back.
  for %%P in (3831 3832 3833 3834 3835 3836 3837) do (
    if not defined PICKED (
      netstat -ano | findstr /C:":%%P " | findstr /C:"LISTENING" >nul 2>nul
      if errorlevel 1 set "PICKED=%%P"
    )
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
rem /pages and /roles re-read the two tsv files under db/spec on EVERY request
rem (screen-operations.tsv, operation-eli10.tsv). So after changing a mini-program
rem page you must re-scan, or the page keeps showing the old data. This step is
rem that re-scan, so nobody has to type it by hand. It scans the pages under
rem miniprogram/ and the contract. The page count is measured, never written down
rem here - it changes with every screen added. It also prints the "client calls a
rem path the contract does not have" rows right here; those are the signal to read.
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
rem Use `ping -n 3` rather than `timeout /t 2`: when launched from bash/MSYS the
rem coreutils `timeout` on PATH shadows the Windows one, so this step reports
rem `timeout: invalid time interval '/t'` and THE BROWSER DOES NOT OPEN. Double-
rem clicking in Explorer is fine, which makes it hard to spot. `ping` exists on
rem both sides and does not depend on PATH.
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://127.0.0.1:!PICKED!/pages"

node tools\swagger\server.mjs

echo.
echo Swagger UI stopped.
pause
endlocal
