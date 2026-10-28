; Setup di IPTVISION (Inno Setup 6).
; Compilato da release.bat:  ISCC.exe /DAppVersion=1.2.3 /DSourceDir=..\dist\IPTVISION installer\IPTVISION.iss
; Installazione per utente (nessun permesso di amministratore): così l'app si aggiorna da sola
; avviando questo setup con /SILENT.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\IPTVISION"
#endif

#define AppName "IPTVISION"
#define AppExe "IPTVISION.exe"
#define AppUrl "https://github.com/carellice/IPTVISION"

[Setup]
AppId={{6B0F3C1E-5A7D-4E2B-9C61-2F8D4A9B7E10}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=carellice
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppName}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\dist\installer
OutputBaseFilename=IPTVISION-Setup-{#AppVersion}
SetupIconFile=..\src\IPTVISION\Assets\iptvision.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
; Restart Manager disattivato: su oltre mille file impiega quasi un minuto. Il setup aspetta invece
; che IPTVISION si chiuda da solo (vedi InitializeSetup); se è ancora aperto, AppMutex chiede di chiuderlo.
CloseApplications=no
RestartApplications=no
AppMutex=IPTVISION.Running

[Languages]
Name: "it"; MessagesFile: "compiler:Languages\Italian.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; Ogni versione porta i suoi file: niente avanzi della precedente (le impostazioni sono in AppData, non qui).
Type: filesandordirs; Name: "{app}\libvlc"
Type: files; Name: "{app}\*.dll"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
; Installazione normale: casella "Avvia IPTVISION" alla fine.
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
; Aggiornamento dall'app (/SILENT): riapre IPTVISION da solo.
Filename: "{app}\{#AppExe}"; Flags: nowait postinstall skipifnotsilent

[Code]
// Aggiornamento dall'app: IPTVISION avvia il setup e si chiude subito dopo.
// Diamo all'app fino a 20 secondi per uscire prima del controllo di AppMutex.
function InitializeSetup(): Boolean;
var
  Waited: Integer;
begin
  Waited := 0;
  while CheckForMutexes('{#SetupSetting("AppMutex")}') and (Waited < 80) do
  begin
    Sleep(250);
    Waited := Waited + 1;
  end;
  Result := True;
end;

[UninstallDelete]
; Solo la cache scaricabile di nuovo; account, preferiti e posizioni restano in %APPDATA%\IPTVISION.
Type: filesandordirs; Name: "{localappdata}\IPTVISION\updates"
