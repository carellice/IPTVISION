#!/usr/bin/env node
/*
 * Installazione guidata di IPTVISION su un TV Samsung (Tizen): strumenti Tizen, modalità sviluppatore,
 * collegamento del PC al TV, certificato, firma del pacchetto .wgt e installazione.
 * Si avvia con installa-tv.bat, che prima controlla Node.js.
 * Fa da solo tutto quello che può; si ferma solo per le cose da fare sul TV.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const https = require('https');
const readline = require('readline');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO = 'carellice/IPTVISION';
const APP_ID = 'IPTVISION1.IPTVISION';
const PORT = 26101;
const PROFILE = 'IPTVISION';
const CLI_URL = 'https://download.tizen.org/sdk/Installer/tizen-studio_6.1/web-cli_Tizen_Studio_6.1_windows-64.exe';
// Impostazioni di questo PC (indirizzo del TV, certificato): fuori dal repository, sono personali.
const STATE_DIR = path.join(os.homedir(), '.iptvision-tizen');
const STATE_FILE = path.join(STATE_DIR, 'impostazioni.json');
const WIN = process.platform === 'win32';
// Windows scambia gli strumenti Tizen per programmi di installazione e chiederebbe i permessi di
// amministratore: senza RunAsInvoker l'avvio fallisce in silenzio (errore 740).
const AS_USER = Object.assign({}, process.env, { __COMPAT_LAYER: 'RunAsInvoker' });

// Le righe arrivano in coda, così non si perde niente se qualcuno scrive prima della domanda.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
const lines = [];
const waiting = [];
rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)));
rl.on('close', () => {
  console.log('\nInterrotto.');
  process.exit(1);
});

function ask(question, def) {
  process.stdout.write(question + (def ? ' [' + def + ']' : '') + ': ');
  return new Promise((resolve) => {
    const take = (a) => resolve(a.trim() || def || '');
    if (lines.length) take(lines.shift());
    else waiting.push(take);
  });
}

async function yes(question, def) {
  for (;;) {
    const a = (await ask(question + (def ? ' (S/n)' : ' (s/N)'))).toLowerCase();
    if (!a) return def;
    if (a === 's' || a === 'si' || a === 'sì' || a === 'y') return true;
    if (a === 'n' || a === 'no') return false;
  }
}

function pause(text) {
  return ask('\n' + (text || 'Premi Invio per continuare'));
}

function title(n, text) {
  console.log('\n' + '='.repeat(64) + '\n  ' + n + '. ' + text + '\n' + '='.repeat(64));
}

function quote(a) {
  return /[\s&()^'"]/.test(a) ? '"' + a.replace(/"/g, '') + '"' : a;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; }
}

function saveState(s) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function openUrl(url) {
  if (WIN) spawnSync('cmd', ['/c', 'start', '""', url], { stdio: 'ignore' });
  else spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
  console.log('Apro nel browser: ' + url);
}

// ---------- Strumenti Tizen ----------

let studio = '';

function findStudio(extra) {
  const candidates = [extra, process.env.TIZEN_STUDIO, 'C:\\tizen-studio', path.join(os.homedir(), 'tizen-studio')];
  return candidates.find((d) => d && fs.existsSync(path.join(d, 'tools', 'ide', 'bin', WIN ? 'tizen.bat' : 'tizen'))) || '';
}

// tizen.bat è un file batch, quindi serve la shell e la riga di comando si compone qui.
function tizen(args, opts) {
  const bin = path.join(studio, 'tools', 'ide', 'bin', WIN ? 'tizen.bat' : 'tizen');
  return spawnSync([bin].concat(args).map(quote).join(' '), Object.assign({ encoding: 'utf8', shell: true }, opts));
}

function sdb(args) {
  return spawnSync(path.join(studio, 'tools', WIN ? 'sdb.exe' : 'sdb'), args, { encoding: 'utf8' });
}

function output(r) {
  return ((r.stdout || '') + (r.stderr || '')).trim();
}

function get(url, file) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'IPTVISION-installer', Accept: 'application/vnd.github+json' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return get(res.headers.location, file).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' da ' + url));
      }
      if (file) {
        const out = fs.createWriteStream(file);
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(file)));
        out.on('error', reject);
      } else {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
      }
    }).on('error', reject);
  });
}

// ---------- 1. Strumenti ----------
async function stepTools() {
  title(1, 'Strumenti Samsung (Tizen Studio, solo riga di comando)');
  studio = findStudio(loadState().studio);
  if (studio) {
    console.log('Trovati in ' + studio + '.');
    return;
  }
  console.log('Servono gli strumenti gratuiti di Tizen per firmare l\'app e mandarla al TV (circa 300 MB).');
  if (!WIN) {
    console.log('Su questo sistema installali a mano da https://developer.tizen.org/development/tizen-studio/download');
    console.log('(pacchetto "CLI"), poi rilancia con TIZEN_STUDIO=<cartella> impostato.');
    throw new Error('strumenti Tizen non trovati');
  }
  for (;;) {
    const dir = await ask('Cartella dove installarli (senza spazi nel percorso)', 'C:\\tizen-studio');
    if (/\s/.test(dir)) {
      console.log('Il percorso non deve contenere spazi.');
      continue;
    }
    const exe = path.join(os.tmpdir(), path.basename(CLI_URL));
    if (!fs.existsSync(exe)) {
      console.log('Scarico l\'installazione da download.tizen.org...');
      await get(CLI_URL, exe + '.part');
      fs.renameSync(exe + '.part', exe);
    }
    console.log('Installo in ' + dir + ' (qualche minuto: accetto io la licenza di Tizen Studio)...');
    // Alla fine l'installazione aspetta Invio: glielo diamo noi.
    const run = spawnSync(exe, ['--accept-license', dir], { stdio: ['pipe', 'inherit', 'inherit'], input: '\n', env: AS_USER });
    if (run.error) console.log('Avvio non riuscito: ' + run.error.message);
    studio = findStudio(dir);
    if (studio) {
      saveState(Object.assign(loadState(), { studio }));
      console.log('Strumenti installati.');
      return;
    }
    console.log('Installazione non riuscita. Puoi anche installare Tizen Studio a mano da');
    console.log('https://developer.tizen.org/development/tizen-studio/download e indicare qui la cartella.');
  }
}

// ---------- 2. Modalità sviluppatore ----------
function pcAddresses() {
  const list = [];
  Object.values(os.networkInterfaces()).forEach((a) => (a || []).forEach((i) => {
    if (i.family === 'IPv4' && !i.internal && !/^169\.254\./.test(i.address)) list.push(i.address);
  }));
  return list;
}

async function stepDevMode() {
  title(2, 'Modalità sviluppatore sul TV');
  const ips = pcAddresses();
  console.log('Sul TV:');
  console.log('  1. apri "Apps" (le app, dalla barra Home);');
  console.log('  2. con il telecomando scrivi 1 2 3 4 5 (sui telecomandi senza numeri usa il tasto 123');
  console.log('     o i numeri a schermo): si apre la finestra "Developer Mode";');
  console.log('  3. metti "Developer mode" su On e in "Host PC IP" scrivi l\'indirizzo di questo PC:');
  console.log('       ' + (ips.length ? ips.join('   oppure   ') : '(non trovato: lo vedi con il comando ipconfig)'));
  console.log('     (se ce n\'è più di uno, quello che inizia come l\'indirizzo del TV);');
  console.log('  4. premi OK e riavvia il TV: tieni premuto il tasto di accensione finché non si spegne e riaccende.');
  console.log('Dopo il riavvio, in "Apps" compare la scritta "Developer Mode" in alto.');
  await pause('Premi Invio quando il TV si è riavviato');
}

// ---------- 3. Collegamento PC-TV ----------
function deviceList() {
  return output(sdb(['devices'])).split(/\r?\n/).filter((l) => /^\S+:\d+\s/.test(l));
}

function connected(serial) {
  return deviceList().some((l) => l.split(/\s+/)[0] === serial && /\bdevice\b/.test(l));
}

function portOpen(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 3000 });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.on('connect', () => done(true));
    s.on('timeout', () => done(false));
    s.on('error', () => done(false));
  });
}

async function stepConnect(knownHost) {
  title(3, 'Collegamento del PC al TV');
  for (;;) {
    const host = await ask('Indirizzo IP del TV (Impostazioni > Generali > Rete > Stato rete > Impostazioni IP)', knownHost);
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      console.log('Non sembra un indirizzo IP: scrivi quattro numeri separati da punti.');
      continue;
    }
    process.stdout.write('Controllo che il TV risponda... ');
    if (!(await portOpen(host, PORT))) {
      console.log('nessuna risposta.');
      console.log('Controlla che TV e PC siano sulla stessa rete, che "Developer mode" sia On con l\'IP di questo PC');
      console.log('e che il TV sia stato riavviato dopo averlo attivato.');
      if (!(await yes('Vuoi provare lo stesso?', false))) {
        knownHost = host;
        continue;
      }
    } else console.log('ok.');

    const serial = host + ':' + PORT;
    console.log(output(sdb(['connect', serial])));
    if (connected(serial)) {
      console.log('Il PC è collegato al TV.');
      saveState(Object.assign(loadState(), { host }));
      return serial;
    }
    console.log('Non riesco a comunicare con il TV. Di solito "Host PC IP" sul TV non è l\'indirizzo di questo PC.');
    knownHost = host;
  }
}

/** Codice univoco del TV: serve per il certificato Samsung. */
function duid(serial) {
  const r = sdb(['-s', serial, 'shell', '0', 'getduid']);
  return output(r).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || '';
}

