/*
 * Utilità condivise. Il codice resta compatibile con i TV LG dal 2018 (webOS 4, Chromium 53):
 * niente async/await, spread sugli oggetti, optional chaining, Object.values/entries, padStart.
 */
var IPTV = window.IPTV || {};
window.IPTV = IPTV;

(function () {
  'use strict';

  // La grafica è disegnata per 1920x1080: la dimensione del testo segue la larghezza reale.
  function fitRoot() {
    document.documentElement.style.fontSize = (window.innerWidth / 96) + 'px';
  }
  fitRoot();
  window.addEventListener('resize', fitRoot);

  /** Crea un elemento: h('div', {class: 'x', onclick: fn}, [figli o testo]). */
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') el.setAttribute('style', v);
        else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.substring(2), v);
        else if (k === 'data') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    if (children === null || children === undefined || children === false) return;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
  }

  /** Minuscolo, senza accenti né punteggiatura: la ricerca non distingue "Città" da "citta". */
  function normalize(s) {
    var d = String(s || '').normalize ? String(s || '').normalize('NFD') : String(s || '');
    d = d.replace(/[̀-ͯ]/g, '').toLowerCase();
    return d.replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function initials(name) {
    var parts = String(name || '').split(/[ \-_|:]+/).filter(function (p) { return /[A-Za-z0-9]/.test(p); });
    if (!parts.length) return 'TV';
    if (parts.length === 1) return parts[0].replace(/[^A-Za-z0-9]/g, '').substring(0, 2).toUpperCase();
    return (parts[0].replace(/[^A-Za-z0-9]/g, '').charAt(0) + parts[1].replace(/[^A-Za-z0-9]/g, '').charAt(0)).toUpperCase();
  }

  // Sigle di qualità, codifica e lingua che i pannelli aggiungono al titolo ("Film (2020) FHD", "Film 4K HDR").
  var QUALITY = {};
  ['4k', 'uhd', '2160p', 'fhd', '1080p', '1080i', 'hd', '720p', 'sd', '576p', '480p',
    'hdr', 'hdr10', 'dv', 'hevc', 'h265', 'x265', 'h264', 'x264', '10bit',
    '3d', 'ita', 'eng', 'subita', 'multisub', 'bluray', 'bdrip', 'webdl', 'webrip', 'dvdrip'].forEach(function (t) { QUALITY[t] = true; });
  var LANG_PREFIX = /^\s*[\[(|]?\s*[A-Z]{2,3}\s*[\])|:\-]\s*/;

  /** Chiave per riconoscere lo stesso titolo pubblicato più volte (senza qualità né prefisso di lingua). */
  function variantKey(name) {
    var words = normalize(String(name || '').replace(LANG_PREFIX, '')).split(' ').filter(function (w) { return w && !QUALITY[w]; });
    return words.length ? words.join(' ') : normalize(name);
  }

  /** Le sigle di qualità nel titolo, per distinguere le versioni ("4K HDR", "FHD"). */
  function qualityOf(name) {
    var seen = {};
    var tags = normalize(name).split(' ').filter(function (w) {
      if (!QUALITY[w] || seen[w]) return false;
      seen[w] = true;
      return true;
    });
    return tags.length ? tags.join(' ').toUpperCase() : null;
  }

  /** Raggruppa le copie dello stesso titolo: resta il primo nell'ordine, con tutte le versioni. */
  function groupVariants(items, nameOf) {
    var map = {};
    var order = [];
    items.forEach(function (it) {
      var k = variantKey(nameOf(it));
      if (map[k]) map[k].push(it);
      else { map[k] = [it]; order.push(k); }
    });
    return order.map(function (k) { return { item: map[k][0], variants: map[k] }; });
  }

  function joinMeta() {
    return Array.prototype.slice.call(arguments).filter(function (p) { return p; }).join('  ·  ');
  }

  function two(n) { return (n < 10 ? '0' : '') + n; }

  function formatTime(ms) {
    var t = Math.max(0, Math.floor((ms || 0) / 1000));
    var hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
    return hh > 0 ? hh + ':' + two(mm) + ':' + two(ss) : mm + ':' + two(ss);
  }

  function clock(sec) {
    var d = new Date(sec * 1000);
    return two(d.getHours()) + ':' + two(d.getMinutes());
  }

  var DAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  var MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  function today() {
    var d = new Date();
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  /** fetch con tempo massimo (i TV del 2018 non hanno AbortController). */
  function fetchTimeout(url, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, ms);
      fetch(url, { credentials: 'omit' }).then(function (r) {
        if (done) return;
        done = true; clearTimeout(timer); resolve(r);
      }, function (e) {
        if (done) return;
        done = true; clearTimeout(timer); reject(e);
      });
    });
  }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var toastTimer = null;
  function toast(text) {
    var el = document.getElementById('toast');
    el.textContent = text;
    el.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 3500);
  }

  /** Immagine con le iniziali come segnaposto: si carica solo quando entra nello schermo. */
  var observer = window.IntersectionObserver ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var img = e.target;
      observer.unobserve(img);
      img.src = img.dataset.src;
    });
  }, { rootMargin: '400px' }) : null;

  function art(url, text) {
    var box = [h('div', { class: 'ini', text: text })];
    if (url) {
      var img = h('img', { alt: '' });
      img.addEventListener('error', function () { img.style.display = 'none'; });
      img.addEventListener('load', function () { box[0].style.display = 'none'; });
      if (observer) { img.dataset.src = url; observer.observe(img); } else img.src = url;
      box.push(img);
    }
    return box;
  }

  function progressBar(p) {
    return h('div', { class: 'progress' }, h('i', { style: 'width:' + Math.round(Math.max(0, Math.min(1, p)) * 100) + '%' }));
  }

  IPTV.u = {
    h: h, append: append, normalize: normalize, initials: initials, variantKey: variantKey, qualityOf: qualityOf,
    groupVariants: groupVariants, joinMeta: joinMeta, formatTime: formatTime, clock: clock, today: today,
    fetchTimeout: fetchTimeout, delay: delay, toast: toast, art: art, progressBar: progressBar,
  };
})();
