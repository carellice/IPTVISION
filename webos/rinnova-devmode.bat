@echo off
rem Rinnova la modalità sviluppatore del TV LG (vedi README, sezione TV LG).
rem Si può far partire ogni giorno con l'Utilità di pianificazione di Windows.
cd /d "%~dp0"
node tools\devmode.js renew >> "%~dp0devmode-rinnovo.log" 2>&1
exit /b %ERRORLEVEL%
