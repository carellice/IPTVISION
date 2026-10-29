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
  const last = output(r).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || '';
  return /^[A-Z0-9]{8,}$/i.test(last) ? last : '';
}

// ---------- 4. Certificati ----------

/** Codice del TV collegato (DUID), letto una volta dopo il collegamento. */
let tvDuid = '';

function heading(text) {
  console.log('\n' + '='.repeat(64) + '\n  ' + text + '\n' + '='.repeat(64));
}

function profilesXml() {
  const m = output(tizen(['security-profiles', 'list'])).match(/Loaded in '([^']+)'/);
  try { return fs.readFileSync(m ? m[1] : path.join(studio + '-data', 'profile', 'profiles.xml'), 'utf8'); } catch (e) { return ''; }
}

/** Profili di firma di Tizen Studio: nome e file dei certificati autore e distributore. */
function profiles() {
  const list = [];
  const re = /<profile name="([^"]*)">([\s\S]*?)<\/profile>/g;
  const xml = profilesXml();
  let m;
  while ((m = re.exec(xml))) {
    const body = m[2];
    const key = (d) => {
      const item = body.match(new RegExp('<profileitem\\b[^>]*\\bdistributor="' + d + '"[^>]*>'));
      return (item && (item[0].match(/\bkey="([^"]*)"/) || [])[1]) || '';
    };
    list.push({ name: m[1], author: key(0), distributor: key(1) });
  }
  return list;
}

function findProfile(name) {
  return profiles().find((p) => p.name === name);
}

function hasProfile(name) {
  return !!findProfile(name);
}

function readCert(file) {
  try { return new crypto.X509Certificate(fs.readFileSync(file)); } catch (e) { return null; }
}

function date(d) {
  return d.toLocaleDateString('it-IT');
}

/** Tipo, scadenza, TV per cui vale e problemi di un profilo, rispetto al TV collegato. */
function check(p) {
  const samsung = !!p.distributor && !/tizen-distributor-signer/i.test(p.distributor);
  const info = { samsung, duids: [], until: null, problems: [] };
  if (!p.author || !fs.existsSync(p.author)) info.problems.push('manca il certificato autore' + (p.author ? ' (' + p.author + ')' : ''));
  if (samsung) {
    if (!fs.existsSync(p.distributor)) info.problems.push('manca il certificato distributore (' + p.distributor + ')');
    // Certificate Manager salva accanto ai .p12 anche i certificati in chiaro: lì si legge per quale TV valgono.
    const dist = readCert(path.join(path.dirname(p.distributor), 'distributor.crt'));
    const auth = readCert(path.join(path.dirname(p.author), 'author.crt'));
    if (!dist) info.problems.push('non trovo distributor.crt accanto a distributor.p12: non posso controllare per quale TV vale');
    else {
      info.duids = String(dist.subjectAltName || '').split(/,\s*/).map((s) => (s.match(/deviceid=(.*)$/) || [])[1]).filter(Boolean);
      info.until = new Date(dist.validTo);
      if (!info.duids.length) info.problems.push('non contiene il codice di nessun TV (DUID)');
      else if (tvDuid && info.duids.indexOf(tvDuid) < 0) {
        info.problems.push('vale per ' + info.duids.join(', ') + ', ma il codice di questo TV (DUID) è ' + tvDuid);
      }
    }
    if (auth && (!info.until || new Date(auth.validTo) < info.until)) info.until = new Date(auth.validTo);
  }
  if (info.until && info.until < new Date()) info.problems.push('è scaduto il ' + date(info.until));
  return info;
}

