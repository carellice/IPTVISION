/*
 * Navigazione col telecomando LG: frecce, OK e Indietro spostano un focus "spaziale"
 * tra gli elementi con classe "f" (il più vicino nella direzione premuta).
 */
(function () {
  'use strict';

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13,
    BACK: 461, ESC: 27, BACKSPACE: 8,
    CH_UP: 33, CH_DOWN: 34, PLAY: 415, PAUSE: 19, PLAY_PAUSE: 179, STOP: 413, FF: 417, REW: 412, INFO: 457,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
  };
  // Telecomando Samsung (Tizen): Indietro, canale su/giù e play/pausa hanno codici diversi da LG.
  var P = IPTV.Platform;
  if (P && P.tizen) {
    KEY.BACK = 10009;
    KEY.CH_UP = P.code('ChannelUp', 427);
    KEY.CH_DOWN = P.code('ChannelDown', 428);
    KEY.PLAY_PAUSE = P.code('MediaPlayPause', 10252);
  }

  var current = null;
  var scope = document.body;

  function visible(el) {
    if (!el || !el.offsetParent) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function candidates() {
    return Array.prototype.filter.call(scope.querySelectorAll('.f'), visible);
  }

  /** Porta l'elemento dentro la sua area scorrevole (".scroll"), con un po' di margine. */
  function reveal(el) {
    var box = el.parentNode;
    while (box && box !== document.body && !(box.classList && box.classList.contains('scroll'))) box = box.parentNode;
    if (!box || box === document.body) return;
    var r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    var margin = b.height * 0.18;
    if (r.top < b.top + margin) box.scrollTop -= (b.top + margin - r.top);
    else if (r.bottom > b.bottom - margin) box.scrollTop += (r.bottom - (b.bottom - margin));
  }

  function focus(el, silent) {
    if (!el) return;
    if (current && current !== el) {
      current.classList.remove('focused');
      if (current.tagName === 'INPUT' && document.activeElement === current) current.blur();
    }
    current = el;
    el.classList.add('focused');
    reveal(el);
    if (!silent && typeof el.onFocus === 'function') el.onFocus();
  }

  function move(dir) {
    var list = candidates();
    if (!current || list.indexOf(current) < 0) { focus(list[0]); return true; }
    // Destinazione indicata dalla schermata (per esempio dal menu alla casella di ricerca).
    var hint = current.nav && current.nav[dir] ? current.nav[dir]() : null;
    if (hint && list.indexOf(hint) >= 0) { focus(hint); return true; }
    var c = current.getBoundingClientRect();
    var best = null, bestScore = Infinity;
    var slack = 4; // bordi che si toccano o si sovrappongono di poco (riquadri ingranditi dal focus)
    list.forEach(function (el) {
      if (el === current) return;
      var r = el.getBoundingClientRect();
      var primary, gap, edge, horizontal = dir === 'left' || dir === 'right';
      if (dir === 'right') { if (r.left < c.right - slack - c.width * 0.05) return; primary = r.left - c.right; }
      else if (dir === 'left') { if (r.right > c.left + slack + c.width * 0.05) return; primary = c.left - r.right; }
      else if (dir === 'down') { if (r.top < c.bottom - slack - c.height * 0.05) return; primary = r.top - c.bottom; }
      else { if (r.bottom > c.top + slack + c.height * 0.05) return; primary = c.top - r.bottom; }
      // Distanza laterale tra i due elementi (0 se sono sulla stessa riga/colonna);
      // a parità si preferisce chi è allineato sul bordo di partenza (sinistro o alto).
      if (horizontal) { gap = Math.max(0, r.top - c.bottom, c.top - r.bottom); edge = Math.abs(r.top - c.top); }
      else { gap = Math.max(0, r.left - c.right, c.left - r.right); edge = Math.abs(r.left - c.left); }
      var score = Math.max(primary, 0) + gap * 3 + (gap > 0 ? 1000 : 0) + edge * 0.05;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (best) { focus(best); return true; }
    return false;
  }

  function activate() {
    if (!current) return;
    if (current.tagName === 'INPUT') { current.focus(); return; }
    if (typeof current.onActivate === 'function') current.onActivate();
    else current.click();
  }

  /** Dove cercare gli elementi: lo schermo aperto, oppure una finestra o un pannello sopra di esso. */
  function setScope(el, preferred) {
    scope = el || document.body;
    var list = candidates();
    focus(preferred && list.indexOf(preferred) >= 0 ? preferred : list[0], true);
  }

  function handleDefault(e) {
    var typing = document.activeElement && document.activeElement.tagName === 'INPUT';
    switch (e.keyCode) {
      case KEY.LEFT: if (typing) return false; return move('left') || true;
      case KEY.RIGHT: if (typing) return false; return move('right') || true;
      case KEY.UP:
        if (typing) document.activeElement.blur();
        return move('up') || true;
      case KEY.DOWN:
        if (typing) document.activeElement.blur();
        return move('down') || true;
      case KEY.OK:
        if (typing) { document.activeElement.blur(); if (typeof current.onSubmit === 'function') current.onSubmit(); return true; }
        activate();
        return true;
    }
    return false;
  }

  IPTV.Nav = {
    KEY: KEY, focus: focus, move: move, activate: activate, setScope: setScope, handleDefault: handleDefault,
    current: function () { return current; },
    isBack: function (code) { return code === KEY.BACK || code === KEY.ESC || code === KEY.BACKSPACE; },
  };
})();
