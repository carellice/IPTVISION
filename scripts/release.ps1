<#
  Pubblica una nuova versione di IPTVISION:
    1. incrementa la versione in IPTVISION.csproj (patch, oppure minor/major)
    2. compila l'app (self-contained, non serve installare .NET)
    3. crea il setup con Inno Setup
    4. compila l'APK Android (telefoni e Android TV), con la stessa versione
    5. crea il pacchetto .ipk per i TV LG (webOS), con la stessa versione
    6. commit + tag vX.Y.Z + push
    7. crea la release su GitHub e carica setup, APK e .ipk

  Uso:  release.bat [patch|minor|major] ["note della versione"]
#>
param(
    [ValidateSet('patch', 'minor', 'major')] [string]$Bump = 'patch',
    [string]$Notes = ''
)

# 'Continue': in PowerShell 5 l'output di errore dei programmi esterni (git, gh) non deve fermare lo script;
# ogni comando esterno è controllato da Run tramite il codice di uscita.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$Csproj = Join-Path $Root 'src\IPTVISION\IPTVISION.csproj'
$Dist = Join-Path $Root 'dist\IPTVISION'
$InstallerDir = Join-Path $Root 'dist\installer'
$Iss = Join-Path $Root 'installer\IPTVISION.iss'
$AndroidDir = Join-Path $Root 'android'
$KeystoreProps = Join-Path $AndroidDir 'keystore.properties'
$WebosDir = Join-Path $Root 'webos'
$WebosAppInfo = Join-Path $WebosDir 'app\appinfo.json'
$WebosVersionJs = Join-Path $WebosDir 'app\js\version.js'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`nERRORE: $text" -ForegroundColor Red; exit 1 }
function Run($exe, [string[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "$exe $($arguments -join ' ') ha restituito $LASTEXITCODE" }
}

function Find-AndroidSdk {
    $candidates = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android\Sdk'))
    return $candidates | Where-Object { $_ -and (Test-Path (Join-Path $_ 'platforms')) } | Select-Object -First 1
}

function Find-Keytool {
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\keytool.exe'))) { return (Join-Path $env:JAVA_HOME 'bin\keytool.exe') }
    $cmd = Get-Command keytool.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

# La chiave che firma l'APK deve restare sempre la stessa, altrimenti gli aggiornamenti non si installano.
# Sta fuori dal progetto (in %USERPROFILE%\.android\iptvision-signing): se manca la si crea una volta sola.
function Ensure-Keystore {
    if (Test-Path $KeystoreProps) { return }
    $dir = Join-Path $env:USERPROFILE '.android\iptvision-signing'
    $store = Join-Path $dir 'iptvision.keystore'
    $props = Join-Path $dir 'signing.properties'
    if (-not (Test-Path $props)) {
        if (Test-Path $store) { Fail "Trovato $store ma non $props con la password" }
        $keytool = Find-Keytool
        if (-not $keytool) { Fail 'keytool non trovato: installa un JDK 17+ e imposta JAVA_HOME' }
        New-Item -ItemType Directory -Force $dir | Out-Null
        $bytes = New-Object byte[] 24
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $pass = [Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', ''
        Write-Host "Creo la chiave di firma Android: $store"
        Run $keytool @('-genkeypair', '-keystore', $store, '-alias', 'iptvision', '-keyalg', 'RSA', '-keysize', '4096',
            '-validity', '36500', '-storepass', $pass, '-keypass', $pass, '-dname', 'CN=IPTVISION, O=carellice, C=IT')
        $storePath = $store.Replace('\', '/')
        [IO.File]::WriteAllText($props, "storeFile=$storePath`nstorePassword=$pass`nkeyAlias=iptvision`nkeyPassword=$pass`n", $Utf8)
        Write-Host 'IMPORTANTE: fai una copia di sicurezza della cartella iptvision-signing. Senza quella chiave' -ForegroundColor Yellow
        Write-Host 'chi ha già installato l''app Android non potrà più aggiornarla.' -ForegroundColor Yellow
    }
    Copy-Item $props $KeystoreProps -Force
}

function Find-Iscc {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
    )
    $found = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($found) { return $found }
    $cmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

Set-Location $Root

# ---------- Controlli ----------
Step 'Controllo strumenti'
foreach ($tool in 'dotnet', 'git', 'gh', 'npm') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool non trovato nel PATH" }
}
gh auth status *> $null
if ($LASTEXITCODE -ne 0) { Fail "GitHub CLI non autenticata: esegui 'gh auth login'" }

$iscc = Find-Iscc
if (-not $iscc) {
    Write-Host 'Inno Setup non trovato: lo installo con winget...'
    winget install --id JRSoftware.InnoSetup -e --silent --scope user --accept-package-agreements --accept-source-agreements
    $iscc = Find-Iscc
    if (-not $iscc) { Fail 'Inno Setup non installato. Scaricalo da https://jrsoftware.org/isdl.php' }
}

$sdk = Find-AndroidSdk
if (-not $sdk) { Fail 'Android SDK non trovato: installa Android Studio oppure imposta ANDROID_HOME' }
$localProps = Join-Path $AndroidDir 'local.properties'
if (-not (Test-Path $localProps)) {
    [IO.File]::WriteAllText($localProps, "sdk.dir=$($sdk.Replace('\', '/').Replace(':', '\:'))`n", $Utf8)
}
Ensure-Keystore

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($LASTEXITCODE -ne 0) { Fail 'Questa cartella non è una repository git' }

