@echo off
setlocal EnableExtensions
chcp 65001 >nul
title IPTVISION per iPhone e iPad

rem ==========================================================================
rem  Installa, aggiorna e rinnova la firma di IPTVISION su iPhone e iPad,
rem  da Windows, con il proprio Apple ID gratuito.
rem  Firma e installazione: plumesign (CLI di Impactor, open source)
rem  https://github.com/khcrysalis/Impactor
rem ==========================================================================

set "DIR=%LOCALAPPDATA%\IPTVISION-iOS"
set "IPA=%DIR%\IPTVISION.ipa"
set "PLUME=%DIR%\plumesign.exe"
set "IPA_URL=https://github.com/carellice/IPTVISION/releases/download/ios/IPTVISION.ipa"
set "ARCH=x86_64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
set "PLUME_URL=https://github.com/khcrysalis/Impactor/releases/latest/download/plumesign-windows-%ARCH%.exe"
set "ACCOUNTS=%APPDATA%\PlumeImpactor\accounts.json"
rem Solo i messaggi utili di plumesign, non quelli di debug.
set "RUST_LOG=info"
if not exist "%DIR%" mkdir "%DIR%"

where curl.exe >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Serve Windows 10 versione 1803 o successiva, oppure Windows 11.
    pause
    exit /b 1
)

:menu
cls
echo.
echo  ============================================================
echo               IPTVISION per iPhone e iPad
echo  ============================================================
echo.
echo   1  Installa o aggiorna IPTVISION
echo      (usalo anche ogni 7 giorni per rinnovare la firma)
echo.
echo   2  Cambia Apple ID
echo.
echo   3  Esci
echo.
choice /c 123 /n /m "  Scegli 1, 2 o 3: "
if errorlevel 3 exit /b 0
if errorlevel 2 goto relogin
goto install

rem --------------------------------------------------------------------------
:install
cls
echo.
echo  [1/5] Controllo i driver Apple per collegare iPhone e iPad...
call :drivers || goto menu

echo.
echo  [2/5] Scarico lo strumento di firma (plumesign)...
call :download "%PLUME_URL%" "%PLUME%" || goto failnet

echo.
echo  [3/5] Scarico l'ultima versione di IPTVISION...
call :download "%IPA_URL%" "%IPA%" || goto failipa

echo.
echo  [4/5] Apple ID
call :ensurelogin || goto faillogin

echo.
echo  [5/5] Collega il dispositivo
echo.
echo     1. Collega l'iPhone o l'iPad al PC con il cavo USB.
echo     2. Sbloccalo.
echo     3. Se compare "Vuoi autorizzare questo computer?" tocca Autorizza
echo        e inserisci il codice del telefono.
echo.
pause
echo.
echo  Firmo e installo IPTVISION. Può volerci un minuto...
echo  (se hai più dispositivi collegati o più team, scegli con le frecce e premi Invio)
echo.
"%PLUME%" sign -p "%IPA%" --apple-id --register-and-install
if errorlevel 1 goto failsign
goto done

rem --------------------------------------------------------------------------
:relogin
cls
echo.
if exist "%PLUME%" if exist "%ACCOUNTS%" "%PLUME%" account logout >nul 2>&1
if not exist "%PLUME%" (
    echo  Scarico lo strumento di firma ^(plumesign^)...
    call :download "%PLUME_URL%" "%PLUME%" || goto failnet
)
call :login || goto faillogin
echo.
echo  Apple ID cambiato. Ora scegli 1 per installare IPTVISION con il nuovo account.
pause
goto menu

rem --------------------------------------------------------------------------
:done
echo.
echo  ============================================================
echo   FATTO! IPTVISION è installato.
echo  ============================================================
echo.
echo  Solo la PRIMA volta, sull'iPhone o iPad:
echo.
echo   a) Impostazioni ^> Generali ^> VPN e gestione dispositivi
echo      tocca il tuo Apple ID e poi "Autorizza".
echo.
echo   b) Su iOS 16 o successivo: Impostazioni ^> Privacy e sicurezza
echo      ^> Modalità sviluppatore: attivala, riavvia e conferma.
echo.
echo  La firma con un Apple ID gratuito dura 7 GIORNI: dopo, l'app non si apre.
echo  Per rinnovarla riapri questo file e scegli 1. Canali, liste e
echo  "Continua a guardare" restano salvati.
echo.
pause
goto menu

