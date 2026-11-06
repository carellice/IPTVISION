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
    sorts: {}, grids: { Movies: true, Series: true }, hideAdult: false,
    // Server di casa (IPTVISION su CasaOS): indirizzo, ultima revisione avuta e l'account IPTV di prima.
    homeServer: null, homeRevision: -1, own: null,
    // Liste IPTV salvate: { alias, server, username, password, expiresAt } (secondi Unix, null = nessuna scadenza).
    lists: [],
  };
  Object.keys(defaults).forEach(function (k) { if (settings[k] === undefined) settings[k] = defaults[k]; });

  function sameList(a, b) {
    return String(a.server || '').toLowerCase() === String(b.server || '').toLowerCase() && a.username === b.username;
  }

  var Settings = {
    get: function (k) { return settings[k]; },
    set: function (k, v) { settings[k] = v; save('settings', settings); },
    account: function () {
      if (!settings.server || !settings.username) return null;
      return { server: settings.server, username: settings.username, password: settings.password || '' };
    },
    /** Liste salvate; un account di prima delle liste diventa la prima lista. */
    lists: function () {
      if (!settings.lists.length && settings.server && settings.username && !settings.homeServer) {
        settings.lists.push({ alias: settings.username, server: settings.server, username: settings.username, password: settings.password || '', expiresAt: null });
        save('settings', settings);
      }
      return settings.lists;
    },
    /** Aggiunge la lista o aggiorna quella con stesso server e utente (il nome resta se non se ne dà uno nuovo). */
    saveList: function (l) {
      var all = Settings.lists();
      for (var i = 0; i < all.length; i++) {
        if (sameList(all[i], l)) { l.alias = l.alias || all[i].alias; all[i] = l; save('settings', settings); return; }
      }
      l.alias = l.alias || l.username;
      all.push(l);
      save('settings', settings);
    },
    removeList: function (l) {
      settings.lists = Settings.lists().filter(function (x) { return !sameList(x, l); });
      save('settings', settings);
    },
    /** La lista in uso, se il TV parla direttamente col provider. */
    activeList: function () {
      if (settings.homeServer) return null;
      var cur = { server: settings.server, username: settings.username };
      return Settings.lists().filter(function (x) { return sameList(x, cur); })[0] || null;
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
      if (Settings.onFavorite) Settings.onFavorite(id, i < 0);
    },
    /** Chiamato a ogni preferito aggiunto o tolto (il server di casa lo registra). */
    onFavorite: null,
    /** L'account IPTV del TV prima di collegare il server di casa: torna quando lo si scollega. */
    stashOwnAccount: function () {
      settings.own = { server: settings.server, username: settings.username, password: settings.password };
      save('settings', settings);
    },
    restoreOwnAccount: function () {
      var own = settings.own || {};
      settings.server = own.server || null;
      settings.username = own.username || null;
      settings.password = own.password || null;
      settings.own = null;
      settings.homeServer = null;
      settings.homeRevision = -1;
      settings.lastStreamId = null;
      settings.lastCategoryId = null;
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

  function changed(op) { if (Positions.onChange) Positions.onChange(op); }

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
      changed({ op: 'position', key: key, p: Math.round(p), d: Math.round(d) });
      return false;
    },
    markWatched: function (key) {
      delete pos.positions[key];
      pos.watched[key] = 1;
      dirty = true;
      changed({ op: 'watched', key: key });
    },
    setLastEpisode: function (seriesId, episodeId) {
      pos.lastEpisode[seriesId] = { id: episodeId, u: Date.now() };
      dirty = true;
      changed({ op: 'lastEpisode', seriesId: Number(seriesId), id: String(episodeId) });
    },
    lastEpisode: function (seriesId) { return pos.lastEpisode[seriesId] || null; },
    /** Toglie un film da "Continua a guardare": dimentica il punto raggiunto. */
    forgetPosition: function (key) {
      if (pos.positions[key]) { delete pos.positions[key]; dirty = true; }
      changed({ op: 'forgetPosition', key: key });
    },
    /** Toglie una serie da "Continua a guardare". Gli episodi restano segnati come visti. */
    forgetSeries: function (seriesId) {
      if (pos.lastEpisode[seriesId]) { delete pos.lastEpisode[seriesId]; dirty = true; }
      changed({ op: 'forgetSeries', seriesId: Number(seriesId) });
    },
    /** Chiamato a ogni modifica, nel formato delle operazioni del server di casa. */
    onChange: null,
    /** Tutto il contenuto nel formato del server di casa (watched come elenco). */
    toJson: function () {
      return { positions: pos.positions, watched: Object.keys(pos.watched), lastEpisode: pos.lastEpisode };
    },
    /** Sostituisce tutto con i dati del server di casa. */
    replaceWith: function (o) {
      var w = {};
      (o.watched || []).forEach(function (k) { w[k] = 1; });
      pos = { positions: o.positions || {}, watched: w, lastEpisode: o.lastEpisode || {} };
      dirty = true;
      Positions.save();
    },
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