// ---------- 4. Certificato ----------
function hasProfile(name) {
  return new RegExp('(^|\\s)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)', 'm').test(output(tizen(['security-profiles', 'list'])));
}

function makeTizenProfile() {
  const state = loadState();
  const password = state.certPassword || crypto.randomBytes(12).toString('hex');
  const dir = path.join(STATE_DIR, 'certificato');
  fs.mkdirSync(dir, { recursive: true });
  const p12 = path.join(dir, 'iptvision.p12');
  if (!fs.existsSync(p12)) {
    const r = tizen(['certificate', '-a', 'IPTVISION', '-p', password, '-c', 'IT', '-n', 'IPTVISION', '-f', 'iptvision', '--', dir]);
    if (!fs.existsSync(p12)) throw new Error('certificato non creato:\n' + output(r));
  }
  saveState(Object.assign(loadState(), { certPassword: password }));
  const add = tizen(['security-profiles', 'add', '-n', PROFILE, '-a', p12, '-p', password]);
  if (!hasProfile(PROFILE)) throw new Error('profilo di firma non creato:\n' + output(add));
}

async function samsungProfile(serial) {
  console.log('\nIl certificato Samsung si crea con Certificate Manager e un account Samsung (gratis).');
  const pm = path.join(studio, 'package-manager', WIN ? 'package-manager-cli.exe' : 'package-manager-cli.bin');
  const cm = path.join(studio, 'tools', 'certificate-manager', WIN ? 'certificate-manager.exe' : 'certificate-manager');
  if (!fs.existsSync(cm) && fs.existsSync(pm)) {
    console.log('Installo Certificate Manager e l\'estensione per i certificati Samsung (qualche minuto)...');
    spawnSync(pm, ['install', '--accept-license', 'Certificate-Manager', 'cert-add-on'], { stdio: ['pipe', 'inherit', 'inherit'], input: '\n', env: AS_USER });
  }
  const id = duid(serial);
  console.log('\nIn Certificate Manager:');
  console.log('  1. premi "+", scegli "Samsung" e poi "TV";');
  console.log('  2. come nome del profilo scrivi IPTVISION-Samsung;');
  console.log('  3. "Create a new author certificate": nome e password a piacere (segnateli), poi accedi con l\'account Samsung;');
  console.log('  4. nel certificato distributore lascia "Public" e controlla che ci sia il codice del TV (DUID):');
  console.log('       ' + (id || '(non letto: lo trovi in Device Manager di Tizen Studio)'));
  console.log('  5. premi Finish.');
  if (fs.existsSync(cm)) spawnSync('cmd', ['/c', 'start', '""', cm], { stdio: 'ignore', env: AS_USER });
  else console.log('Certificate Manager non trovato: installalo da Package Manager (Extension SDK > Samsung Certificate Extension).');
  for (;;) {
    const name = await ask('Nome del profilo che hai creato', 'IPTVISION-Samsung');
    if (hasProfile(name)) return name;
    console.log('Non trovo il profilo "' + name + '" tra quelli di Tizen. Controlla il nome in Certificate Manager.');
  }
}

