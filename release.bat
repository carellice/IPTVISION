@echo off
rem Pubblica una nuova versione di IPTVISION su GitHub: setup per Windows, APK per Android/Android TV, .ipk per TV LG, .wgt per TV Samsung.
rem   release.bat                      versione patch (1.2.3 -> 1.2.4), note dai commit
rem   release.bat minor                1.2.3 -> 1.3.0
rem   release.bat major "Note..."      2.0.0 con note personalizzate (\n per andare a capo)
setlocal
rem UTF-8: le note con lettere accentate arrivano intatte a PowerShell.
chcp 65001 >nul
set "BUMP=%~1"
if "%BUMP%"=="" set "BUMP=patch"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release.ps1" -Bump "%BUMP%" -Notes "%~2"
set "CODE=%ERRORLEVEL%"
if not "%NO_PAUSE%"=="1" pause
exit /b %CODE%
