@echo off
rem Installazione guidata di IPTVISION su un TV LG (webOS): basta un doppio clic.
rem Controlla Node.js, scarica gli strumenti di LG e poi avvia la procedura passo passo (tools\installa-tv.js).
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title IPTVISION - installazione sul TV LG

where node >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
    echo Serve Node.js, che contiene gli strumenti per parlare con il TV.
    where winget >nul 2>nul
    if errorlevel 1 goto :nonode
    choice /C SN /M "Lo installo adesso con winget"
    if errorlevel 2 goto :nonode
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
    where node >nul 2>nul
    if errorlevel 1 goto :nonode
)

if not exist "node_modules\.bin\ares-install.cmd" (
    echo Scarico gli strumenti di LG ^(una volta sola, qualche minuto^)...
    call npm ci --no-fund --no-audit
    if errorlevel 1 (
        echo Download non riuscito: controlla la connessione e rilancia installa-tv.bat.
        goto :end
    )
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