function describe(p, n, inUse) {
  const c = check(p);
  let line = (n ? n + '. ' : '') + p.name + ' (' + (c.samsung ? 'Samsung' : 'Tizen');
  if (c.until) line += ', valido fino al ' + date(c.until);
  if (c.duids.length) line += ', per il TV ' + c.duids.join(', ');
  console.log(line + ')' + (inUse ? '  <- usato per firmare' : ''));
  c.problems.forEach((x) => console.log('     PROBLEMA: ' + x));
  return c;
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

/** Toglie il profilo da Tizen e, se stanno in una cartella tutta sua, anche i file dei certificati. */
async function removeProfile(p) {
  tizen(['security-profiles', 'remove', '-n', p.name]);
  const ours = path.join(STATE_DIR, 'certificato');
  const dir = p.author ? path.dirname(p.author) : '';
  const own = dir && (path.resolve(dir) === path.resolve(ours) || /^samsungcertificate$/i.test(path.basename(path.dirname(dir))));
  const state = loadState();
  if (own && fs.existsSync(dir)) {
    // Il certificato Tizen senza la sua password non serve più: si cancella sempre insieme al profilo.
    const tizenCert = path.resolve(dir) === path.resolve(ours);
    if (tizenCert || (await yes('Cancello anche i file del certificato in ' + dir + '?', true))) {
      fs.rmSync(dir, { recursive: true, force: true });
      if (tizenCert) delete state.certPassword;
      console.log('File cancellati.');
    }
  }
  if (state.profile === p.name) delete state.profile;
  if (state.samsungProfile === p.name) delete state.samsungProfile;
  saveState(state);
  console.log('Profilo "' + p.name + '" cancellato.');
}

/** Con il certificato Samsung il TV deve conoscerlo prima dell'installazione: install-permit usa il profilo attivo. */
function permit(serial, profile) {
  tizen(['security-profiles', 'set-active', '-n', profile]);
  console.log(output(tizen(['install-permit', '-s', serial])));
}

function useProfile(serial, name) {
  saveState(Object.assign(loadState(), { profile: name }));
  const p = findProfile(name);
  if (p && check(p).samsung) {
    saveState(Object.assign(loadState(), { samsungProfile: name }));
    console.log('Mando il certificato al TV...');
    permit(serial, name);
  }
  console.log('Per firmare uso "' + name + '".');
}

function certificateManager() {
  const pm = path.join(studio, 'package-manager', WIN ? 'package-manager-cli.exe' : 'package-manager-cli.bin');
  const cm = path.join(studio, 'tools', 'certificate-manager', WIN ? 'certificate-manager.exe' : 'certificate-manager');
  if (!fs.existsSync(cm) && fs.existsSync(pm)) {
    console.log('Installo Certificate Manager e l\'estensione per i certificati Samsung (qualche minuto)...');
    spawnSync(pm, ['install', '--accept-license', 'Certificate-Manager', 'cert-add-on'], { stdio: ['pipe', 'inherit', 'inherit'], input: '\n', env: AS_USER });
  }
  return fs.existsSync(cm) ? cm : '';
}

/** Creazione guidata del certificato Samsung, con controllo finale del codice del TV. Restituisce il nome o ''. */
async function createSamsungProfile(serial) {
  heading('Nuovo certificato Samsung');
  const id = tvDuid || duid(serial);
  if (!id) {
    console.log('Non riesco a leggere il codice del TV (DUID): controlla che il TV sia acceso e collegato, poi riprova.');
    return '';
  }
  console.log('Serve un account Samsung, gratis: se non ce l\'hai, lo crei durante l\'accesso.');
  console.log('Il certificato vale solo per i TV indicati con il loro codice (DUID). Quello di questo TV è:');
  console.log('\n       ' + id + '\n');
  if (WIN && spawnSync('clip', [], { input: id }).status === 0) console.log('(L\'ho copiato negli appunti: quando serve basta Ctrl+V.)');

  let name;
  for (;;) {
    name = await ask('Nome del nuovo profilo (lettere, numeri e trattini)', 'IPTVISION-Samsung');
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      console.log('Usa solo lettere, numeri, punti e trattini, senza spazi.');
      continue;
    }
    const old = findProfile(name);
    if (!old) break;
    console.log('Esiste già un profilo con questo nome:');
    describe(old);
    if (await yes('Lo cancello e lo ricreo?', true)) {
      await removeProfile(old);
      break;
    }
  }

  const cm = certificateManager();
  if (!cm) {
    console.log('Certificate Manager non trovato. Installalo da Package Manager di Tizen Studio');
    console.log('(Extension SDK > Samsung Certificate Extension) e riprova.');
    return '';
  }
  console.log('\nApro Certificate Manager. Fai così (se una schermata è un po\' diversa, conta solo quello che è in maiuscolo):');
  console.log('  1. premi il pulsante "+" in alto a destra;');
  console.log('  2. scegli il tipo SAMSUNG, poi Next;');
  console.log('  3. scegli il dispositivo TV, poi Next;');
  console.log('  4. in "Certificate profile name" scrivi ESATTAMENTE ' + name + ', poi Next;');
  console.log('  5. scegli "Create a new author certificate", poi Next. In "Author name" scrivi il tuo nome e una');
  console.log('     password a piacere, due volte (non devi ricordarla: la conserva Tizen). Next, poi accedi con');
  console.log('     l\'account Samsung nella pagina che si apre;');
  console.log('  6. certificato distributore: lascia "Create a new distributor certificate" e il privilegio "Public".');
  console.log('     Nella lista dei DUID deve esserci SOLO ' + id + '.');
  console.log('     Se c\'è altro (per esempio un indirizzo come ' + serial + ') selezionalo e rimuovilo;');
  console.log('     se manca, aggiungilo con "Add individual DUID" (o "+") e incolla con Ctrl+V. Poi Next;');
  console.log('  7. premi Finish (se lo chiede, accedi di nuovo) e chiudi Certificate Manager.');
  spawnSync('cmd', ['/c', 'start', '""', cm], { stdio: 'ignore', env: AS_USER });

  for (;;) {
    await pause('Premi Invio quando hai premuto Finish');
    const p = findProfile(name);
    if (!p) {
      console.log('Non trovo il profilo "' + name + '". Profili presenti: ' + (profiles().map((x) => x.name).join(', ') || 'nessuno') + '.');
      console.log('Se l\'hai chiamato in un altro modo, cancellalo dal menu dei certificati e ricrealo con questo nome.');
      if (!(await yes('Vuoi ricontrollare?', true))) return '';
      continue;
    }
    console.log('\nControllo il certificato:');
    const c = describe(p);
    if (!c.samsung) {
      console.log('     PROBLEMA: è un certificato Tizen, non Samsung (al passo 2 va scelto Samsung).');
      c.problems.push('tipo');
    }
    if (!c.problems.length) {
      console.log('Tutto giusto: il certificato vale per questo TV.');
      return name;
    }
    if (await yes('Il certificato non va bene. Lo cancello e lo rifacciamo?', true)) {
      await removeProfile(p);
      return createSamsungProfile(serial);
    }
    return name;
  }
}

