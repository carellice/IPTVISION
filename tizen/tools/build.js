#!/usr/bin/env node
/*
 * Prepara IPTVISION per i TV Samsung (Tizen) partendo dall'app dei TV LG (webos/app).
 *   node tools/build.js --dir <cartella>   copia l'app con config.xml (da firmare con "tizen package")
 *   node tools/build.js --wgt <file.wgt>   crea il pacchetto .wgt non firmato (quello delle release)
 * Il .wgt non firmato non si installa così com'è: lo firma installa-tv.bat con il certificato
 * di chi installa, che su molti TV Samsung è legato al singolo televisore.
 * Non servono pacchetti npm: lo zip si scrive qui sotto con zlib.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TIZEN = path.join(__dirname, '..');
const APP = path.join(TIZEN, '..', 'webos', 'app');
// File solo per webOS: su Tizen il manifesto è config.xml.
const SKIP = new Set(['appinfo.json']);

function version() {
  const js = fs.readFileSync(path.join(APP, 'js', 'version.js'), 'utf8');
  const m = js.match(/IPTV\.VERSION = '([^']+)'/);
  if (!m) throw new Error('versione non trovata in webos/app/js/version.js');
  return m[1];
}

function configXml() {
  const xml = fs.readFileSync(path.join(TIZEN, 'config.xml'), 'utf8');
  return xml.replace(/(<widget\b[^>]*\bversion=")[^"]*(")/, '$1' + version() + '$2');
}

/** Tutti i file del pacchetto: [percorso nel pacchetto, contenuto]. */
function files() {
  const out = [['config.xml', Buffer.from(configXml(), 'utf8')]];
  (function walk(dir, rel) {
    fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).forEach((e) => {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (!SKIP.has(r)) out.push([r, fs.readFileSync(path.join(dir, e.name))]);
    });
  })(APP, '');
  return out;
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  // Data fissa: lo stesso codice dà sempre lo stesso pacchetto.
  const time = 0, date = (2020 - 1980) << 9 | 1 << 5 | 1;
  entries.forEach(([name, data]) => {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const stored = packed.length >= data.length;
    const body = stored ? data : packed;
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // nomi in UTF-8
    head.writeUInt16LE(stored ? 0 : 8, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    local.push(head, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(stored ? 0 : 8, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + body.length;
  });
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat(local.concat([centralBuf, end]));
}

function writeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  files().forEach(([rel, data]) => {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  });
  return dir;
}

function writeWgt(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, zip(files()));
  return file;
}

module.exports = { version, writeDir, writeWgt };

if (require.main === module) {
  const [flag, target] = process.argv.slice(2);
  if (flag === '--dir' && target) console.log('Cartella pronta: ' + writeDir(path.resolve(target)));
  else if (flag === '--wgt' && target) console.log('Pacchetto: ' + writeWgt(path.resolve(target)));
  else {
    console.log('Uso: node tools/build.js --dir <cartella> | --wgt <file.wgt>');
    process.exitCode = 2;
  }
}
