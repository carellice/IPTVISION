/*
 * Riproduzione con riconnessione automatica.
 * TV in diretta in MPEG-TS: mpegts.js (Media Source Extensions); HLS, film ed episodi: lettore del TV.
 * Un controllo ogni secondo verifica che il video avanzi davvero: se si blocca, il flusso si riapre
 * aspettando un po' di più a ogni tentativo.
 */
(function () {
  'use strict';

  var video = document.getElementById('video');
  var ts = null;
  var url = null, live = true, resumeMs = 0;
  var attempt = 0, lastTime = -1, lastProgressAt = 0, startedAt = 0, everPlayed = false, userPaused = false;
  var retryTimer = null;

  var P = {
    state: 'idle', // idle | connecting | buffering | playing | paused | reconnecting
    onState: null, onEnded: null, onFailed: null,
    get attempt() { return attempt; },
    get isLive() { return live; },
    get active() { return url !== null; },
  };

  function setState(s) {
    if (P.state === s) return;
    P.state = s;
    if (P.onState) P.onState(s);
  }

  function destroyTs() {
    if (!ts) return;
    try { ts.pause(); ts.unload(); ts.detachMediaElement(); ts.destroy(); } catch (e) { /* già chiuso */ }
    ts = null;
  }

  function canUseMse() {
    try { return window.mpegts && mpegts.getFeatureList().mseLivePlayback; } catch (e) { return false; }
  }

  function start() {
    if (!url) return;
    destroyTs();
    video.removeAttribute('src');
    try { video.load(); } catch (e) { /* niente da scaricare */ }
    setState(attempt > 0 ? 'reconnecting' : 'connecting');
    lastTime = -1;
    startedAt = lastProgressAt = Date.now();

    var isTs = /\.ts(\?|$)/i.test(url);
    if (live && isTs && canUseMse()) {
      // Sui TV di fascia media:
      // - la conversione del flusso gira in un worker, così menu e telecomando non la rallentano;
      // - si tengono solo 30 s già visti: con i 3 minuti predefiniti la memoria del TV si riempiva
      //   e il video andava a scatti;
      // - niente inseguimento della latenza, perché i salti in avanti si vedevano come scatti.
      ts = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: url }, {
        enableWorker: true, lazyLoad: false, enableStashBuffer: true,
        autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 30, autoCleanupMinBackwardDuration: 15,
        liveBufferLatencyChasing: false,
      });
      ts.on(mpegts.Events.ERROR, function () { scheduleRetry('errore del flusso'); });
      ts.attachMediaElement(video);
      ts.load();
      if (!userPaused) { var pr = ts.play(); if (pr && pr.catch) pr.catch(function () {}); }
    } else {
      video.src = url;
      if (!live && resumeMs > 0) {
        var seek = function () { video.removeEventListener('loadedmetadata', seek); try { video.currentTime = resumeMs / 1000; } catch (e) { /* posizione non valida */ } };
        video.addEventListener('loadedmetadata', seek);
      }
      if (!userPaused) { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
    }
  }

  function scheduleRetry(reason) {
    if (!url) return;
    clearTimeout(retryTimer);
    if (!live) {
      if (video.currentTime > 0) resumeMs = video.currentTime * 1000;
      if (attempt >= 6) { P.stop(); if (P.onFailed) P.onFailed(); return; }
    }
    attempt++;
    setState('reconnecting');
    var wait = Math.min(15000, 1000 * Math.pow(2, Math.min(attempt - 1, 4)));
    console.log('Riconnessione (' + reason + '), tentativo ' + attempt + ' tra ' + wait + ' ms');
    destroyTs();
    retryTimer = setTimeout(start, wait);
  }

  video.addEventListener('playing', function () { everPlayed = true; setState('playing'); lastProgressAt = Date.now(); });
  video.addEventListener('waiting', function () { if (P.state !== 'reconnecting') setState(everPlayed ? 'buffering' : 'connecting'); });
  video.addEventListener('pause', function () { if (url && userPaused) setState('paused'); });
  video.addEventListener('error', function () { scheduleRetry('errore di riproduzione'); });
  video.addEventListener('ended', function () {
    if (!url) return;
    // Un canale in diretta che "finisce" è un flusso caduto: si riapre.
    if (live) scheduleRetry('flusso terminato');
    else { setState('idle'); if (P.onEnded) P.onEnded(); }
  });

  setInterval(function () {
    if (!url || userPaused) { lastProgressAt = Date.now(); return; }
    if (P.state === 'reconnecting' && video.paused) return;
    var t = video.currentTime;
    if (!video.paused && t !== lastTime) {
      lastTime = t;
      lastProgressAt = Date.now();
      if (P.state !== 'playing' && video.readyState >= 3) setState('playing');
      // Dopo un minuto di visione regolare i tentativi ripartono da capo.
      if (attempt > 0 && Date.now() - startedAt > 60000) attempt = 0;
      // Senza inseguimento la diretta può restare indietro: oltre 25 s di ritardo si salta avanti, una volta sola.
      var b = video.buffered;
      if (live && b.length && b.end(b.length - 1) - t > 25) video.currentTime = b.end(b.length - 1) - 4;
      return;
    }
    var limit = live ? (everPlayed ? 12000 : 25000) : (everPlayed ? 20000 : 35000);
    if (Date.now() - lastProgressAt > limit) scheduleRetry('flusso bloccato');
  }, 1000);

  P.play = function (newUrl, isLive, startMs) {
    clearTimeout(retryTimer);
    url = newUrl; live = isLive; resumeMs = startMs || 0;
    attempt = 0; everPlayed = false; userPaused = false;
    start();
  };

  P.stop = function () {
    clearTimeout(retryTimer);
    url = null;
    destroyTs();
    video.pause();
    video.removeAttribute('src');
    try { video.load(); } catch (e) { /* già fermo */ }
    attempt = 0;
    setState('idle');
  };

  P.togglePause = function () {
    if (!url) return;
    userPaused = !userPaused;
    if (userPaused) { video.pause(); setState('paused'); }
    else { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
  };

  P.seekBy = function (ms) {
    if (live || !url || !isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + ms / 1000));
  };

  P.position = function () { return url ? video.currentTime * 1000 : 0; };
  P.duration = function () { return isFinite(video.duration) ? video.duration * 1000 : 0; };
  P.resolution = function () { return video.videoHeight ? video.videoHeight + 'p' : ''; };

  /** Tracce audio (solo con il lettore del TV: mpegts.js usa la prima). */
  P.audioTracks = function () {
    var list = [];
    var t = video.audioTracks;
    if (!t || ts) return list;
    for (var i = 0; i < t.length; i++) list.push({ index: i, label: t[i].label || t[i].language || 'Traccia ' + (i + 1), on: t[i].enabled });
    return list;
  };
  P.selectAudio = function (index) {
    var t = video.audioTracks;
    if (!t) return;
    for (var i = 0; i < t.length; i++) t[i].enabled = i === index;
  };

  IPTV.Player = P;
})();