# ---------- Versione ----------
Step 'Nuova versione'
$xml = [IO.File]::ReadAllText($Csproj)
$match = [regex]::Match($xml, '<Version>(\d+)\.(\d+)\.(\d+)</Version>')
if (-not $match.Success) { Fail 'Tag <Version>X.Y.Z</Version> non trovato in IPTVISION.csproj' }
$major = [int]$match.Groups[1].Value; $minor = [int]$match.Groups[2].Value; $patch = [int]$match.Groups[3].Value
$old = "$major.$minor.$patch"
switch ($Bump) {
    'major' { $major++; $minor = 0; $patch = 0 }
    'minor' { $minor++; $patch = 0 }
    default { $patch++ }
}
$version = "$major.$minor.$patch"
$tag = "v$version"

# Il tag non deve esistere già (in locale o su GitHub).
git rev-parse -q --verify "refs/tags/$tag" *> $null
if ($LASTEXITCODE -eq 0) { Fail "Il tag $tag esiste già" }
Write-Host "$old -> $version"

$originalXml = $xml
[IO.File]::WriteAllText($Csproj, $xml.Remove($match.Index, $match.Length).Insert($match.Index, "<Version>$version</Version>"), $Utf8)

# webOS non legge il .csproj: la versione va scritta in appinfo.json e in version.js (mostrata nell'app).
$originalAppInfo = [IO.File]::ReadAllText($WebosAppInfo)
$originalVersionJs = [IO.File]::ReadAllText($WebosVersionJs)
[IO.File]::WriteAllText($WebosAppInfo, ($originalAppInfo -replace '"version"\s*:\s*"[^"]*"', "`"version`": `"$version`""), $Utf8)
[IO.File]::WriteAllText($WebosVersionJs, ($originalVersionJs -replace "IPTV\.VERSION = '[^']*'", "IPTV.VERSION = '$version'"), $Utf8)

try {
    # ---------- Compilazione ----------
    Step 'Compilazione'
    if (Test-Path $Dist) { Remove-Item $Dist -Recurse -Force -ErrorAction Stop }
    Run dotnet @('publish', $Csproj, '-c', 'Release', '-o', $Dist, '--self-contained', 'true',
        '-p:PublishReadyToRun=true', '-p:DebugType=none', '-nologo')

    # ---------- Setup ----------
    Step 'Creazione setup'
    Run $iscc @('/Q', "/DAppVersion=$version", "/DSourceDir=$Dist", $Iss)
    $setup = Join-Path $InstallerDir "IPTVISION-Setup-$version.exe"
    if (-not (Test-Path $setup)) { throw "Setup non trovato: $setup" }
    $sizeMb = '{0:N1}' -f ((Get-Item $setup).Length / 1MB)
    Write-Host "Setup: $setup ($sizeMb MB)"

    # ---------- Android ----------
    # La versione dell'APK si legge da IPTVISION.csproj, già aggiornato qui sopra.
    Step 'Compilazione APK Android'
    Push-Location $AndroidDir
    try { Run (Join-Path $AndroidDir 'gradlew.bat') @('assembleRelease', '--console=plain', '-q') }
    finally { Pop-Location }
    $apk = Join-Path $InstallerDir "IPTVISION-$version.apk"
    Copy-Item (Join-Path $AndroidDir 'app\build\outputs\apk\release\app-release.apk') $apk -Force -ErrorAction Stop
    $apkMb = '{0:N1}' -f ((Get-Item $apk).Length / 1MB)
    Write-Host "APK: $apk ($apkMb MB)"

    # ---------- TV LG (webOS) ----------
    Step 'Pacchetto per TV LG (webOS)'
    Push-Location $WebosDir
    try {
        # Gli strumenti di LG (ares-package) stanno in webos/node_modules.
        if (-not (Test-Path (Join-Path $WebosDir 'node_modules\.bin\ares-package.cmd'))) { Run 'npm' @('ci', '--no-fund', '--no-audit') }
        $ipkTmp = Join-Path $env:TEMP "iptvision-ipk-$version"
        if (Test-Path $ipkTmp) { Remove-Item $ipkTmp -Recurse -Force }
        Run (Join-Path $WebosDir 'node_modules\.bin\ares-package.cmd') @('app', '-o', $ipkTmp)
    }
    finally { Pop-Location }
    $ipk = Join-Path $InstallerDir "IPTVISION-$version.ipk"
    Copy-Item (Get-ChildItem $ipkTmp -Filter '*.ipk' | Select-Object -First 1).FullName $ipk -Force -ErrorAction Stop
    Remove-Item $ipkTmp -Recurse -Force -ErrorAction SilentlyContinue
    $ipkKb = '{0:N0}' -f ((Get-Item $ipk).Length / 1KB)
    Write-Host "IPK: $ipk ($ipkKb KB)"
}
catch {
    [IO.File]::WriteAllText($Csproj, $originalXml, $Utf8)
    [IO.File]::WriteAllText($WebosAppInfo, $originalAppInfo, $Utf8)
    [IO.File]::WriteAllText($WebosVersionJs, $originalVersionJs, $Utf8)
    Fail "$($_.Exception.Message)`nVersione riportata a $old."
}

# ---------- Note di rilascio ----------
# Da release.bat gli a capo non passano: nelle note si scrive \n e qui diventa un a capo vero.
$Notes = $Notes -replace '\\n', "`n"
if (-not $Notes) {
    $lastTag = (git describe --tags --abbrev=0 2>$null)
    $range = if ($LASTEXITCODE -eq 0 -and $lastTag) { "$($lastTag.Trim())..HEAD" } else { 'HEAD' }
    $log = git log $range --pretty=format:'- %s' --no-merges 2>$null | Where-Object { $_ -notmatch '^- Release v' }
    $Notes = if ($log) { ($log -join "`n") } else { 'Miglioramenti e correzioni.' }
}
$notesFile = Join-Path $env:TEMP "iptvision-notes-$version.md"
$body = @"
$Notes

---
**Windows:** scarica ``IPTVISION-Setup-$version.exe`` e avvialo (non servono permessi di amministratore).
**Android e Android TV:** scarica ``IPTVISION-$version.apk`` sul dispositivo e aprilo (consenti l'installazione da origini sconosciute).
**TV LG (webOS):** installa ``IPTVISION-$version.ipk`` dal PC con la modalità sviluppatore attiva (guida nel README).
Chi ha già IPTVISION riceve l'aggiornamento direttamente dall'app (Impostazioni → Aggiornamenti).
"@
[IO.File]::WriteAllText($notesFile, $body, $Utf8)

# ---------- Git ----------
Step "Commit e tag $tag"
Run git @('add', '-A')
Run git @('commit', '-m', "Release $tag")
Run git @('tag', '-a', $tag, '-m', "IPTVISION $version")
Run git @('push', 'origin', $branch)
Run git @('push', 'origin', $tag)

# ---------- Release GitHub ----------
Step 'Pubblicazione release su GitHub'
Run gh @('release', 'create', $tag, $setup, $apk, $ipk, '--title', "IPTVISION $version", '--notes-file', $notesFile, '--latest')
Remove-Item $notesFile -ErrorAction SilentlyContinue

$url = (gh release view $tag --json url -q .url)
Write-Host "`nFatto: IPTVISION $version pubblicato" -ForegroundColor Green
Write-Host $url
