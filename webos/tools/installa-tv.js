#!/usr/bin/env node
/*
 * Installazione guidata di IPTVISION su un TV LG: account sviluppatore, modalità sviluppatore,
 * collegamento del PC al TV, installazione del pacchetto .ipk e rinnovo automatico della sessione.
 * Si avvia con installa-tv.bat, che prima controlla Node.js e scarica gli strumenti di LG.
 * Fa da solo tutto quello che può; si ferma solo per le cose da fare sul TV o sul sito LG.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const https = require('https');
const readline = require('readline');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEVICE = 'tv';
const APP_ID = 'com.carellice.iptvision';
const REPO = 'carellice/IPTVISION';
const TOKEN_FILE = path.join(ROOT, '.devmode-token');
const RENEW_BAT = path.join(ROOT, 'rinnova-devmode.bat');
const TASK_NAME = 'IPTVISION rinnovo TV LG';
const WIN = process.platform === 'win32';

// terminal: false lascia la console in modalità normale: ares-novacom deve poter leggere la Passphrase.
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

// Gli strumenti webOS sono in webos/node_modules; su Windows sono file .cmd, quindi serve la shell
// e la riga di comando si compone qui.
function ares(tool, args, opts) {
  const bin = path.join(ROOT, 'node_modules', '.bin', WIN ? tool + '.cmd' : tool);
  return spawnSync([bin].concat(args).map(quote).join(' '), Object.assign({ encoding: 'utf8', shell: true }, opts));
}

function openUrl(url) {
  if (WIN) spawnSync('cmd', ['/c', 'start', '""', url], { stdio: 'ignore' });
  else spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
  console.log('Apro nel browser: ' + url);
}

// Indirizzo del TV già registrato col nome "tv", se c'è.
function registeredHost() {
  const out = ares('ares-setup-device', ['--list']).stdout || '';
  const line = out.split(/\r?\n/).find((l) => new RegExp('^' + DEVICE + '\\s').test(l));
  const m = line && line.match(/@([\d.]+):(\d+)/);
  return m ? m[1] : '';
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

function connected() {
  return ares('ares-device', ['--device', DEVICE, '--system-info']).status === 0;
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

async function downloadLatest() {
  const rel = JSON.parse(await get('https://api.github.com/repos/' + REPO + '/releases/latest'));
  const asset = (rel.assets || []).find((a) => /\.ipk$/i.test(a.name));
  if (!asset) throw new Error('Nella release ' + rel.tag_name + ' non c\'è un file .ipk');
  const file = path.join(os.tmpdir(), asset.name);
  console.log('Scarico ' + asset.name + ' (' + rel.tag_name + ')...');
  await get(asset.browser_download_url, file);
  return file;
}

// ---------- 1. Account ----------
async function stepAccount() {
  title(1, 'Account sviluppatore LG (gratis)');
  if (await yes('Hai già un account sviluppatore LG?', true)) return;
  openUrl('https://webostv.developer.lge.com');
  console.log('\nNella pagina che si è aperta scegli "Sign In", poi "Create Account", e completa la registrazione');
  console.log('con email e password, poi conferma l\'email che ti arriva. Non si paga nulla.');
  await pause('Premi Invio quando l\'account è pronto');
}

// ---------- 2. Modalità sviluppatore sul TV ----------
async function stepDevMode() {
  title(2, 'Modalità sviluppatore sul TV');
  console.log('Sul TV:');
  console.log('  1. apri LG Content Store (o "Apps"), cerca "Developer Mode" e installala;');
  console.log('  2. apri Developer Mode e accedi con il tuo account LG;');
  console.log('  3. attiva "Dev Mode Status": il TV si riavvia da solo;');
  console.log('  4. riapri Developer Mode e attiva "Key Server".');
  console.log('Lascia aperta la schermata di Developer Mode: servono l\'indirizzo IP e la Passphrase che mostra.');
  await pause('Premi Invio quando sul TV vedi "Key Server" attivo');
}

// ---------- 3. Collegamento PC-TV ----------
async function stepConnect(knownHost) {
  title(3, 'Collegamento del PC al TV');
  for (;;) {
    let host = await ask('Indirizzo IP del TV (lo vedi in Developer Mode, es. 192.168.1.50)', knownHost);
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      console.log('Non sembra un indirizzo IP: scrivi quattro numeri separati da punti.');
      continue;
    }
    process.stdout.write('Controllo che il TV risponda... ');
    if (!(await portOpen(host, 9922))) {
      console.log('nessuna risposta.');
      console.log('Controlla che TV e PC siano sulla stessa rete, che "Dev Mode Status" sia attivo e che l\'IP sia giusto.');
      if (!(await yes('Vuoi provare lo stesso?', false))) continue;
    } else console.log('ok.');

    if (registeredHost()) ares('ares-setup-device', ['--remove', DEVICE]);
    const add = ares('ares-setup-device', ['--add', DEVICE, '--info', 'host=' + host, '--info', 'port=9922', '--info', 'username=prisoner']);
    if (add.status !== 0) {
      console.log('Non sono riuscito a registrare il TV:\n' + (add.stderr || add.stdout));
      continue;
    }

    console.log('\nOra scarico la chiave di accesso dal TV.');
    console.log('Quando te la chiede, scrivi la Passphrase che vedi in Developer Mode (6 caratteri) e premi Invio.\n');
    rl.pause();
    ares('ares-novacom', ['--device', DEVICE, '--getkey'], { stdio: 'inherit' });
    rl.resume();

    process.stdout.write('\nVerifico il collegamento... ');
    if (connected()) {
      console.log('il PC è collegato al TV.');
      return host;
    }
    console.log('non riesco a comunicare con il TV.');
    console.log('Di solito è la Passphrase sbagliata o "Key Server" spento. Riproviamo.');
    knownHost = host;
  }
}

// ---------- 4. Installazione ----------
async function stepInstall() {
  title(4, 'Installazione di IPTVISION');
  for (;;) {
    let file = (await ask('Percorso del file .ipk (Invio per scaricare l\'ultima versione da GitHub)')).replace(/^"(.*)"$/, '$1');
    try {
      if (!file) file = await downloadLatest();
      else if (!fs.existsSync(file)) throw new Error('il file "' + file + '" non esiste');
    } catch (e) {
      console.log('Problema: ' + e.message);
      continue;
    }
    console.log('Installo ' + path.basename(file) + ' sul TV...');
    const r = ares('ares-install', ['--device', DEVICE, file], { stdio: 'inherit' });
    if (r.status === 0) {
      ares('ares-launch', ['--device', DEVICE, APP_ID]);
      console.log('IPTVISION è installato e si sta aprendo sul TV. Lo trovi anche nella barra Home.');
      return;
    }
    if (!(await yes('Installazione non riuscita. Vuoi riprovare?', true))) return;
  }
}

// ---------- 5. Rinnovo automatico ----------
function readToken() {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'devmode.js'), 'token', DEVICE], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.log((r.stderr || r.stdout).trim());
    return '';
  }
  return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
}

function renewNow() {
  return spawnSync(process.execPath, [path.join(__dirname, 'devmode.js'), 'renew'], { stdio: 'inherit' }).status === 0;
}

// Repository GitHub di questa copia (il proprio fork), se è stata scaricata con git.
function originRepo() {
  const r = spawnSync('git', ['-C', ROOT, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  const m = r.status === 0 && r.stdout.match(/github\.com[:/]([^/]+\/[^/.\s]+)/);
  return m ? m[1] : '';
}

async function renewGitHub(token) {
  const repo = await ask('Repository GitHub dove gira il rinnovo (la tua copia, nome-utente/IPTVISION)', originRepo());
  const gh = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  if (gh.status === 0 && (await yes('Ho trovato GitHub CLI collegata: salvo io il segreto LG_DEVMODE_TOKEN?', true))) {
    const set = spawnSync('gh', ['secret', 'set', 'LG_DEVMODE_TOKEN', '-R', repo], { input: token, encoding: 'utf8' });
    if (set.status === 0) {
      console.log('Segreto salvato in ' + repo + '.');
      if (await yes('Avvio subito il workflow per provarlo?', true)) {
        spawnSync('gh', ['workflow', 'run', 'webos-devmode.yml', '-R', repo], { stdio: 'inherit' });
        console.log('Avviato: l\'esito lo vedi nella scheda Actions di ' + repo + '.');
      }
      return;
    }
    console.log('Non ci sono riuscito:\n' + (set.stderr || set.stdout));
  }
  console.log('\nSalvalo a mano: nella pagina che apro premi "New repository secret",');
  console.log('nome LG_DEVMODE_TOKEN, valore il codice qui sotto, poi "Add secret".\n\n  ' + token + '\n');
  console.log('Se è un fork, abilita prima i workflow dalla scheda Actions.');
  openUrl('https://github.com/' + repo + '/settings/secrets/actions/new');
  await pause('Premi Invio quando hai salvato il segreto');
}

async function renewTask() {
  let time;
  do time = await ask('A che ora il PC è acceso di solito? (HH:MM)', '09:00');
  while (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time));
  const r = spawnSync('schtasks', ['/Create', '/F', '/SC', 'DAILY', '/ST', time, '/TN', TASK_NAME, '/TR', '"' + RENEW_BAT + '"'], { encoding: 'utf8' });
  if (r.status === 0) console.log('Attività "' + TASK_NAME + '" creata: rinnova ogni giorno alle ' + time + ' (esito in webos\\devmode-rinnovo.log).');
  else console.log('Non sono riuscito a creare l\'attività:\n' + (r.stderr || r.stdout));
}

async function stepRenew() {
  title(5, 'Rinnovo automatico della modalità sviluppatore');
  console.log('La sessione di sviluppo dura 50 ore: quando scade, il TV toglie IPTVISION.');
  console.log('Con il rinnovo automatico non scade mai, anche a TV spento.');
  if (!(await yes('Vuoi configurarlo adesso?', true))) return;

  console.log('Leggo il codice della sessione dal TV...');
  const token = readToken();
  if (!token) {
    console.log('Senza codice non posso configurare il rinnovo. Riprova più tardi con "npm run devmode-token".');
    return;
  }
  console.log('Codice salvato in ' + TOKEN_FILE + ' (resta solo su questo PC: tienilo per te).');
  console.log('Primo rinnovo di prova:');
  if (!renewNow()) console.log('Il rinnovo di prova non è riuscito: il codice resta salvato, controlla la connessione.');

  console.log('\nCome vuoi rinnovarla ogni giorno?');
  console.log('  A. GitHub Actions: non serve il PC acceso (consigliato)');
  console.log('  B. Utilità di pianificazione di Windows: il PC deve essere acceso almeno una volta al giorno');
  console.log('  C. Entrambi');
  console.log('  N. Nessuno, lo faccio a mano');
  let c;
  do c = (await ask('Scelta', 'A')).toUpperCase();
  while (!/^[ABCN]$/.test(c));
  if (c === 'A' || c === 'C') await renewGitHub(token);
  if ((c === 'B' || c === 'C') && WIN) await renewTask();
  if (c === 'B' && !WIN) console.log('L\'Utilità di pianificazione c\'è solo su Windows: usa GitHub Actions o cron.');
}

async function main() {
  console.log('\n  IPTVISION per TV LG: installazione guidata');
  console.log('  Ti dico io cosa fare sul TV; il resto lo faccio da solo. Ctrl+C per uscire quando vuoi.');

  let host = registeredHost();
  let ready = false;
  if (host) {
    console.log('\nC\'è già un TV collegato a questo PC (' + host + ').');
    if (await yes('Vuoi saltare la configurazione e installare o aggiornare IPTVISION?', true)) {
      process.stdout.write('Verifico il collegamento... ');
      ready = connected();
      console.log(ready ? 'ok.' : 'il TV non risponde: rifacciamo il collegamento.');
    }
  }
  if (!ready) {
    if (!host) {
      await stepAccount();
      await stepDevMode();
    } else {
      console.log('\nSul TV apri Developer Mode e controlla che "Dev Mode Status" e "Key Server" siano attivi.');
      await pause();
    }
    host = await stepConnect(host);
  }
  await stepInstall();
  await stepRenew();
  console.log('\nFatto. Per aggiornare IPTVISION in futuro basta rilanciare installa-tv.bat.');
}

main()
  .catch((e) => {
    console.error('\nErrore: ' + (e.message || e));
    process.exitCode = 1;
  })
  .then(() => process.exit());
