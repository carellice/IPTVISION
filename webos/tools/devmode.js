#!/usr/bin/env node
/*
 * Modalità sviluppatore dei TV LG: la sessione scade dopo qualche decina di ore e con lei
 * spariscono le app installate a mano. Questo script legge il codice della sessione dal TV
 * e la rinnova sul sito LG, così si può fare in automatico (Utilità di pianificazione, GitHub Actions).
 *
 *   node tools/devmode.js token [nome-tv]   legge il codice dal TV e lo salva in webos/.devmode-token
 *   node tools/devmode.js renew [codice]    rinnova la sessione (codice da argomento, da LG_DEVMODE_TOKEN o dal file)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const TOKEN_FILE = path.join(__dirname, '..', '.devmode-token');
const RENEW_URL = 'https://developer.lge.com/secure/ResetDevModeSession.dev?sessionToken=';

function ares(tool, args) {
  // Gli strumenti webOS sono installati in webos/node_modules (npm install).
  const bin = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? tool + '.cmd' : tool);
  return execFileSync(fs.existsSync(bin) ? bin : tool, args, { encoding: 'utf8', shell: process.platform === 'win32' });
}

function readToken(arg) {
  const t = (arg || process.env.LG_DEVMODE_TOKEN || (fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8') : '')).trim();
  if (!t) {
    console.error('Codice della sessione mancante: esegui prima "npm run devmode-token" con il TV acceso e collegato.');
    process.exit(2);
  }
  return t;
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'IPTVISION-devmode' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const device = arg || 'tv';

  if (cmd === 'token') {
    // Il TV conserva il codice della sessione in questo file (serve la chiave ottenuta con ares-novacom --getkey).
    const out = ares('ares-novacom', ['--device', device, '--run', 'cat /var/luna/preferences/devmode_enabled']).trim();
    const token = out.split(/\s+/).pop();
    if (!token || token.length < 16) {
      console.error('Non sono riuscito a leggere il codice dal TV. Risposta:\n' + out);
      process.exit(1);
    }
    fs.writeFileSync(TOKEN_FILE, token + '\n');
    console.log('Codice della sessione salvato in ' + TOKEN_FILE);
    console.log('Per GitHub Actions copialo nel segreto LG_DEVMODE_TOKEN:\n' + token);
    return;
  }

  if (cmd === 'renew') {
    const token = readToken(arg);
    const res = await get(RENEW_URL + encodeURIComponent(token));
    const ok = res.status === 200 && /"result"\s*:\s*"success"/i.test(res.body);
    console.log(new Date().toISOString() + '  HTTP ' + res.status + '  ' + res.body.trim().slice(0, 300));
    if (!ok) {
      console.error('Rinnovo non riuscito: se il TV è stato ripristinato o la modalità sviluppatore reinstallata, rileggi il codice con "npm run devmode-token".');
      process.exit(1);
    }
    console.log('Sessione della modalità sviluppatore rinnovata.');
    return;
  }

  console.log('Uso: node tools/devmode.js token|renew [nome-tv o codice]');
  process.exit(cmd ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