async function stepCertificate(serial, wanted) {
  title(4, 'Certificato per firmare l\'app');
  const state = loadState();
  if (!wanted && state.profile && hasProfile(state.profile)) {
    console.log('Uso il profilo già pronto "' + state.profile + '".');
    return state.profile;
  }
  let choice = wanted;
  if (!choice) {
    console.log('I TV Samsung installano solo app firmate. Due possibilità:');
    console.log('  A. certificato Tizen: lo creo io adesso, senza account (va bene su molti TV)');
    console.log('  B. certificato Samsung: serve un account Samsung, è legato a questo TV');
    console.log('     (necessario se con il certificato Tizen il TV rifiuta l\'installazione)');
    do choice = (await ask('Scelta', 'A')).toUpperCase();
    while (!/^[AB]$/.test(choice));
  }
  let profile;
  if (choice === 'A') {
    console.log('Creo il certificato...');
    makeTizenProfile();
    profile = PROFILE;
  } else {
    profile = await samsungProfile(serial);
    // Con il certificato Samsung il TV deve conoscerlo prima dell'installazione.
    console.log(output(tizen(['install-permit', '-s', serial])));
  }
  saveState(Object.assign(loadState(), { profile }));
  console.log('Profilo di firma "' + profile + '" pronto.');
  return profile;
}

