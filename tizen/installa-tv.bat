@echo off
rem Installazione guidata di IPTVISION su un TV Samsung (Tizen): basta un doppio clic.
rem Controlla Node.js e poi avvia la procedura passo passo (tools\installa-tv.js),
rem che scarica da sola gli strumenti di Tizen se mancano.
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title IPTVISION - installazione sul TV Samsung

where node >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
    echo Serve Node.js, che esegue la procedura guidata.
    where winget >nul 2>nul
    if errorlevel 1 goto :nonode
    choice /C SN /M "Lo installo adesso con winget"
    if errorlevel 2 goto :nonode
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
    where node >nul 2>nul
    if errorlevel 1 goto :nonode
)

node tools\installa-tv.js
goto :end

:nonode
echo.
echo Installa Node.js da https://nodejs.org ^(versione LTS^), poi rilancia installa-tv.bat.
start "" https://nodejs.org

:end
echo.
pause
