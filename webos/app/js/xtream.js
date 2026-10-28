/* Client per le API "player_api.php" dei pannelli Xtream Codes (come le versioni Windows e Android). */
(function () {
  'use strict';
  var u = IPTV.u;

  function XtreamError(message, isAuth) {
    this.message = message;
    this.isAuth = !!isAuth;
  }

  /**
   * Accetta "host:porta", "http://host:porta/" o l'intero link M3U
   * (get.php?username=..&password=..) e restituisce server, utente e password.
   */
  function parseServerInput(input) {
    var s = String(input || '').trim();
    if (!s) return { server: '' };
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    var m = /^(https?:\/\/[^\/?#]+)([^?#]*)(\?[^#]*)?/i.exec(s);
    if (!m) return { server: s.replace(/\/+$/, '') };
    var path = m[2] || '';
    var last = path.lastIndexOf('/');
    if (last >= 0 && /\.php$/i.test(path.substring(last + 1))) path = path.substring(0, last);
    var user = null, pass = null;
    (m[3] || '').replace(/^\?/, '').split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv.length < 2) return;
      var v = decodeURIComponent(kv.slice(1).join('=').replace(/\+/g, ' '));
      if (kv[0].toLowerCase() === 'username') user = v;
      else if (kv[0].toLowerCase() === 'password') pass = v;
    });
    return { server: (m[1] + path).replace(/\/+$/, ''), username: user, password: pass };
  }

  function q(v) { return encodeURIComponent(v); }
  function str(v) { return v === null || v === undefined ? null : typeof v === 'boolean' ? (v ? '1' : '0') : String(v); }
  function nn(v) { v = str(v); return v && v.trim() ? v.trim() : null; }
  function int(v) { var n = parseInt(str(v), 10); return isNaN(n) ? null : n; }

  function yearOf(year, date, name) {
    var list = [year, date];
    for (var i = 0; i < list.length; i++) {
      var t = nn(list[i]);
      if (t && t.length >= 4) { var y = parseInt(t.substring(0, 4), 10); if (y > 1880) return String(y); }
    }
    var m = /\((19|20)\d{2}\)/.exec(name || '');
    return m ? m[0].replace(/[()]/g, '') : null;
  }

  function ratingOf(e) {
    var r = parseFloat(str(e.rating));
    if (r > 0) return Math.min(r, 10);
    r = parseFloat(str(e.rating_5based));
    return r > 0 ? Math.min(r * 2, 10) : 0;
  }

  function meta(year, genre, rating) {
    return u.joinMeta(year, genre, rating > 0 ? '★ ' + rating.toFixed(1) : null);
  }

  function b64(s) {
    if (!s) return s;
    try { return decodeURIComponent(escape(atob(s))).trim(); } catch (e) { return s; }
  }

  function Client(account) {
    this.account = account;
  }

  Client.prototype.api = function (action, extra) {
    var a = this.account;
    var url = a.server + '/player_api.php?username=' + q(a.username) + '&password=' + q(a.password);
    if (action) url += '&action=' + action;
    if (extra) url += '&' + extra;
    return url;
  };

  Client.prototype.liveUrl = function (id, ext) { var a = this.account; return a.server + '/live/' + q(a.username) + '/' + q(a.password) + '/' + id + '.' + ext; };
  Client.prototype.movieUrl = function (id, ext) { var a = this.account; return a.server + '/movie/' + q(a.username) + '/' + q(a.password) + '/' + id + '.' + ext; };
  Client.prototype.episodeUrl = function (id, ext) { var a = this.account; return a.server + '/series/' + q(a.username) + '/' + q(a.password) + '/' + q(id) + '.' + ext; };

  /** Tre tentativi, attese crescenti: i pannelli IPTV a volte non rispondono al primo colpo. */
  Client.prototype.json = function (url, timeoutMs) {
    var attempt = 0;
    function run() {
      return u.fetchTimeout(url, timeoutMs).then(function (r) {
        if (r.status === 401 || r.status === 403) throw new XtreamError('Accesso negato dal server (credenziali errate o account scaduto).', true);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).catch(function (e) {
        if (e instanceof XtreamError) throw e;
        if (++attempt >= 3) throw new XtreamError('Impossibile contattare il server. Controlla la connessione.');
        return u.delay(500 * attempt).then(run);
      });
    }
    return run();
  };

  Client.prototype.authenticate = function () {
    return this.json(this.api(null), 15000).then(function (root) {
      var ui = root && root.user_info;
      if (!ui || typeof ui !== 'object') throw new XtreamError('Il server non ha risposto come un pannello Xtream Codes. Controlla l\'indirizzo.');
      if (int(ui.auth) !== 1) throw new XtreamError('Nome utente o password non corretti.', true);
      var status = str(ui.status);
      if (status && status.toLowerCase() !== 'active') throw new XtreamError('Account non attivo (stato: ' + status + ').', true);
      return ui;
    });
  };

  Client.prototype.categories = function (action) {
    return this.json(this.api(action), 30000).then(function (list) {
      return (Array.isArray(list) ? list : []).filter(function (e) { return e && str(e.category_id) !== null; })
        .map(function (e) { return { id: str(e.category_id), name: (str(e.category_name) || str(e.category_id)).trim() }; });
    });
  };

  Client.prototype.channels = function () {
    return this.json(this.api('get_live_streams'), 90000).then(function (list) {
      return (Array.isArray(list) ? list : []).filter(function (e) { return e && int(e.stream_id) !== null; }).map(function (e) {
        var id = int(e.stream_id);
        var name = (str(e.name) || 'Canale ' + id).trim();
        return {
          streamId: id, num: int(e.num) || 0, name: name, logo: nn(e.stream_icon), categoryId: str(e.category_id),
          key: u.normalize(name), initials: u.initials(name),
        };
      });
    });
  };

  Client.prototype.movies = function () {
    return this.json(this.api('get_vod_streams'), 180000).then(function (list) {
      return (Array.isArray(list) ? list : []).filter(function (e) { return e && int(e.stream_id) !== null; }).map(function (e) {
        var id = int(e.stream_id);
        var name = (str(e.name) || 'Film ' + id).trim();
        var year = yearOf(e.year, e.releasedate, name);
        var rating = ratingOf(e);
        return {
          kind: 'movie', streamId: id, name: name, poster: nn(e.stream_icon), categoryId: str(e.category_id),
          ext: nn(e.container_extension) || 'mp4', year: year, rating: rating, added: parseInt(str(e.added), 10) || 0,
          key: u.normalize(name), initials: u.initials(name), meta: meta(year, null, rating), posKey: 'm:' + id,
        };
      });
    });
  };

  Client.prototype.series = function () {
    return this.json(this.api('get_series'), 180000).then(function (list) {
      return (Array.isArray(list) ? list : []).filter(function (e) { return e && int(e.series_id) !== null; }).map(function (e) {
        var id = int(e.series_id);
        var name = (str(e.name) || 'Serie ' + id).trim();
        var year = yearOf(e.year, e.releaseDate || e.release_date, name);
        var rating = ratingOf(e);
        return {
          kind: 'series', seriesId: id, name: name, cover: nn(e.cover), categoryId: str(e.category_id),
          year: year, rating: rating, plot: nn(e.plot), genre: nn(e.genre),
          key: u.normalize(name), initials: u.initials(name), meta: meta(year, nn(e.genre), rating),
        };
      });
    });
  };

  Client.prototype.vodInfo = function (id) {
    return this.json(this.api('get_vod_info', 'vod_id=' + id), 20000).then(function (root) {
      var i = root && root.info;
      if (!i || typeof i !== 'object') return null;
      var secs = int(i.duration_secs) || 0;
      return {
        plot: nn(i.plot) || nn(i.description), genre: nn(i.genre), year: yearOf(i.year, i.releasedate, ''),
        duration: secs > 0 ? Math.round(secs / 60) + ' min' : nn(i.duration), director: nn(i.director), cast: nn(i.cast) || nn(i.actors),
      };
    });
  };

  Client.prototype.seriesInfo = function (seriesId) {
    return this.json(this.api('get_series_info', 'series_id=' + seriesId), 30000).then(function (root) {
      var groups = [];
      var eps = root && root.episodes;
      // Alcuni pannelli restituiscono { "1": [...], "2": [...] }, altri [[...], [...]].
      if (Array.isArray(eps)) groups = eps;
      else if (eps && typeof eps === 'object') groups = Object.keys(eps).map(function (k) { return eps[k]; });
      var episodes = [];
      groups.forEach(function (g) {
        (Array.isArray(g) ? g : []).forEach(function (e) {
          var id = str(e && e.id);
          if (!id) return;
          var info = e.info && typeof e.info === 'object' ? e.info : {};
          var number = int(e.episode_num) || 0;
          var secs = int(info.duration_secs) || 0;
          episodes.push({
            id: id, seriesId: seriesId, season: int(e.season) || 1, number: number,
            title: (str(e.title) || '').trim() || 'Episodio ' + number, ext: nn(e.container_extension) || 'mp4',
            duration: secs > 0 ? Math.max(1, Math.round(secs / 60)) + ' min' : '', plot: nn(info.plot), image: nn(info.movie_image),
            posKey: 'e:' + id,
          });
        });
      });
      episodes.sort(function (a, b) { return a.season - b.season || a.number - b.number; });
      var si = root && root.info && typeof root.info === 'object' ? root.info : {};
      return { plot: nn(si.plot), genre: nn(si.genre), year: yearOf(si.year, si.releaseDate || si.release_date, ''), episodes: episodes };
    });
  };

  /** Guida breve di un canale: programma in onda e successivi. */
  Client.prototype.shortEpg = function (streamId) {
    return this.json(this.api('get_short_epg', 'stream_id=' + streamId + '&limit=4'), 15000).then(function (root) {
      var list = (root && root.epg_listings) || [];
      return list.map(function (e) {
        return { start: int(e.start_timestamp), stop: int(e.stop_timestamp), title: b64(str(e.title)) || '' };
      }).filter(function (p) { return p.start && p.stop; }).sort(function (a, b) { return a.start - b.start; });
    });
  };

  IPTV.Xtream = { Client: Client, XtreamError: XtreamError, parseServerInput: parseServerInput };
})();
