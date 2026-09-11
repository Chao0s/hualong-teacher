@echo off
rem The real launcher lives in .claude/skills/hualong-api-test/scripts/launch-api-doc.bat,
rem beside the checker that reads the same tables, so the skill ships as one unit.
rem This file is only the double-click entry point. Do not add logic here.
call "%~dp0.claude\skills\hualong-api-test\scripts\launch-api-doc.bat" %*
exit /b %ERRORLEVEL%
