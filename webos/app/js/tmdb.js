/*
 * TMDB (themoviedb.org): copertine, tendenze e generi per la schermata "Film e serie".
 * Il catalogo resta quello del provider: TMDB sceglie e veste solo i titoli che ci sono.
 * Stessa logica di PWA/web/src/lib/tmdb.ts, in JavaScript per i TV.
 */
(function () {
  'use strict';
  var u = IPTV.u;

  // shortcut: risposte tenute solo in memoria (a ogni avvio ~60 richieste), salvarle se TMDB inizia a limitare.
  var cache = {};
  // Al massimo 4 richieste insieme: la schermata ne chiede ~60, TMDB risponde 429 alle raffiche e i TV sono lenti.
  var running = 0, waiting = [];

  function slot(work) {
    return new Promise(function (resolve) {
      function go() { running++; resolve(); }
      if (running < 4) go(); else waiting.push(go);
    }).then(work).then(function (v) { done(); return v; }, function (e) { done(); throw e; });
  }

  function done() {
    running--;
    var next = waiting.shift();
    if (next) next();
  }

  function fetchJson(url, headers, tries) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('TMDB non raggiungibile.')); }, 20000);
      fetch(url, { headers: headers, credentials: 'omit' }).then(function (r) {
        clearTimeout(timer);
        // Troppe richieste insieme: si aspetta quanto dice TMDB (o un secondo) e si riprova.
        if (r.status === 429 && tries > 0) {
          u.delay((parseInt(r.headers.get('Retry-After'), 10) || 1) * 1000).then(function () { return fetchJson(url, headers, tries - 1); }).then(resolve, reject);
          return;
        }
        if (r.status === 401) { reject(new Error('Chiave TMDB non valida.')); return; }
        if (!r.ok) { reject(new Error('TMDB: errore ' + r.status)); return; }
        r.json().then(resolve, reject);
      }, function () { clearTimeout(timer); reject(new Error('TMDB non raggiungibile.')); });
    });
  }

  function get(key, path, params) {
    // I token v4 sono JWT ("eyJ..."), le chiavi v3 sono 32 caratteri esadecimali.
    var bearer = key.indexOf('eyJ') === 0;
    var q = ['language=it-IT'];
    Object.keys(params || {}).forEach(function (k) { q.push(k + '=' + encodeURIComponent(params[k])); });
    if (!bearer) q.push('api_key=' + encodeURIComponent(key));
    var url = 'https://api.themoviedb.org/3/' + path + '?' + q.join('&');
    if (!cache[url]) {
      cache[url] = slot(function () { return fetchJson(url, bearer ? { Authorization: 'Bearer ' + key } : {}, 3); });
      cache[url].catch(function () { delete cache[url]; });
    }
    return cache[url];
  }

  function img(path, size) { return path ? 'https://image.tmdb.org/t/p/' + (size || 'w342') + path : null; }

  /** Lo stesso titolo, qualunque cosa abbia aggiunto il pannello: prefisso di lingua, sigle di qualità, anno. */
  function matchKey(name) { return u.variantKey(name).replace(/\b(19|20)\d\d\b/g, ' ').replace(/\s+/g, ' ').trim(); }

  function card(r, kind) {
    var k = kind || (r.media_type === 'movie' ? 'movie' : r.media_type === 'tv' ? 'tv' : null);
    if (!k) return null;
    var title = r.title || r.name || '';
    var original = r.original_title || r.original_name || '';
    var date = r.release_date || r.first_air_date || '';
    var keys = [];
    [matchKey(title), matchKey(original)].forEach(function (x) { if (x && keys.indexOf(x) < 0) keys.push(x); });
    return {
      id: r.id, kind: k, title: title, year: date.slice(0, 4) || null, overview: r.overview || '',
      poster: r.poster_path || null, backdrop: r.backdrop_path || null, vote: r.vote_average || 0, keys: keys,
    };
  }

  function cards(page, kind) { return (page.results || []).map(function (r) { return card(r, kind); }).filter(Boolean); }

  // ---------- Le righe della schermata ----------

  function pages(kind, path, n, params) {
    var out = [];
    for (var i = 1; i <= n; i++) {
      var p = { page: i };
      Object.keys(params || {}).forEach(function (k) { p[k] = params[k]; });
      out.push({ kind: kind, path: path, params: p });
    }
    return out;
  }

  function discover(kind, genre) {
    return pages(kind, 'discover/' + kind, 2, { with_genres: genre, sort_by: 'popularity.desc', 'vote_count.gte': kind === 'movie' ? 150 : 60 });
  }

  // Titolo, genere dei film, genere delle serie (TMDB ha due elenchi di generi diversi).
  var GENRES = [
    ['Azione e avventura', 28, 10759], ['Commedie', 35, 35], ['Fantascienza e fantasy', 878, 10765], ['Crime', 80, 80],
    ['Thriller e mistero', 53, 9648], ['Drammi', 18, 18], ['Animazione', 16, 16], ['Horror', 27, null],
    ['Romantici', 10749, null], ['Per tutta la famiglia', 10751, 10751], ['Documentari', 99, 99],
  ];

  var DEFS = [
    { id: 'top', title: 'Top 10 di oggi', top: true, sources: pages('movie', 'trending/all/day', 3) },
    { id: 'trend', title: 'Di tendenza questa settimana', sources: pages('movie', 'trending/all/week', 3) },
    { id: 'popm', title: 'Film popolari', sources: pages('movie', 'movie/popular', 3) },
    { id: 'popt', title: 'Serie TV popolari', sources: pages('tv', 'tv/popular', 3) },
    { id: 'best', title: 'I più acclamati', sources: pages('movie', 'movie/top_rated', 3).concat(pages('tv', 'tv/top_rated', 3)) },
  ].concat(GENRES.map(function (g) {
    return { id: 'g:' + g[0], title: g[0], sources: (g[1] ? discover('movie', g[1]) : []).concat(g[2] ? discover('tv', g[2]) : []) };
  }));

  /** Film e serie affiancati: il primo dell'una, il primo dell'altra e così via. */
  function interleave(a, b) {
    var out = [];
    for (var i = 0; i < Math.max(a.length, b.length); i++) { if (i < a.length) out.push(a[i]); if (i < b.length) out.push(b[i]); }
    return out;
  }

  function flat(lists) { return [].concat.apply([], lists); }

  /** Le classifiche cambiano una volta al giorno: si scaricano alla prima apertura della giornata, poi si rileggono dal TV. */
  function loadRows(key) {
    var d = new Date(), day = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    var hash = 0;
    for (var i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
    try {
      var c = JSON.parse(localStorage.getItem('tmdbRows') || 'null');
      if (c && c.day === day && c.key === hash) return Promise.resolve(c.rows);
    } catch (e) { /* niente di salvato */ }
    return downloadRows(key).then(function (rows) {
      // Solo se TMDB ha risposto: righe vuote (rete assente) non devono restare per tutto il giorno.
      if (rows.some(function (r) { return r.items.length; })) {
        try { localStorage.setItem('tmdbRows', JSON.stringify({ day: day, key: hash, rows: rows })); } catch (e) { /* spazio esaurito */ }
      }
      return rows;
    });
  }

  function downloadRows(key) {
    return Promise.all(DEFS.map(function (d) {
      return Promise.all(d.sources.map(function (s) {
        var trending = s.path.indexOf('trending') === 0;
        // trending/all mescola i due: il tipo arriva con ogni risultato.
        return get(key, s.path, s.params).then(function (p) { return cards(p, trending ? null : s.kind); }, function () { return []; });
      })).then(function (answers) {
        var trending = d.sources.some(function (s) { return s.path.indexOf('trending') === 0; });
        var items = trending ? flat(answers) : interleave(
          flat(answers.filter(function (_, i) { return d.sources[i].kind === 'movie'; })),
          flat(answers.filter(function (_, i) { return d.sources[i].kind === 'tv'; })));
        return { id: d.id, title: d.title, top: !!d.top, items: items };
      });
    }));
  }

  /** La scheda TMDB di un titolo del catalogo (continua a guardare, schede di dettaglio). */
  function lookup(key, kind, name, year) {
    var query = matchKey(name);
    if (!query || !key) return Promise.resolve(null);
    return get(key, 'search/' + kind, { query: query }).then(function (p) {
      var list = cards(p, kind).filter(function (c) { return c.keys.indexOf(query) >= 0; });
      var y = year ? String(year).slice(0, 4) : null;
      return list.filter(function (c) { return y && c.year === y; })[0] || list[0] || null;
    }, function () { return null; });
  }

  /** I remake hanno lo stesso titolo: gli anni devono coincidere (±1) quando ci sono entrambi. */
  function yearsClose(a, b) {
    var x = parseInt(a, 10), y = parseInt(b, 10);
    return isNaN(x) || isNaN(y) || Math.abs(x - y) <= 1;
  }

  /** Il catalogo ritrovabile per titolo: { movies: { chiave: entry }, series: {...} }, ogni entry con le sue versioni. */
  function index(movies, series) {
    function byKey(entries) {
      var m = {};
      entries.forEach(function (e) { var k = matchKey(e.item.name); if (k && !m[k]) m[k] = e; });
      return m;
    }
    return { movie: byKey(u.groupVariants(movies, function (x) { return x.name; })), tv: byKey(u.groupVariants(series, function (x) { return x.name; })) };
  }

  function find(c, idx) {
    for (var i = 0; i < c.keys.length; i++) {
      var e = idx[c.kind][c.keys[i]];
      if (e && yearsClose(e.item.year, c.year)) return e;
    }
    return null;
  }

  function check(key) { return get(String(key).trim(), 'configuration'); }
  function clear() { cache = {}; }

  IPTV.Tmdb = { img: img, matchKey: matchKey, loadRows: loadRows, lookup: lookup, index: index, find: find, check: check, clear: clear };
})();
