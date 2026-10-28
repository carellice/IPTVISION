/* Dati salvati sul TV (localStorage dell'app): account, preferenze, preferiti e posizioni di ripresa. */
(function () {
  'use strict';

  function load(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* spazio esaurito: si perde solo l'ultima modifica */ }
  }

  var settings = load('settings', {});
  var defaults = {
    server: null, username: null, password: null,
    favorites: [], lastStreamId: null, lastCategoryId: null,
    outputFormat: 'ts', autoPlayLast: true, autoCheckUpdates: true,
    sorts: {}, grids: { Movies: true, Series: true },
  };
  Object.keys(defaults).forEach(function (k) { if (settings[k] === undefined) settings[k] = defaults[k]; });

  var Settings = {
    get: function (k) { return settings[k]; },
    set: function (k, v) { settings[k] = v; save('settings', settings); },
    account: function () {
      if (!settings.server || !settings.username) return null;
      return { server: settings.server, username: settings.username, password: settings.password || '' };
    },
    clearAccount: function () {
      ['server', 'username', 'password', 'lastStreamId', 'lastCategoryId'].forEach(function (k) { settings[k] = null; });
      save('settings', settings);
    },
    isFavorite: function (id) { return settings.favorites.indexOf(id) >= 0; },
    toggleFavorite: function (id) {
      var i = settings.favorites.indexOf(id);
      if (i >= 0) settings.favorites.splice(i, 1); else settings.favorites.push(id);
      save('settings', settings);
    },
    sortOf: function (section) { return settings.sorts[section] || 'Default'; },
    setSort: function (section, v) { settings.sorts[section] = v; save('settings', settings); },
    isGrid: function (section) { return !!settings.grids[section]; },
    setGrid: function (section, v) { settings.grids[section] = v; save('settings', settings); },
  };

  /*
   * Posizioni di ripresa: chiavi "m:{id}" film, "e:{id}" episodi.
   * Non riprende i primi 30 s né gli ultimi 90 s, come su Windows e Android.
   */
  var pos = load('positions', { positions: {}, watched: {}, lastEpisode: {} });
  var dirty = false;

  var Positions = {
    resumeMs: function (key) {
      var e = pos.positions[key];
      if (!e) return 0;
      return e.p > 30000 && (e.d <= 0 || e.d - e.p > 90000) ? e.p : 0;
    },
    progress: function (key) {
      if (pos.watched[key]) return 1;
      var e = pos.positions[key];
      return e && e.d > 0 ? Math.min(0.99, Math.max(0, e.p / e.d)) : 0;
    },
    updatedAt: function (key) { var e = pos.positions[key]; return e ? e.u : 0; },
    isWatched: function (key) { return !!pos.watched[key]; },
    /** Restituisce true se il contenuto risulta finito. */
    update: function (key, p, d) {
      if (!(d > 0) || !(p > 0)) return false;
      if (p >= d * 0.95 || d - p < 90000) { Positions.markWatched(key); return true; }
      if (p < 30000) return false;
      pos.positions[key] = { p: Math.round(p), d: Math.round(d), u: Date.now() };
      delete pos.watched[key];
      dirty = true;
      return false;
    },
    markWatched: function (key) {
      delete pos.positions[key];
      pos.watched[key] = 1;
      dirty = true;
    },
    setLastEpisode: function (seriesId, episodeId) {
      pos.lastEpisode[seriesId] = { id: episodeId, u: Date.now() };
      dirty = true;
    },
    lastEpisode: function (seriesId) { return pos.lastEpisode[seriesId] || null; },
    save: function () {
      if (!dirty) return;
      var keys = Object.keys(pos.positions);
      if (keys.length > 600) {
        keys.sort(function (a, b) { return pos.positions[a].u - pos.positions[b].u; });
        keys.slice(0, keys.length - 600).forEach(function (k) { delete pos.positions[k]; });
      }
      save('positions', pos);
      dirty = false;
    },
  };

  /*
   * Liste di canali, film e serie salvate in IndexedDB: all'avvio si leggono da qui invece di
   * riscaricarle e rianalizzarle dal server (decine di MB con i cataloghi grandi).
   * Se IndexedDB non c'è o dà errore, si scarica tutto come prima.
   */
  var dbp = null;
  function db() {
    if (!dbp) dbp = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB assente')); return; }
      var r = indexedDB.open('iptvision', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('lists'); };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction('lists', mode);
        var req = fn(t.objectStore('lists'));
        t.oncomplete = function () { resolve(req.result); };
        t.onerror = t.onabort = function () { reject(t.error); };
      });
    });
  }
  var Cache = {
    get: function (key) { return tx('readonly', function (s) { return s.get(key); }).catch(function () { return null; }); },
    put: function (key, value) { return tx('readwrite', function (s) { return s.put(value, key); }).catch(function () {}); },
    clear: function () { return tx('readwrite', function (s) { return s.clear(); }).catch(function () {}); },
  };

  IPTV.Settings = Settings;
  IPTV.Positions = Positions;
  IPTV.Cache = Cache;
})();