rem --------------------------------------------------------------------------
:failnet
echo.
echo  Download non riuscito. Controlla la connessione a Internet e riprova.
pause
goto menu

:failipa
echo.
echo  Non riesco a scaricare IPTVISION.ipa da:
echo  %IPA_URL%
echo  Controlla la connessione. Se il problema resta, l'app iOS potrebbe
echo  non essere ancora stata pubblicata: vedi ios\README.md.
pause
goto menu

:faillogin
echo.
echo  Accesso con l'Apple ID non riuscito. Controlla email, password e
echo  codice di verifica, poi riprova.
pause
goto menu

:failsign
echo.
echo  ------------------------------------------------------------
echo   Installazione non riuscita. Le cause più comuni:
echo  ------------------------------------------------------------
echo   - Dispositivo non collegato, bloccato o computer non autorizzato:
echo     scollega e ricollega il cavo, sblocca e tocca Autorizza.
echo   - Accesso all'Apple ID scaduto: scegli 2 dal menu e accedi di nuovo.
echo   - Con un Apple ID gratuito puoi avere al massimo 3 app firmate così
echo     sullo stesso dispositivo: elimina quelle che non usi.
echo   - Apple limita le nuove app firmate a 10 a settimana per Apple ID:
echo     se hai superato il limite, riprova tra qualche giorno.
echo.
pause
goto menu

rem ==========================================================================
rem  Sottoprogrammi
rem ==========================================================================

rem Il servizio Apple Mobile Device (installato con iTunes) ascolta sulla porta 27015.
:drivers
netstat -an | findstr /r /c:"127.0.0.1:27015 .*LISTENING" >nul && exit /b 0
echo.
echo  Mancano i driver Apple: si installano con iTunes (gratuito, di Apple).
echo.
where winget >nul 2>&1
if errorlevel 1 goto drivers_manual
choice /c SN /n /m "  Installo iTunes adesso? (S/N): "
if errorlevel 2 goto drivers_manual
winget install -e --id Apple.iTunes --accept-package-agreements --accept-source-agreements
rem Il servizio parte qualche secondo dopo l'installazione.
timeout /t 5 /nobreak >nul
netstat -an | findstr /r /c:"127.0.0.1:27015 .*LISTENING" >nul && exit /b 0
echo.
echo  iTunes è installato ma i driver non sono ancora attivi.
echo  Riavvia il PC e riapri questo file.
pause
exit /b 1

:drivers_manual
echo  Apro la pagina di Apple: scarica iTunes per Windows, installalo,
echo  poi riapri questo file.
start "" "https://support.apple.com/it-it/106372"
pause
exit /b 1

rem %1 = indirizzo, %2 = file. Scarica in un file temporaneo: se il download
rem fallisce resta la copia precedente, se c'è.
:download
curl.exe -fL --retry 3 --progress-bar -o "%~2.part" "%~1"
if errorlevel 1 (
    del "%~2.part" >nul 2>&1
    if exist "%~2" (
        echo  Download non riuscito: uso la copia già scaricata.
        exit /b 0
    )
    exit /b 1
)
move /y "%~2.part" "%~2" >nul
exit /b 0

:ensurelogin
if exist "%ACCOUNTS%" findstr /c:"@" "%ACCOUNTS%" >nul && (
    echo  Uso l'Apple ID già collegato. Per cambiarlo scegli 2 dal menu.
    exit /b 0
)
call :login
exit /b %errorlevel%

:login
echo.
echo  Serve un Apple ID (anche gratuito). Puoi usare il tuo o crearne uno
echo  apposta su https://account.apple.com
echo  Email e password vanno solo ad Apple: sul PC resta un accesso salvato
echo  in %APPDATA%\PlumeImpactor, non la password.
echo.
set "APPLEID="
set /p "APPLEID=  Apple ID (email): "
if not defined APPLEID exit /b 1
echo.
echo  Scrivi la password (non si vede mentre scrivi), poi premi Invio.
echo  Subito dopo Apple manda un codice di verifica ai tuoi dispositivi:
echo  scrivilo qui quando te lo chiede e premi Invio.
echo.
rem La password passa da PowerShell senza comparire sullo schermo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = Read-Host '  Password' -AsSecureString;" ^
  "$p = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s));" ^
  "& $env:PLUME account login -u $env:APPLEID -p $p; exit $LASTEXITCODE"
exit /b %errorlevel%
