/*
 * "Server di casa": IPTVISION installato su CasaOS (la versione web) fa da server Xtream per il TV.
 * Collegato al server, il TV usa come server Xtream l'indirizzo di casa, come utente l'account del
 * server e come password il gettone di questo TV: liste, guida e flussi passano da casa e l'account
 * IPTV vero resta solo sul server. Preferiti e posizioni sono quelli dell'account, uguali ovunque.
 */
(function () {
  'use strict';
  var S = IPTV.Settings, Pos = IPTV.Positions;

  /** Porta di IPTVISION su CasaOS quando nell'indirizzo non c'è. */
  var DEFAULT_PORT = 8765;
  var pending = [];

  /** "192.168.1.10" → "http://192.168.1.10:8765"; con https o con la porta resta com'è, senza "/" finale. */
  function normalize(input) {
    var s = String(input || '').trim().replace(/\/+$/, '');
    if (!s) return s;
    if (/^https?:\/\//i.test(s)) return s;
    var slash = s.indexOf('/');
    var host = slash < 0 ? s : s.slice(0, slash);
    var rest = slash < 0 ? '' : s.slice(slash);
    return host.indexOf(':') >= 0 ? 'http://' + s : 'http://' + host + ':' + DEFAULT_PORT + rest;
  }

  function call(url, method, path, token, body) {
    var headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body) headers['Content-Type'] = 'application/json';
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; reject(new Error('Il server non risponde: riprova tra poco.')); } }, 30000);
      fetch(url + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, credentials: 'omit' }).then(function (r) {
        return r.text().then(function (text) {
          if (done) return;
          done = true; clearTimeout(timer);
          var o;
          try { o = JSON.parse(text || '{}'); } catch (e) { reject(new Error('A questo indirizzo non risponde IPTVISION. Controlla indirizzo e porta.')); return; }
          if (r.status === 401 && token) { reject(new Error('Sessione del server scaduta: ricollega il server dalle impostazioni.')); return; }
          if (!r.ok) { reject(new Error(o.error || 'Errore del server (' + r.status + ').')); return; }
          resolve(o);
        });
      }, function () {
        if (done) return;
        done = true; clearTimeout(timer);
        reject(new Error('Server non raggiungibile: controlla indirizzo, porta e che il TV sia nella stessa rete.'));
      });
    });
  }

  var Server = {
    normalize: normalize,
    active: function () { return !!S.get('homeServer'); },
    url: function () { return S.get('homeServer'); },
    /** Chiamato quando arrivano preferiti e posizioni nuovi: l'app ridisegna. */
    onState: null,
    syncedAt: null,
    error: null,

    login: function (url, username, password, register, invite) {
      return call(url, 'POST', '/api/device/login', null, {
        username: username, password: password, register: register, invite: invite,
        device: 'IPTVISION TV ' + IPTV.Platform.brand,
      });
    },
    sendXtream: function (url, token, account) { return call(url, 'POST', '/api/xtream', token, account); },
    importNative: function (url, token, data) { return call(url, 'POST', '/api/import-native', token, data); },
    logout: function (url, token) { return call(url, 'POST', '/api/logout', token, {}).catch(function () { /* già scollegato */ }); },

    queue: function (op, now) {
      if (!Server.active()) return;
      pending.push(op);
      if (now) Server.flush();
    },

    /** Manda al server le modifiche fatte qui; se non risponde restano in coda e ripartono dopo. */
    flush: function () {
      if (!Server.active() || !pending.length) return Promise.resolve();
      var ops = pending;
      pending = [];
      return call(Server.url(), 'POST', '/api/ops', S.get('password'), { ops: ops }).then(Server.apply, function (e) {
        pending = ops.concat(pending);
        Server.error = e.message;
      });
    },

    /** Preferiti e posizioni cambiati da un altro dispositivo dello stesso account. */
    pull: function (force) {
      if (!Server.active()) return Promise.resolve();
      var since = force ? '' : '?since=' + S.get('homeRevision');
      return call(Server.url(), 'GET', '/api/state' + since, S.get('password'), null).then(function (o) {
        Server.error = null;
        Server.syncedAt = Date.now();
        if (!o.unchanged) Server.apply(o);
      }, function (e) { Server.error = e.message; });
    },

    apply: function (o) {
      Server.syncedAt = Date.now();
      if (pending.length) return; // prima partono le nostre
      S.set('homeRevision', o.revision);
      S.set('favorites', o.favorites || []);
      Pos.replaceWith(o);
      if (Server.onState) Server.onState();
    },

    clearQueue: function () { pending = []; },
  };

  Pos.onChange = function (op) { Server.queue(op); };
  S.onFavorite = function (id, on) { Server.queue({ op: 'favorite', streamId: id, on: on }, true); };

  IPTV.Server = Server;
})();
