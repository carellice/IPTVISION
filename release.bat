@echo off
rem Pubblica una nuova versione di IPTVISION su GitHub con il setup per Windows.
rem   release.bat                      versione patch (1.2.3 -> 1.2.4), note dai commit
rem   release.bat minor                1.2.3 -> 1.3.0
rem   release.bat major "Note..."      2.0.0 con note personalizzate
setlocal
set "BUMP=%~1"
if "%BUMP%"=="" set "BUMP=patch"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release.ps1" -Bump "%BUMP%" -Notes "%~2"
set "CODE=%ERRORLEVEL%"
if not "%NO_PAUSE%"=="1" pause
exit /b %CODE%