// ---------- 5. Installazione ----------
async function downloadLatest() {
  const rel = JSON.parse(await get('https://api.github.com/repos/' + REPO + '/releases/latest'));
  const asset = (rel.assets || []).find((a) => /\.wgt$/i.test(a.name));
  if (!asset) throw new Error('nella release ' + rel.tag_name + ' non c\'è un file .wgt');
  const file = path.join(os.tmpdir(), asset.name);
  console.log('Scarico ' + asset.name + ' (' + rel.tag_name + ')...');
  await get(asset.browser_download_url, file);
  return file;
}

/** Cartella con l'app pronta da firmare: dal .wgt indicato, da GitHub o da questa copia del progetto. */
async function source(answer) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'iptvision-tizen-'));
  try {
    return await unpack(answer, work);
  } catch (e) {
    fs.rmSync(work, { recursive: true, force: true });
    throw e;
  }
}

async function unpack(answer, work) {
  const src = path.join(work, 'app');
  if (answer.toLowerCase() === 'locale') {
    require('./build').writeDir(src);
    return { work, src };
  }
  const file = answer || (await downloadLatest());
  if (!fs.existsSync(file)) throw new Error('il file "' + file + '" non esiste');
  fs.mkdirSync(src);
  // Il .wgt è uno zip: tar di Windows 10 e successivi lo apre.
  const r = spawnSync(WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'unzip',
    WIN ? ['-xf', file, '-C', src] : ['-q', file, '-d', src], { encoding: 'utf8' });
  if (!fs.existsSync(path.join(src, 'config.xml'))) throw new Error('non riesco ad aprire ' + file + ':\n' + output(r));
  // Le vecchie firme si tolgono: il pacchetto si firma di nuovo con il certificato di questo PC.
  fs.readdirSync(src).filter((f) => /^(author-)?signature\d*\.xml$/i.test(f)).forEach((f) => fs.unlinkSync(path.join(src, f)));
  return { work, src };
}