/** Elenco dei profili da cui sceglierne uno per numero. */
async function pickProfile(question) {
  const list = profiles();
  if (!list.length) {
    console.log('Non ci sono profili.');
    return null;
  }
  for (;;) {
    const a = await ask(question + ' (numero, Invio per annullare)');
    if (!a) return null;
    const p = list[parseInt(a, 10) - 1];
    if (p) return p;
  }
}

async function manageCertificates(serial) {
  for (;;) {
    heading('Gestione dei certificati');
    if (tvDuid) console.log('TV collegato: ' + serial + ', codice (DUID) ' + tvDuid + '\n');
    const inUse = loadState().profile;
    const list = profiles();
    if (!list.length) console.log('Non ci sono ancora profili di firma.');
    list.forEach((p, i) => describe(p, i + 1, p.name === inUse));
    console.log('\n  U. usa un profilo per firmare');
    console.log('  T. crea il certificato Tizen (o ricrealo)');
    console.log('  S. crea un certificato Samsung, passo per passo');
    console.log('  C. cancella un profilo');
    console.log('  P. rimanda al TV il certificato Samsung in uso');
    console.log('  I. torna indietro');
    const c = (await ask('Scelta', 'I')).toUpperCase();
    if (c === 'I') return;
    if (c === 'U') {
      const p = await pickProfile('Quale profilo usare');
      if (p) useProfile(serial, p.name);
    } else if (c === 'T') {
      const old = findProfile(PROFILE);
      if (old) {
        if (!(await yes('Il certificato Tizen c\'è già. Lo cancello e lo ricreo?', false))) continue;
        await removeProfile(old);
      }
      console.log('Creo il certificato Tizen...');
      makeTizenProfile();
      console.log('Fatto.');
      if (await yes('Lo uso per firmare?', true)) useProfile(serial, PROFILE);
    } else if (c === 'S') {
      const name = await createSamsungProfile(serial);
      if (name && (await yes('Lo uso per firmare?', true))) useProfile(serial, name);
    } else if (c === 'C') {
      const p = await pickProfile('Quale profilo cancellare');
      if (p && (await yes('Cancello il profilo "' + p.name + '"? Non si può annullare', false))) await removeProfile(p);
    } else if (c === 'P') {
      const p = inUse && findProfile(inUse);
      if (p && check(p).samsung) permit(serial, p.name);
      else console.log('Il profilo in uso non è Samsung: con il certificato Tizen non serve.');
    }
  }
}