function certificateProblem(text) {
  return /certificat|signature|author|distributor|-11\b|\b118\b/i.test(text);
}

async function stepInstall(serial, profile) {
  title(5, 'Installazione di IPTVISION');
  if (fs.existsSync(path.join(ROOT, '..', 'webos', 'app', 'index.html'))) {
    console.log('(Scrivi "locale" per installare la versione di questa cartella del progetto.)');
  }
  for (;;) {
    const answer = (await ask('Percorso del file .wgt (Invio per scaricare l\'ultima versione da GitHub)')).replace(/^"(.*)"$/, '$1');
    let pkg;
    try {
      pkg = await source(answer);
    } catch (e) {
      console.log('Problema: ' + e.message);
      continue;
    }
    console.log('Firmo il pacchetto con il profilo "' + profile + '"...');
    const out = path.join(pkg.work, 'firmato');
    fs.mkdirSync(out);
    const sign = tizen(['package', '-t', 'wgt', '-s', profile, '-o', out, '--', pkg.src]);
    const wgt = fs.readdirSync(out).find((f) => /\.wgt$/i.test(f));
    if (!wgt) {
      fs.rmSync(pkg.work, { recursive: true, force: true });
      console.log('Firma non riuscita:\n' + output(sign));
      if (!(await yes('Vuoi riprovare?', true))) return false;
      continue;
    }

    console.log('Installo sul TV...');
    const r = tizen(['install', '-n', wgt, '-s', serial, '--', out]);
    fs.rmSync(pkg.work, { recursive: true, force: true });
    const text = output(r);
    console.log(text);
    const failed = r.status !== 0 || /fail|error/i.test(text) || !/install(ed| completed)|succe/i.test(text);
    if (!failed) {
      tizen(['run', '-p', APP_ID, '-s', serial]);
      console.log('\nIPTVISION è installato e si sta aprendo sul TV. Lo trovi anche tra le app.');
      return true;
    }
    if (certificateProblem(text) && profile === PROFILE) {
      console.log('\nIl TV non accetta il certificato Tizen: serve quello Samsung.');
      if (await yes('Lo creiamo adesso?', true)) {
        profile = await stepCertificate(serial, 'B');
        continue;
      }
    }
    if (!(await yes('Installazione non riuscita. Vuoi riprovare?', true))) return false;
  }
}

async function main() {
  console.log('\n  IPTVISION per TV Samsung: installazione guidata');
  console.log('  Ti dico io cosa fare sul TV; il resto lo faccio da solo. Ctrl+C per uscire quando vuoi.');

  await stepTools();
  const state = loadState();
  let serial = '';
  if (state.host) {
    const known = state.host + ':' + PORT;
    console.log('\nQuesto PC è già stato collegato a un TV (' + state.host + ').');
    if (await yes('Vuoi saltare la configurazione e installare o aggiornare IPTVISION?', true)) {
      process.stdout.write('Verifico il collegamento... ');
      sdb(['connect', known]);
      serial = connected(known) ? known : '';
      console.log(serial ? 'ok.' : 'il TV non risponde: rifacciamo il collegamento.');
    }
  }
  if (!serial) {
    if (!state.host) await stepDevMode();
    else {
      console.log('\nSul TV controlla che "Developer Mode" sia attivo (in Apps, scrivi 1 2 3 4 5) con l\'IP di questo PC.');
      await pause();
    }
    serial = await stepConnect(state.host);
  }
  const profile = await stepCertificate(serial);
  if (await stepInstall(serial, profile)) {
    console.log('\nFatto. Per aggiornare IPTVISION in futuro basta rilanciare installa-tv.bat:');
    console.log('usa sempre lo stesso certificato, altrimenti il TV chiede di disinstallare prima la vecchia versione.');
  }
}

main()
  .catch((e) => {
    console.error('\nErrore: ' + (e.message || e));
    process.exitCode = 1;
  })
  .then(() => process.exit());