async function stepCertificate(serial, wanted) {
  title(4, 'Certificato per firmare l\'app');
  const state = loadState();
  const current = !wanted && state.profile && findProfile(state.profile);
  if (current) {
    console.log('Uso il profilo "' + current.name + '":');
    const c = describe(current);
    if (!c.problems.length) return current.name;
    console.log('\nCosì il TV lo rifiuterà.');
    if (await yes('Apro la gestione dei certificati per sistemarlo?', true)) {
      await manageCertificates(serial);
      const now = loadState().profile;
      if (now && hasProfile(now)) return now;
    } else return current.name;
  }
  let choice = wanted;
  if (!choice) {
    console.log('I TV Samsung installano solo app firmate. Due possibilità:');
    console.log('  A. certificato Tizen: lo creo io adesso, senza account (va bene su molti TV)');
    console.log('  B. certificato Samsung: serve un account Samsung, vale solo per questo TV');
    console.log('     (se con uno dei due il TV rifiuta l\'installazione, prova l\'altro)');
    do choice = (await ask('Scelta', 'A')).toUpperCase();
    while (!/^[AB]$/.test(choice));
  }
  let profile;
  if (choice === 'A') {
    if (!hasProfile(PROFILE)) {
      console.log('Creo il certificato...');
      makeTizenProfile();
    }
    profile = PROFILE;
  } else {
    const known = state.samsungProfile && findProfile(state.samsungProfile);
    profile = known && !check(known).problems.length ? known.name : await createSamsungProfile(serial);
    if (!profile) return stepCertificate(serial);
  }
  useProfile(serial, profile);
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
  let answer = null;
  for (;;) {
    // Nei nuovi tentativi si riusa il file scelto, senza chiederlo di nuovo.
    if (answer === null) answer = (await ask('Percorso del file .wgt (Invio per scaricare l\'ultima versione da GitHub)')).replace(/^"(.*)"$/, '$1');
    let pkg;
    try {
      pkg = await source(answer);
    } catch (e) {
      console.log('Problema: ' + e.message);
      answer = null;
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
    if (certificateProblem(text)) {
      profile = await certificateRejected(serial, profile);
      if (!profile) return false;
      continue;
    }
    if (!(await yes('Installazione non riuscita. Vuoi riprovare?', true))) return false;
  }
}

/** Il TV ha rifiutato la firma: causa probabile, poi riprovare, sistemare i certificati o uscire. */
async function certificateRejected(serial, profile) {
  const p = findProfile(profile);
  const c = p ? check(p) : null;
  if (c && c.problems.length) {
    console.log('\nIl TV ha rifiutato il certificato. Il motivo è nel profilo "' + profile + '":');
    c.problems.forEach((x) => console.log('  - ' + x));
  } else {
    console.log('\nIl TV ha rifiutato il certificato. Il profilo "' + profile + '" sembra giusto; di solito si risolve così:');
    console.log('  - il TV deve essere connesso a internet durante l\'installazione: controlla il certificato online.');
    console.log('    Verifica in Impostazioni > Generali > Rete > Stato rete;');
    console.log('  - data e ora del TV devono essere giuste;');
    console.log('  - a volte basta riprovare;');
    console.log('  - se no, prova l\'altro tipo di certificato (Tizen o Samsung) dalla gestione dei certificati.');
  }
  console.log('\n  R. riprova con lo stesso certificato');
  console.log('  G. gestisci i certificati (ricrea, cambia, cancella)');
  console.log('  N. esci');
  let k;
  do k = (await ask('Scelta', c && c.problems.length ? 'G' : 'R')).toUpperCase();
  while (!/^[RGN]$/.test(k));
  if (k === 'N') return '';
  if (k === 'R') {
    if (c && c.samsung) permit(serial, profile);
    return profile;
  }
  await manageCertificates(serial);
  const now = loadState().profile;
  return now && hasProfile(now) ? now : stepCertificate(serial);
}

function uninstall(serial) {
  // Alcuni TV vogliono l'id del pacchetto, altri quello dell'app.
  for (const id of [APP_ID.split('.')[0], APP_ID]) {
    const text = output(tizen(['uninstall', '-p', id, '-s', serial]));
    if (!/fail|error/i.test(text)) {
      console.log('IPTVISION è stato disinstallato.');
      return;
    }
    console.log(text);
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
    if (await yes('Vuoi saltare la configurazione del TV?', true)) {
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
  tvDuid = duid(serial);
  if (tvDuid) console.log('Codice del TV (DUID): ' + tvDuid);

  for (;;) {
    heading('Cosa vuoi fare?');
    console.log('  1. installa o aggiorna IPTVISION');
    console.log('  2. gestisci i certificati (controlla, crea, ricrea, cancella)');
    console.log('  3. disinstalla IPTVISION dal TV');
    console.log('  0. esci');
    const c = await ask('Scelta', '1');
    if (c === '0') return;
    if (c === '2') await manageCertificates(serial);
    else if (c === '3') {
      if (await yes('Disinstallo IPTVISION dal TV? Account e preferiti salvati sul TV si perdono', false)) uninstall(serial);
    } else if (c === '1') {
      const profile = await stepCertificate(serial);
      if (await stepInstall(serial, profile)) {
        console.log('\nFatto. Per aggiornare IPTVISION in futuro basta rilanciare installa-tv.bat:');
        console.log('usa sempre lo stesso certificato, altrimenti il TV chiede di disinstallare prima la vecchia versione.');
        return;
      }
    }
  }
}

main()
  .catch((e) => {
    console.error('\nErrore: ' + (e.message || e));
    process.exitCode = 1;
  })
  .then(() => process.exit());
