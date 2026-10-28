/* IPTVISION per TV LG (webOS): stato dell'app, schermate e telecomando. */
(function () {
  'use strict';
  var u = IPTV.u, h = u.h, V = IPTV.V, Nav = IPTV.Nav, KEY = Nav.KEY;
  var S = IPTV.Settings, Pos = IPTV.Positions, Player = IPTV.Player, X = IPTV.Xtream;

  var ALL = '__all', FAV = '__fav', CONT = '__continue';
  var SECTIONS = [
    { id: 'Live', title: 'TV in diretta', icon: '📺' },
    { id: 'Movies', title: 'Film', icon: '🎬' },
    { id: 'Series', title: 'Serie TV', icon: '🎞' },
    { id: 'Search', title: 'Cerca', icon: '🔍' },
    { id: 'Settings', title: 'Impostazioni', icon: '⚙' },
  ];
  var SORTS = {
    Default: 'Predefinito', Number: 'Numero', NameAsc: 'Nome (A-Z)', NameDesc: 'Nome (Z-A)',
    Recent: 'Aggiunti di recente', Year: 'Anno (più recenti)', Rating: 'Voto',
  };
  var SORT_OPTIONS = {
    Live: ['Default', 'Number', 'NameAsc', 'NameDesc'],
    Movies: ['Default', 'Recent', 'NameAsc', 'NameDesc', 'Year', 'Rating'],
    Series: ['Default', 'NameAsc', 'NameDesc', 'Year', 'Rating'],
  };
  var SCOPES = [['All', 'Tutto'], ['Channels', 'Canali'], ['Movies', 'Film'], ['Series', 'Serie']];

  var root = document.getElementById('root');
  var pui = document.getElementById('player-ui');
  var modal = document.getElementById('modal');

  var A = {
    client: null,
    live: null, movies: null, series: null,
    loading: {},
    screen: 'login', section: 'Live',
    openCat: {}, lastCat: {},
    search: '', scope: 'All',
    epg: {},
    playing: null,
    stack: [],
    update: null,
  };

  // ---------- Dati ----------

  function library(cats, items) {
    var by = {};
    items.forEach(function (it) { (by[it.categoryId] = by[it.categoryId] || []).push(it); });
    return { cats: cats.filter(function (c) { return by[c.id]; }), items: items, by: by };
  }

  // Dopo quanto le liste salvate sul TV si riscaricano dal server ("Aggiorna liste" lo fa subito).
  var MAX_AGE = { live: 6 * 3600000, movies: 24 * 3600000, series: 24 * 3600000 };

  /** Categorie e contenuti di una sezione: dalla copia sul TV se è recente, altrimenti dal server. */
  function loadList(kind, download) {
    var client = A.client, a = client.account;
    var key = kind + '|' + a.server + '|' + a.username;
    return IPTV.Cache.get(key).then(function (c) {
      if (c && c.items && c.items.length && Date.now() - c.at < MAX_AGE[kind]) return c;
      return download().then(function (r) {
        var v = { at: Date.now(), cats: r[0], items: r[1] };
        // Si salva qualche secondo dopo, quando l'elenco è già a schermo.
        setTimeout(function () { if (A.client === client) IPTV.Cache.put(key, v); }, 5000);
        return v;
      });
    });
  }

  function openAccount(account, autoPlay) {
    A.client = new X.Client(account);
    A.live = A.movies = A.series = null;
    A.loading = {};
    A.screen = 'home';
    A.section = 'Live';
    render();
    A.loading.live = true;
    var client = A.client;
    loadList('live', function () { return Promise.all([client.categories('get_live_categories'), client.channels()]); }).then(function (c) {
      if (A.client !== client) return;
      A.live = library(c.cats, c.items);
      A.loading.live = false;
      if (A.screen === 'home') render();
      if (autoPlay) autoPlayLast();
    }).catch(function (e) {
      A.loading.live = false;
      A.error = e.message || 'Impossibile caricare i canali.';
      if (A.screen === 'home') render();
    });
  }

  function ensure(kind) {
    if (A[kind] || A.loading[kind] || !A.client) return;
    A.loading[kind] = true;
    var cats = kind === 'movies' ? 'get_vod_categories' : 'get_series_categories';
    var client = A.client;
    loadList(kind, function () { return Promise.all([client.categories(cats), kind === 'movies' ? client.movies() : client.series()]); }).then(function (c) {
      if (A.client !== client) return;
      A[kind] = library(c.cats, c.items);
      A.loading[kind] = false;
      if (A.screen !== 'home') return;
      // In Cerca si aggiornano solo i risultati: ridisegnare tutto toglierebbe la tastiera a chi scrive.
      if (A.section === 'Search') { if (A.rerunSearch) A.rerunSearch(); }
      else render(true);
    }).catch(function (e) {
      A.loading[kind] = false;
      u.toast(e.message || 'Impossibile caricare il catalogo.');
    });
  }

  function yearOf(it) { return parseInt(it.year, 10) || 0; }
  function byKey(a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; }

  function sorted(section, list) {
    var s = S.sortOf(section);
    list = list.slice();
    if (s === 'Number') list.sort(function (a, b) { return (a.num > 0 ? a.num : 1e9) - (b.num > 0 ? b.num : 1e9); });
    else if (s === 'NameAsc') list.sort(byKey);
    else if (s === 'NameDesc') list.sort(function (a, b) { return byKey(b, a); });
    else if (s === 'Recent') list.sort(function (a, b) { return b.added - a.added; });
    else if (s === 'Year') list.sort(function (a, b) { return yearOf(b) - yearOf(a) || byKey(a, b); });
    else if (s === 'Rating') list.sort(function (a, b) { return b.rating - a.rating || byKey(a, b); });
    return list;
  }

  function channelsFor(cat) {
    var l = A.live;
    if (!l) return [];
    var list = cat === ALL ? l.items : cat === FAV ? l.items.filter(function (c) { return S.isFavorite(c.streamId); }) : l.by[cat] || [];
    return sorted('Live', list);
  }

  function moviesFor(cat) {
    var l = A.movies;
    if (!l) return [];
    var list = cat === ALL ? l.items
      : cat === CONT ? l.items.filter(function (m) { return Pos.resumeMs(m.posKey) > 0; }).sort(function (a, b) { return Pos.updatedAt(b.posKey) - Pos.updatedAt(a.posKey); })
        : l.by[cat] || [];
    return u.groupVariants(sorted('Movies', list), function (m) { return m.name; });
  }

  function seriesFor(cat) {
    var l = A.series;
    if (!l) return [];
    var list = cat === ALL ? l.items
      : cat === CONT ? l.items.filter(function (s) { return Pos.lastEpisode(s.seriesId); }).sort(function (a, b) { return Pos.lastEpisode(b.seriesId).u - Pos.lastEpisode(a.seriesId).u; })
        : l.by[cat] || [];
    return u.groupVariants(sorted('Series', list), function (s) { return s.name; });
  }

  function catEntries(section) {
    var l = section === 'Live' ? A.live : section === 'Movies' ? A.movies : A.series;
    if (!l) return [];
    var out = [];
    if (section === 'Live') {
      out.push({ id: FAV, name: 'Preferiti', count: l.items.filter(function (c) { return S.isFavorite(c.streamId); }).length });
      out.push({ id: ALL, name: 'Tutti', count: l.items.length });
    } else {
      var cont = section === 'Movies' ? moviesFor(CONT).length : seriesFor(CONT).length;
      if (cont) out.push({ id: CONT, name: 'Continua a guardare', count: cont });
      out.push({ id: ALL, name: section === 'Series' ? 'Tutte' : 'Tutti', count: l.items.length });
    }
    l.cats.forEach(function (c) { out.push({ id: c.id, name: c.name, count: (l.by[c.id] || []).length }); });
    return out;
  }

  /** Guida breve: il programma in onda del canale, chiesto al server al massimo ogni 20 minuti. */
  function nowTitle(ch, cb) {
    var e = A.epg[ch.streamId];
    var now = Date.now() / 1000;
    function pick(list) {
      for (var i = 0; i < list.length; i++) if (list[i].start <= now && list[i].stop > now) return list[i];
      return null;
    }
    if (e && (Date.now() - e.at < 20 * 60000)) { var p = pick(e.list); if (cb) cb(p, e.list); return p; }
    if (!A.client || (e && e.pending)) return null;
    A.epg[ch.streamId] = { at: Date.now(), list: e ? e.list : [], pending: true };
    A.client.shortEpg(ch.streamId).then(function (list) {
      A.epg[ch.streamId] = { at: Date.now(), list: list };
      if (cb) cb(pick(list), list);
    }).catch(function () { A.epg[ch.streamId] = { at: Date.now(), list: [] }; });
    return null;
  }

  // ---------- Navigazione tra schermate ----------

  function push(screen, data) {
    A.stack.push({ screen: A.screen, data: A.data, focus: Nav.current() });
    A.screen = screen;
    A.data = data;
    render();
  }

  function back() {
    if (modal.classList.contains('open')) { closeModal(); return true; }
    if (A.screen === 'player') { leavePlayer(); return true; }
    if (A.stack.length) {
      var s = A.stack.pop();
      A.screen = s.screen; A.data = s.data;
      render(false, s.focus);
      return true;
    }
    if (A.screen === 'home' && A.openCat[A.section]) { A.openCat[A.section] = null; render(); return true; }
    if (A.screen === 'home' && A.section !== 'Live') { A.section = 'Live'; render(); return true; }
    return false;
  }

  // ---------- Disegno delle schermate ----------

  var focusAfterRender = null;

  /** keep = true: ridisegna mantenendo, se possibile, l'elemento col focus. */
  function render(keep, preferred) {
    var prevKey = keep && Nav.current() ? Nav.current().dataset.key : null;
    root.innerHTML = '';
    focusAfterRender = preferred || null;
    if (A.screen === 'login') renderLogin();
    else if (A.screen === 'home') renderHome();
    else if (A.screen === 'movie') renderMovie(A.data);
    else if (A.screen === 'series') renderSeries(A.data);
    var target = focusAfterRender;
    if (!target && prevKey) target = root.querySelector('[data-key="' + prevKey + '"]');
    if (target && !document.body.contains(target)) target = target.dataset && target.dataset.key ? root.querySelector('[data-key="' + target.dataset.key + '"]') : null;
    if (A.screen !== 'player') Nav.setScope(root, target);
  }

  function renderLogin() {
    var server = h('input', { type: 'url', placeholder: 'http://server:porta oppure il link get.php completo', value: S.get('server') || '' });
    var user = h('input', { type: 'text', value: S.get('username') || '' });
    var pass = h('input', { type: 'password' });
    var err = h('div', { class: 'error' }, A.loginError || '');
    [server, user, pass].forEach(function (i) { i.classList.add('f'); i.onSubmit = function () { Nav.move('down'); }; });
    var btn = V.focusable(h('div', { class: 'btn primary', text: 'Accedi' }), function () {
      var p = X.parseServerInput(server.value);
      var acc = { server: p.server, username: (user.value || '').trim() || p.username || '', password: pass.value || p.password || '' };
      if (!acc.server || !acc.username) { err.textContent = 'Inserisci server e nome utente, oppure il link M3U completo.'; return; }
      err.textContent = 'Accesso in corso…';
      new X.Client(acc).authenticate().then(function () {
        S.set('server', acc.server); S.set('username', acc.username); S.set('password', acc.password);
        A.loginError = null;
        openAccount(acc, false);
      }).catch(function (e) { err.textContent = e.message || 'Accesso non riuscito.'; });
    });
    pass.onSubmit = function () { btn.onActivate(); };
    root.appendChild(h('div', { class: 'login' }, h('div', { class: 'login-box' }, [
      h('div', { class: 'brand' }, [h('img', { src: 'img/largeIcon.png', alt: '' }), h('div', null, [h('h1', { text: 'IPTVISION' }), h('div', { class: 'muted', text: 'Accedi al tuo account Xtream Codes' })])]),
      h('label', { class: 'field' }, [h('span', { text: 'Server o link M3U' }), server]),
      h('label', { class: 'field' }, [h('span', { text: 'Nome utente' }), user]),
      h('label', { class: 'field' }, [h('span', { text: 'Password' }), pass]),
      err, btn,
      h('div', { class: 'dim', style: 'margin-top:1rem;font-size:0.85rem', text: 'Se incolli il link M3U completo, nome utente e password si compilano da soli. IPTVISION è solo un lettore e non contiene canali.' }),
    ])));
  }

  function renderHome() {
    var rail = h('div', { class: 'rail' }, [h('div', { class: 'brand' }, [h('img', { src: 'img/largeIcon.png', alt: '' }), h('h1', { text: 'IPTVISION' })])]);
    var activeItem = null;
    SECTIONS.forEach(function (s) {
      var el = V.focusable(h('div', { class: 'nav-item' + (A.section === s.id ? ' active' : ''), data: { key: 'nav-' + s.id } }, s.icon + '  ' + s.title), function () {
        // OK sulla voce di menu: si entra nel contenuto.
        Nav.move('right');
      }, function () {
        // Col telecomando basta spostarsi sulla voce per aprire la sezione.
        if (A.section !== s.id) { A.section = s.id; render(false, root.querySelector('[data-key="nav-' + s.id + '"]')); }
      });
      if (A.section === s.id) activeItem = el;
      rail.appendChild(el);
    });
    rail.appendChild(h('div', { class: 'clock' }, [h('b', { text: u.clock(Date.now() / 1000) }), h('span', { text: u.today() })]));
    var content = h('div', { class: 'content' });
    root.appendChild(h('div', { class: 'home' }, [rail, content]));
    if (!focusAfterRender) focusAfterRender = activeItem;

    if (A.section === 'Search') {
      renderSearch(content);
      // Dal menu, ▶ porta alla casella di ricerca e non ai filtri sotto.
      Array.prototype.forEach.call(rail.querySelectorAll('.nav-item'), function (el) {
        el.nav = { right: function () { return content.querySelector('[data-key="search-input"]'); } };
      });
      return;
    }
    if (A.section === 'Settings') return renderSettings(content);
    if (A.section === 'Movies') ensure('movies');
    if (A.section === 'Series') ensure('series');
    renderLibrary(content, A.section);
  }

  function renderLibrary(content, section) {
    var lib = section === 'Live' ? A.live : section === 'Movies' ? A.movies : A.series;
    var title = section === 'Live' ? 'TV in diretta' : section === 'Movies' ? 'Film' : 'Serie TV';
    if (!lib) {
      content.appendChild(h('div', { class: 'empty', text: A.error && section === 'Live' ? A.error : 'Caricamento…' }));
      return;
    }
    var entries = catEntries(section);
    var open = A.openCat[section];
    var entry = null;
    entries.forEach(function (e) { if (e.id === open) entry = e; });

    if (!entry) {
      // Prima si sceglie la categoria.
      content.appendChild(h('div', { class: 'page-title', text: title }));
      content.appendChild(h('div', { class: 'page-sub', text: entries.length === 1 ? '1 categoria' : entries.length + ' categorie' }));
      var tiles = h('div', { class: 'tiles' });
      var scroll = h('div', { class: 'scroll' }, tiles);
      content.appendChild(scroll);
      entries.forEach(function (c) {
        var el = V.categoryTile(c, function () { A.openCat[section] = c.id; A.lastCat[section] = c.id; render(); });
        el.dataset.key = 'cat-' + c.id;
        tiles.appendChild(el);
        if (focusAfterRender && focusAfterRender.dataset && focusAfterRender.dataset.key === 'nav-' + section) return;
        if (A.lastCat[section] === c.id && !focusAfterRender) focusAfterRender = el;
      });
      return;
    }

    // Poi l'elenco della categoria, con ordinamento ed elenco/griglia.
    var grid = S.isGrid(section);
    var items = section === 'Live' ? channelsFor(open) : section === 'Movies' ? moviesFor(open) : seriesFor(open);
    var unit = section === 'Live' ? (items.length === 1 ? ' canale' : ' canali') : section === 'Movies' ? ' film' : ' serie';
    var backBtn = V.focusable(h('div', { class: 'back btn small', text: '←' }), function () { A.openCat[section] = null; render(); });
    var sortBtn = V.focusable(h('div', { class: 'btn small', data: { key: 'sort' }, text: '⇅  ' + SORTS[S.sortOf(section)] }), function () { showSort(section); });
    var listBtn = V.focusable(h('div', { class: 'toggle btn small' + (grid ? '' : ' on'), data: { key: 'view-list' }, text: '☰ Elenco' }), function () { S.setGrid(section, false); render(false, root.querySelector('[data-key="view-list"]')); });
    var gridBtn = V.focusable(h('div', { class: 'toggle btn small' + (grid ? ' on' : ''), data: { key: 'view-grid' }, text: '▦ Griglia' }), function () { S.setGrid(section, true); render(false, root.querySelector('[data-key="view-grid"]')); });
    content.appendChild(h('div', { class: 'header' }, [
      backBtn,
      h('div', { class: 'title' }, [h('b', { text: entry.name }), h('span', { text: items.length + unit })]),
      sortBtn, listBtn, gridBtn,
    ]));
    var box = h('div', { class: grid ? 'tiles' : 'list' });
    content.appendChild(h('div', { class: 'scroll' }, box));
    if (!items.length) {
      box.appendChild(h('div', { class: 'empty', text: open === FAV ? 'Nessun preferito. Premi il tasto rosso del telecomando su un canale per aggiungerlo.' : 'Nessun contenuto.' }));
      return;
    }

    var lazy, start = 0;
    if (section === 'Live') {
      var playingId = A.playing && A.playing.kind === 'live' ? A.playing.channel.streamId : S.get('lastStreamId');
      items.forEach(function (c, i) { if (c.streamId === playingId) start = i; });
      lazy = V.lazyList(box, items, function (ch) {
        var opts = {
          current: ch.streamId === playingId, favorite: S.isFavorite(ch.streamId), now: null,
          onOpen: function () { playChannel(ch, items); },
        };
        var el = (grid ? V.channelCard : V.channelRow)(ch, opts);
        el.dataset.key = 'ch-' + ch.streamId;
        el.channel = ch;
        var p = nowTitle(ch);
        if (p) el.setNow(p.title);
        var focusPrev = el.onFocus;
        el.onFocus = function () {
          if (focusPrev) focusPrev();
          nowTitle(ch, function (prog) { if (prog) el.setNow(prog.title); });
        };
        return el;
      });
    } else {
      lazy = V.lazyList(box, items, function (e) {
        var it = e.item;
        var progress = section === 'Movies' ? Math.max.apply(null, e.variants.map(function (v) { return Pos.progress(v.posKey); })) : 0;
        var opts = {
          versions: e.variants.length > 1 ? e.variants.length + ' versioni' : null, progress: progress,
          onOpen: function () { openEntry(e); },
        };
        var el = (grid ? V.mediaCard : V.mediaRow)(it, opts);
        el.dataset.key = (section === 'Movies' ? 'm-' + it.streamId : 's-' + it.seriesId);
        return el;
      });
    }
    var target = lazy.ensure(start);
    if (!focusAfterRender || (focusAfterRender.dataset && /^nav-/.test(focusAfterRender.dataset.key || ''))) focusAfterRender = target;
  }

  function renderSearch(content) {
    var input = h('input', { type: 'search', placeholder: 'Nome del canale, del film o della serie', value: A.search });
    input.classList.add('f');
    input.dataset.key = 'search-input';
    var results = h('div', { class: 'list' });
    var info = h('div', { class: 'page-sub' });
    var chips = h('div', { style: 'margin-bottom:0.6rem' });
    SCOPES.forEach(function (s) {
      chips.appendChild(V.focusable(h('div', { class: 'chip' + (A.scope === s[0] ? ' on' : ''), data: { key: 'scope-' + s[0] }, text: s[1] }), function () {
        A.scope = s[0];
        render(false, root.querySelector('[data-key="scope-' + s[0] + '"]'));
      }));
    });
    function run() {
      A.search = input.value;
      results.innerHTML = '';
      var tokens = u.normalize(A.search).split(' ').filter(function (t) { return t; });
      if (!tokens.length) { info.textContent = 'Canali, film e serie insieme. Premi OK sulla casella per scrivere o dettare.'; return; }
      if (A.scope !== 'Channels') { ensure('movies'); ensure('series'); }
      function ok(key) { return tokens.every(function (t) { return key.indexOf(t) >= 0; }); }
      var total = 0;
      function group(title, list, build) {
        if (!list.length) return;
        total += list.length;
        results.appendChild(h('div', { class: 'group-title', text: title + ' · ' + list.length }));
        list.forEach(function (x) { results.appendChild(build(x)); });
      }
      if ((A.scope === 'All' || A.scope === 'Channels') && A.live) {
        var chs = A.live.items.filter(function (c) { return ok(c.key); }).slice(0, 60);
        group('Canali', chs, function (c) { return V.channelRow(c, { onOpen: function () { playChannel(c, chs); }, favorite: S.isFavorite(c.streamId) }); });
      }
      if ((A.scope === 'All' || A.scope === 'Movies') && A.movies) {
        group('Film', u.groupVariants(A.movies.items.filter(function (m) { return ok(m.key); }), function (m) { return m.name; }).slice(0, 60), function (e) {
          return V.mediaRow(e.item, { versions: e.variants.length > 1 ? e.variants.length + ' versioni' : null, progress: Pos.progress(e.item.posKey), onOpen: function () { openEntry(e); } });
        });
      }
      if ((A.scope === 'All' || A.scope === 'Series') && A.series) {
        group('Serie TV', u.groupVariants(A.series.items.filter(function (s) { return ok(s.key); }), function (s) { return s.name; }).slice(0, 60), function (e) {
          return V.mediaRow(e.item, { versions: e.variants.length > 1 ? e.variants.length + ' versioni' : null, progress: 0, onOpen: function () { openEntry(e); } });
        });
      }
      var waiting = A.scope !== 'Channels' && (A.loading.movies || A.loading.series);
      info.textContent = (total === 1 ? '1 risultato' : total + ' risultati') + (waiting ? ' · carico anche film e serie…' : '');
      if (!total && !waiting) results.appendChild(h('div', { class: 'empty', text: 'Nessun risultato per "' + A.search + '".' }));
    }
    var timer = null;
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 300); });
    input.onSubmit = function () { run(); Nav.move('down'); };
    A.rerunSearch = run;
    content.appendChild(h('div', { class: 'page-title', text: 'Cerca' }));
    content.appendChild(info);
    content.appendChild(h('div', { class: 'search-row' }, input));
    content.appendChild(chips);
    content.appendChild(h('div', { class: 'scroll' }, results));
    run();
  }

  function settingRow(title, sub, on, toggle) {
    return V.focusable(h('div', { class: 'setting', data: { key: 'set-' + title } }, [
      h('div', { class: 'grow' }, [title, sub ? h('span', { text: sub }) : null]),
      h('div', { class: 'switch' + (on ? ' on' : '') }, h('i')),
    ]), function () { toggle(); render(false, root.querySelector('[data-key="set-' + title + '"]')); });
  }

  function renderSettings(content) {
    var box = h('div');
    content.appendChild(h('div', { class: 'page-title', text: 'Impostazioni' }));
    content.appendChild(h('div', { class: 'scroll' }, box));
    box.appendChild(h('div', { class: 'group-title', text: 'Account' }));
    box.appendChild(h('div', { class: 'info-line' }, [h('b', { text: 'Server' }), S.get('server') || '']));
    box.appendChild(h('div', { class: 'info-line' }, [h('b', { text: 'Utente' }), S.get('username') || '']));
    box.appendChild(h('div', { class: 'group-title', text: 'Riproduzione' }));
    box.appendChild(settingRow('Formato HLS (m3u8) per la TV in diretta', 'Di solito MPEG-TS è più stabile; prova HLS se un canale non parte.',
      S.get('outputFormat') === 'm3u8', function () { S.set('outputFormat', S.get('outputFormat') === 'm3u8' ? 'ts' : 'm3u8'); }));
    box.appendChild(settingRow('Riprendi l\'ultimo canale all\'avvio', 'Apri l\'app e il canale riparte da dov\'eri rimasto.',
      S.get('autoPlayLast'), function () { S.set('autoPlayLast', !S.get('autoPlayLast')); }));
    box.appendChild(h('div', { class: 'group-title', text: 'Dati' }));
    box.appendChild(V.focusable(h('div', { class: 'btn', text: '↻  Aggiorna liste' }), function () {
      A.epg = {};
      u.toast('Aggiorno le liste…');
      IPTV.Cache.clear().then(function () { openAccount(S.account(), false); });
    }));
    box.appendChild(h('div', { class: 'group-title', text: 'Versione' }));
    box.appendChild(h('div', { class: 'info-line' }, [h('b', { text: 'Installata' }), IPTV.VERSION]));
    if (A.update) {
      box.appendChild(h('div', { class: 'info-line', style: 'color:var(--accent2)', text: 'Disponibile IPTVISION ' + A.update + '. Scarica il file .ipk dalle release su GitHub e installalo dal PC (vedi README).' }));
    }
    box.appendChild(h('div', { class: 'group-title', text: '' }));
    box.appendChild(V.focusable(h('div', { class: 'btn', text: 'Esci dall\'account' }), function () {
      Player.stop();
      S.clearAccount();
      IPTV.Cache.clear();
      A.client = null; A.live = A.movies = A.series = null; A.stack = []; A.openCat = {};
      A.screen = 'login';
      render();
    }));
    box.appendChild(h('div', { class: 'dim', style: 'margin-top:1rem;font-size:0.8rem', text: 'IPTVISION è solo un lettore e non contiene canali. Va usato con un servizio IPTV a cui si ha diritto di accedere.' }));
  }

  // ---------- Film, serie e versioni ----------

  function openEntry(e) {
    if (e.variants.length > 1) { showVariants(e); return; }
    openItem(e.item);
  }

  function openItem(it) {
    if (it.kind === 'movie') push('movie', { movie: it, info: null });
    else push('series', { series: it, info: null, season: null });
  }

  function renderMovie(d) {
    var m = d.movie;
    var resume = Pos.resumeMs(m.posKey);
    if (!d.info && !d.loading && A.client) {
      d.loading = true;
      A.client.vodInfo(m.streamId).then(function (info) { d.info = info || {}; if (A.screen === 'movie' && A.data === d) render(true); }).catch(function () { d.info = {}; });
    }
    var info = d.info || {};
    var play = V.focusable(h('div', { class: 'btn primary', data: { key: 'play' }, text: resume > 0 ? '▶  Riprendi da ' + u.formatTime(resume) : '▶  Guarda' }), function () { playMovie(m, false); });
    var buttons = [play];
    if (resume > 0) buttons.push(V.focusable(h('div', { class: 'btn', text: '↺  Dall\'inizio' }), function () { playMovie(m, true); }));
    root.appendChild(h('div', { class: 'detail' }, [
      h('div', { class: 'poster' }, u.art(m.poster, m.initials)),
      h('div', { class: 'grow' }, [
        h('h2', { text: m.name }),
        h('div', { class: 'muted', text: u.joinMeta(info.year || m.year, info.genre, info.duration, m.rating > 0 ? '★ ' + m.rating.toFixed(1) : null) }),
        h('div', { style: 'margin-top:1.4rem' }, buttons),
        info.plot ? h('div', { class: 'plot', text: info.plot }) : null,
        info.director ? h('div', { class: 'muted', text: 'Regia: ' + info.director }) : null,
        info.cast ? h('div', { class: 'muted', style: 'margin-top:0.3rem', text: 'Cast: ' + info.cast }) : null,
      ]),
    ]));
    if (!focusAfterRender) focusAfterRender = play;
  }

  /** L'episodio da cui riprendere: l'ultimo aperto se non finito, altrimenti il successivo. */
  function resumeEpisode(s, eps) {
    if (!eps.length) return null;
    var last = Pos.lastEpisode(s.seriesId);
    if (!last) return eps[0];
    for (var i = 0; i < eps.length; i++) {
      if (eps[i].id === last.id) return Pos.isWatched(eps[i].posKey) ? eps[i + 1] || eps[i] : eps[i];
    }
    return eps[0];
  }

  function renderSeries(d) {
    var s = d.series;
    if (!d.info && !d.loading && A.client) {
      d.loading = true;
      A.client.seriesInfo(s.seriesId).then(function (info) { d.info = info; if (A.screen === 'series' && A.data === d) render(); })
        .catch(function (e) { d.info = { episodes: [] }; u.toast(e.message || 'Impossibile caricare gli episodi.'); if (A.data === d) render(); });
    }
    var info = d.info;
    var eps = info ? info.episodes : [];
    var seasons = [];
    eps.forEach(function (e) { if (seasons.indexOf(e.season) < 0) seasons.push(e.season); });
    var resume = resumeEpisode(s, eps);
    if (d.season === null && resume) d.season = resume.season;
    var box = h('div', { class: 'list' });
    var head = h('div', { class: 'row', style: 'margin-bottom:1rem' }, [
      h('div', { class: 'poster', style: 'width:10rem;height:15rem;margin-right:1.6rem;border-radius:0.8rem;overflow:hidden;position:relative;background:var(--surface-hover)' }, u.art(s.cover, s.initials)),
      h('div', { class: 'grow' }, [
        h('h2', { text: s.name }),
        h('div', { class: 'muted', text: u.joinMeta((info && info.year) || s.year, (info && info.genre) || s.genre, seasons.length ? seasons.length + ' stagioni' : null) }),
        h('div', { class: 'plot', text: (info && info.plot) || s.plot || '' }),
      ]),
    ]);
    var play = null;
    if (resume) {
      var r = Pos.resumeMs(resume.posKey);
      play = V.focusable(h('div', { class: 'btn primary', data: { key: 'play' }, text: '▶  ' + (r > 0 ? 'Riprendi S' + resume.season + ' E' + resume.number + ' da ' + u.formatTime(r) : 'Guarda S' + resume.season + ' E' + resume.number) }),
        function () { playEpisode(s, resume, eps, false); });
      head.lastChild.appendChild(play);
    }
    var chips = h('div', { class: 'seasons' });
    seasons.forEach(function (n) {
      chips.appendChild(V.focusable(h('div', { class: 'chip' + (n === d.season ? ' on' : ''), data: { key: 'season-' + n }, text: 'Stagione ' + n }), function () {
        d.season = n;
        render(false, root.querySelector('[data-key="season-' + n + '"]'));
      }));
    });
    eps.filter(function (e) { return e.season === d.season; }).forEach(function (e) {
      var p = Pos.progress(e.posKey);
      box.appendChild(V.focusable(h('div', { class: 'item flat' + (resume && e.id === resume.id ? ' current' : ''), data: { key: 'ep-' + e.id } }, [
        h('div', { class: 'thumb', style: 'width:9rem;height:5rem' }, u.art(e.image || s.cover, 'S' + e.season + ' E' + e.number)),
        h('div', { class: 'grow' }, [
          h('div', { class: 's', text: 'S' + e.season + ' E' + e.number + (e.duration ? '  ·  ' + e.duration : '') + (p >= 1 ? '  ·  ✓ visto' : '') }),
          h('div', { class: 't ellipsis', text: e.title }),
          e.plot ? h('div', { class: 's ellipsis', text: e.plot }) : null,
          p > 0 && p < 1 ? h('div', { style: 'width:12rem' }, u.progressBar(p)) : null,
        ]),
      ]), function () { playEpisode(s, e, eps, false); }));
    });
    root.appendChild(h('div', { class: 'detail', style: 'display:block' }, h('div', { class: 'scroll', style: 'height:100%' }, [
      head, info ? chips : h('div', { class: 'muted', text: 'Caricamento episodi…' }), box,
    ])));
    if (!focusAfterRender) focusAfterRender = play;
  }

  // ---------- Finestre ----------

  function openModal(el, preferred) {
    modal.innerHTML = '';
    modal.appendChild(el);
    modal.classList.add('open');
    Nav.setScope(modal, preferred);
  }

  function closeModal() {
    modal.classList.remove('open');
    modal.innerHTML = '';
    if (A.screen === 'player') Nav.setScope(pui); else Nav.setScope(root, A.modalReturn);
  }

  function showSort(section) {
    A.modalReturn = Nav.current();
    var current = S.sortOf(section);
    var box = h('div', { class: 'dialog' }, [h('h3', { text: 'Ordina per' }), h('div', { class: 'sub', text: '' })]);
    var pref = null;
    SORT_OPTIONS[section].forEach(function (k) {
      var el = V.focusable(h('div', { class: 'opt' + (k === current ? ' on' : '') }, (k === current ? '✓  ' : '     ') + SORTS[k]), function () {
        S.setSort(section, k);
        closeModal();
        render(false, root.querySelector('[data-key="sort"]'));
      });
      if (k === current) pref = el;
      box.appendChild(el);
    });
    openModal(box, pref);
  }

  /** Titolo pubblicato più volte (per esempio in FHD e in 4K): si sceglie quale versione aprire. */
  function showVariants(e) {
    A.modalReturn = Nav.current();
    var box = h('div', { class: 'dialog' }, [h('h3', { text: 'Scegli la versione' }), h('div', { class: 'sub ellipsis', text: e.item.name })]);
    var list = h('div', { class: 'scroll', style: 'max-height:32rem' });
    e.variants.forEach(function (v, i) {
      var p = v.posKey ? Pos.progress(v.posKey) : 0;
      list.appendChild(V.focusable(h('div', { class: 'opt' }, [
        h('div', { class: 'thumb poster' }, u.art(v.poster || v.cover, v.initials)),
        h('div', { class: 'grow' }, [
          h('div', null, [h('span', { class: 'badge q', text: u.qualityOf(v.name) || 'Versione ' + (i + 1) }), p > 0 && p < 1 ? h('span', { class: 'badge', text: 'Iniziato' }) : null, p >= 1 ? h('span', { class: 'badge', text: 'Visto' }) : null]),
          h('div', { class: 't ellipsis', style: 'margin-top:0.3rem;font-weight:600', text: v.name }),
          h('div', { class: 'dim', text: v.meta }),
        ]),
      ]), function () { closeModal(); openItem(v); }));
    });
    box.appendChild(list);
    box.appendChild(h('div', { class: 'hint', text: 'OK per scegliere · Indietro per annullare' }));
    openModal(box);
  }

  // ---------- Riproduzione ----------

  var overlay = 'info'; // none | info | controls
  var overlayTimer = null;
  var panelOpen = false;
  var playerTick = null; // aggiorna orologio e avanzamento senza ridisegnare (vedi renderPlayer)
  var digits = '', digitsTimer = null;
  var countdownTimer = null, countdown = 0;

  function autoPlayLast() {
    var id = S.get('lastStreamId');
    if (!id || !A.live || A.playing) return;
    var ch = null;
    A.live.items.forEach(function (c) { if (c.streamId === id) ch = c; });
    if (!ch) return;
    var list = channelsFor(S.get('lastCategoryId') || ALL);
    playChannel(ch, list.indexOf(ch) >= 0 ? list : A.live.items);
  }

  function enterPlayer() {
    if (A.screen !== 'player') {
      A.stack.push({ screen: A.screen, data: A.data, focus: Nav.current() });
      A.screen = 'player';
    }
    document.body.classList.add('playing');
    showOverlay('info');
  }

  function playChannel(ch, playlist) {
    savePosition();
    cancelCountdown();
    A.playing = { kind: 'live', channel: ch, playlist: playlist || [ch] };
    S.set('lastStreamId', ch.streamId);
    if (A.openCat.Live) S.set('lastCategoryId', A.openCat.Live);
    Player.play(A.client.liveUrl(ch.streamId, S.get('outputFormat')), true, 0);
    nowTitle(ch, function () { renderPlayer(); });
    enterPlayer();
  }

  function zap(delta) {
    var p = A.playing;
    if (!p || p.kind !== 'live') return;
    var list = p.playlist, i = list.indexOf(p.channel);
    playChannel(list[((i < 0 ? 0 : i) + delta + list.length) % list.length], list);
  }

  function playMovie(m, fromStart) {
    savePosition();
    cancelCountdown();
    A.playing = { kind: 'movie', movie: m };
    Player.play(A.client.movieUrl(m.streamId, m.ext), false, fromStart ? 0 : Pos.resumeMs(m.posKey));
    enterPlayer();
  }

  function playEpisode(s, e, eps, fromStart) {
    savePosition();
    cancelCountdown();
    A.playing = { kind: 'episode', series: s, episode: e, episodes: eps };
    Pos.setLastEpisode(s.seriesId, e.id);
    Pos.save();
    Player.play(A.client.episodeUrl(e.id, e.ext), false, fromStart ? 0 : Pos.resumeMs(e.posKey));
    enterPlayer();
  }

  function episodeOffset(delta) {
    var p = A.playing;
    if (!p || p.kind !== 'episode') return null;
    return p.episodes[p.episodes.indexOf(p.episode) + delta] || null;
  }

  function savePosition() {
    var p = A.playing;
    if (p && p.kind !== 'live' && Player.active) {
      Pos.update(p.kind === 'movie' ? p.movie.posKey : p.episode.posKey, Player.position(), Player.duration());
    }
    Pos.save();
  }

  function leavePlayer() {
    savePosition();
    cancelCountdown();
    Player.stop();
    A.playing = null;
    panelOpen = false;
    document.body.classList.remove('playing');
    pui.innerHTML = '';
    var s = A.stack.pop();
    A.screen = s ? s.screen : 'home';
    A.data = s ? s.data : null;
    render(false, s && s.focus);
  }

  function cancelCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = null;
    countdown = 0;
  }

  Player.onEnded = function () {
    var p = A.playing;
    if (!p) return;
    if (p.kind === 'movie') { Pos.markWatched(p.movie.posKey); Pos.save(); leavePlayer(); return; }
    Pos.markWatched(p.episode.posKey);
    Pos.save();
    var next = episodeOffset(1);
    if (!next) { leavePlayer(); return; }
    // Alla fine di un episodio parte il successivo dopo 10 secondi, annullabile.
    countdown = 10;
    renderPlayer();
    countdownTimer = setInterval(function () {
      if (--countdown <= 0) { cancelCountdown(); playEpisode(p.series, next, p.episodes, true); return; }
      renderPlayer();
    }, 1000);
  };
  Player.onFailed = function () { u.toast('Impossibile riprodurre il contenuto.'); leavePlayer(); };
  Player.onState = function () { if (A.screen === 'player') renderPlayer(); };

  function showOverlay(mode) {
    overlay = mode;
    clearTimeout(overlayTimer);
    if (mode !== 'none' && !countdown) {
      overlayTimer = setTimeout(function () {
        if (Player.state === 'playing' && !panelOpen) { overlay = 'none'; renderPlayer(); }
      }, mode === 'info' ? 4500 : 7000);
    }
    renderPlayer();
  }

  function renderPlayer() {
    if (A.screen !== 'player' || !A.playing) return;
    var p = A.playing;
    var keep = Nav.current();
    var keepKey = keep && pui.contains(keep) ? keep.dataset.key : null;
    pui.innerHTML = '';
    playerTick = null;
    pui.className = overlay === 'none' ? 'overlay-hidden' : '';
    pui.appendChild(h('div', { class: 'shade-top' }));
    pui.appendChild(h('div', { class: 'shade-bottom' }));
    var res = Player.resolution();
    var clockEl = h('b', { text: u.clock(Date.now() / 1000) });
    pui.appendChild(h('div', { class: 'p-top' }, [
      h('span', { text: p.kind === 'live' ? 'TV in diretta' : p.kind === 'movie' ? 'Film' : p.series.name }),
      res ? h('span', { class: 'badge', style: 'margin-left:1rem', text: res }) : null,
      clockEl,
    ]));

    var bottom = h('div', { class: 'p-bottom' });
    if (p.kind === 'live') {
      var ch = p.channel;
      var e = A.epg[ch.streamId], now = null, next = null, t = Date.now() / 1000;
      if (e) e.list.forEach(function (x, i) { if (x.start <= t && x.stop > t) { now = x; next = e.list[i + 1] || null; } });
      var nowBar = now ? u.progressBar((t - now.start) / (now.stop - now.start)) : null;
      playerTick = function () {
        var t2 = Date.now() / 1000;
        if (now && t2 >= now.stop) { renderPlayer(); return; } // è iniziato il programma successivo
        clockEl.textContent = u.clock(t2);
        if (nowBar) setProgress(nowBar, (t2 - now.start) / (now.stop - now.start));
      };
      bottom.appendChild(h('div', { class: 'p-info' }, [
        h('div', { class: 'thumb' }, u.art(ch.logo, ch.initials)),
        h('div', { class: 'grow' }, [
          h('div', { class: 'p-title ellipsis' }, [h('span', { class: 'dot' }), ch.num > 0 ? ch.num + '  ' : '', ch.name, S.isFavorite(ch.streamId) ? '  ★' : '']),
          now ? h('div', { class: 'p-now ellipsis', text: u.clock(now.start) + ' – ' + u.clock(now.stop) + '  ' + now.title }) : null,
          now ? h('div', { style: 'width:30rem' }, nowBar) : null,
          next ? h('div', { class: 'p-next ellipsis', text: 'Dopo: ' + u.clock(next.start) + '  ' + next.title }) : null,
        ]),
      ]));
    } else {
      var title = p.kind === 'movie' ? p.movie.name : 'S' + p.episode.season + ' E' + p.episode.number + ' · ' + p.episode.title;
      var pos = Player.position(), dur = Player.duration();
      var posEl = h('span', { text: u.formatTime(pos) });
      var durEl = h('span', { text: dur > 0 ? u.formatTime(dur) : '--:--' });
      var bar = u.progressBar(dur > 0 ? pos / dur : 0);
      bottom.appendChild(h('div', { class: 'p-title ellipsis', text: title }));
      bottom.appendChild(h('div', { class: 'p-bar' }, [posEl, bar, durEl]));
      playerTick = function () {
        var p2 = Player.position(), d2 = Player.duration();
        clockEl.textContent = u.clock(Date.now() / 1000);
        posEl.textContent = u.formatTime(p2);
        durEl.textContent = d2 > 0 ? u.formatTime(d2) : '--:--';
        setProgress(bar, d2 > 0 ? p2 / d2 : 0);
      };
    }

    if (overlay === 'controls') {
      var btns = [];
      var b = function (key, text, fn) { btns.push(V.focusable(h('div', { class: 'btn', data: { key: key }, text: text }), function () { fn(); showOverlay('controls'); })); };
      if (p.kind === 'live') {
        b('prev', '▼ Canale', function () { zap(-1); });
        b('pause', Player.state === 'paused' ? '▶ Riprendi' : '❚❚ Pausa', Player.togglePause);
        b('next', '▲ Canale', function () { zap(1); });
        b('list', '☰ Canali', function () { openPanel(); });
        b('fav', S.isFavorite(p.channel.streamId) ? '★ Togli preferito' : '☆ Preferito', function () { S.toggleFavorite(p.channel.streamId); });
      } else {
        if (p.kind === 'episode' && episodeOffset(-1)) b('eprev', '⏮ Precedente', function () { var x = episodeOffset(-1); playEpisode(p.series, x, p.episodes, false); });
        b('rew', '⟲ 10 s', function () { Player.seekBy(-10000); });
        b('pause', Player.state === 'paused' ? '▶ Riprendi' : '❚❚ Pausa', Player.togglePause);
        b('ff', '10 s ⟳', function () { Player.seekBy(10000); });
        if (p.kind === 'episode' && episodeOffset(1)) b('enext', 'Successivo ⏭', function () { var x = episodeOffset(1); playEpisode(p.series, x, p.episodes, true); });
      }
      if (Player.audioTracks().length > 1) b('audio', '♪ Audio', showAudio);
      bottom.appendChild(h('div', { class: 'p-controls' }, btns));
    } else {
      bottom.appendChild(h('div', { class: 'p-hint', text: p.kind === 'live'
        ? '▲▼ / CH± canale  ·  ◀ elenco canali  ·  OK comandi  ·  0-9 numero  ·  tasto rosso preferito'
        : '◀▶ 10 s  ·  ▲▼ 1 min  ·  OK comandi  ·  Indietro per uscire' }));
    }
    pui.appendChild(bottom);

    if (Player.state === 'connecting' || Player.state === 'buffering' || Player.state === 'reconnecting') {
      pui.appendChild(h('div', { class: 'p-status', text: Player.state === 'reconnecting' ? 'Riconnessione… tentativo ' + Player.attempt : 'Caricamento…' }));
    }
    if (digits) pui.appendChild(h('div', { class: 'p-digits', text: digits }));
    if (panelOpen && p.kind === 'live') pui.appendChild(channelPanel());
    if (countdown && episodeOffset(1)) {
      var nx = episodeOffset(1);
      pui.appendChild(h('div', { class: 'p-next-card' }, [
        h('div', { class: 'muted', text: 'Prossimo episodio tra ' + countdown + ' s' }),
        h('div', { style: 'font-size:1.2rem;font-weight:600;margin:0.3rem 0 0.8rem', text: 'S' + nx.season + ' E' + nx.number + ' · ' + nx.title }),
        V.focusable(h('div', { class: 'btn primary', data: { key: 'now' }, text: '▶ Riproduci ora' }), function () { cancelCountdown(); playEpisode(p.series, nx, p.episodes, true); }),
        V.focusable(h('div', { class: 'btn', data: { key: 'cancel' }, text: 'Annulla' }), function () { cancelCountdown(); leavePlayer(); }),
      ]));
    }

    if (modal.classList.contains('open')) return;
    var interactive = overlay === 'controls' || panelOpen || countdown;
    if (interactive) {
      var target = keepKey ? pui.querySelector('[data-key="' + keepKey + '"]') : null;
      if (!target && panelOpen) target = pui.querySelector('.p-panel .current');
      if (!target) target = pui.querySelector('[data-key="pause"]') || pui.querySelector('[data-key="now"]');
      Nav.setScope(panelOpen ? pui.querySelector('.p-panel') : pui, target);
    }
  }

  function channelPanel() {
    var p = A.playing;
    var list = h('div', { class: 'list' });
    var panel = h('div', { class: 'p-panel' }, [h('h3', { text: 'Canali' }), h('div', { class: 'scroll' }, list)]);
    var idx = Math.max(0, p.playlist.indexOf(p.channel));
    var lazy = V.lazyList(list, p.playlist, function (ch) {
      var el = V.channelRow(ch, {
        current: ch === p.channel, favorite: S.isFavorite(ch.streamId),
        onOpen: function () { panelOpen = false; playChannel(ch, p.playlist); },
      });
      el.dataset.key = 'pch-' + ch.streamId;
      if (ch === p.channel) el.classList.add('current');
      var cached = nowTitle(ch);
      if (cached) el.setNow(cached.title);
      return el;
    });
    lazy.ensure(idx);
    return panel;
  }

  function openPanel() {
    panelOpen = true;
    clearTimeout(overlayTimer);
    overlay = 'info';
    renderPlayer();
  }

  function showAudio() {
    var box = h('div', { class: 'dialog' }, [h('h3', { text: 'Audio' })]);
    Player.audioTracks().forEach(function (t) {
      box.appendChild(V.focusable(h('div', { class: 'opt' + (t.on ? ' on' : '') }, (t.on ? '✓  ' : '     ') + t.label), function () { Player.selectAudio(t.index); closeModal(); }));
    });
    openModal(box);
  }

  function playerKey(e) {
    var code = e.keyCode;
    var p = A.playing;
    var live = p && p.kind === 'live';
    if (Nav.isBack(code)) {
      if (panelOpen) { panelOpen = false; showOverlay('info'); }
      else if (overlay === 'controls') showOverlay('none');
      else leavePlayer();
      return true;
    }
    // Pannello canali, comandi o conto alla rovescia: le frecce si muovono tra i pulsanti.
    if (panelOpen || overlay === 'controls' || countdown) {
      if (code === KEY.CH_UP && live) { zap(1); return true; }
      if (code === KEY.CH_DOWN && live) { zap(-1); return true; }
      if (Nav.handleDefault(e)) { if (overlay === 'controls') showOverlay('controls'); return true; }
      return false;
    }
    switch (code) {
      case KEY.UP: case KEY.CH_UP:
        if (live) zap(1); else if (code === KEY.UP) { Player.seekBy(60000); showOverlay('info'); } else nextEpisode();
        return true;
      case KEY.DOWN: case KEY.CH_DOWN:
        if (live) zap(-1); else if (code === KEY.DOWN) { Player.seekBy(-60000); showOverlay('info'); } else prevEpisode();
        return true;
      case KEY.LEFT:
        if (live) openPanel(); else { Player.seekBy(-10000); showOverlay('info'); }
        return true;
      case KEY.RIGHT:
        if (live) showOverlay('info'); else { Player.seekBy(10000); showOverlay('info'); }
        return true;
      case KEY.FF: Player.seekBy(30000); showOverlay('info'); return true;
      case KEY.REW: Player.seekBy(-30000); showOverlay('info'); return true;
      case KEY.OK: showOverlay('controls'); return true;
      case KEY.PLAY: case KEY.PAUSE: case KEY.PLAY_PAUSE: case 32: Player.togglePause(); showOverlay('info'); return true;
      case KEY.STOP: leavePlayer(); return true;
      case KEY.INFO: showOverlay(overlay === 'none' ? 'info' : 'none'); return true;
      case KEY.RED:
        if (live) { S.toggleFavorite(p.channel.streamId); u.toast(S.isFavorite(p.channel.streamId) ? 'Aggiunto ai preferiti' : 'Tolto dai preferiti'); showOverlay('info'); }
        return true;
    }
    var d = code >= 48 && code <= 57 ? code - 48 : code >= 96 && code <= 105 ? code - 96 : -1;
    if (d >= 0 && live) {
      if (digits.length < 5) digits += d;
      clearTimeout(digitsTimer);
      digitsTimer = setTimeout(function () {
        var n = parseInt(digits, 10), found = null;
        A.live.items.forEach(function (c) { if (c.num === n && !found) found = c; });
        digits = '';
        if (found) playChannel(found, p.playlist); else { u.toast('Canale ' + n + ' non trovato'); renderPlayer(); }
      }, 1500);
      renderPlayer();
      return true;
    }
    return false;
  }

  function nextEpisode() { var p = A.playing, x = episodeOffset(1); if (x) playEpisode(p.series, x, p.episodes, true); }
  function prevEpisode() { var p = A.playing, x = episodeOffset(-1); if (x) playEpisode(p.series, x, p.episodes, false); }

  function setProgress(bar, f) { bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; }

  // Aggiorna avanzamento e orologio a schermo; salva le posizioni ogni 15 secondi.
  // Si cambiano solo i testi: ridisegnare tutto ogni secondo appesantiva i TV mentre il video gira.
  var ticks = 0;
  setInterval(function () {
    if (A.screen === 'player' && overlay !== 'none' && playerTick) playerTick();
    if (++ticks % 15 === 0) savePosition();
  }, 1000);

  // ---------- Tasti ----------

  var lastBackAt = 0;

  document.addEventListener('keydown', function (e) {
    var code = e.keyCode;
    var typing = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (typing && code === KEY.BACKSPACE) return; // cancella il testo, non torna indietro
    var handled = false;
    if (A.screen === 'player' && !modal.classList.contains('open')) handled = playerKey(e);
    else if (Nav.isBack(code)) {
      handled = back();
      if (!handled && (A.screen === 'home' || A.screen === 'login')) {
        // Per uscire serve un secondo Indietro: un tasto premuto per sbaglio non chiude l'app.
        if (Date.now() - lastBackAt < 2500) window.close();
        else { lastBackAt = Date.now(); u.toast('Premi di nuovo Indietro per uscire'); }
        handled = true;
      }
    } else if (code === KEY.RED) {
      // Tasto rosso su un canale: preferito.
      var cur = Nav.current();
      if (cur && cur.channel) {
        S.toggleFavorite(cur.channel.streamId);
        u.toast(S.isFavorite(cur.channel.streamId) ? cur.channel.name + ' aggiunto ai preferiti' : cur.channel.name + ' tolto dai preferiti');
        render(true);
        handled = true;
      }
    } else handled = Nav.handleDefault(e);
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // Il TV mette l'app in secondo piano (tasto Home, altra app): si salva e si mette in pausa.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      savePosition();
      if (Player.active && Player.state !== 'paused') { Player.togglePause(); A.resumeOnShow = true; }
    } else if (A.resumeOnShow) {
      A.resumeOnShow = false;
      if (Player.active) Player.togglePause();
    }
  });

  // ---------- Aggiornamenti ----------

  function isNewer(a, b) {
    var x = String(a).replace(/^v/i, '').split('.'), y = String(b).split('.');
    for (var i = 0; i < 3; i++) {
      var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
      if (d) return d > 0;
    }
    return false;
  }

  /** Avvisa se su GitHub c'è una versione più recente: sul TV si aggiorna reinstallando il .ipk dal PC. */
  function checkUpdates() {
    u.fetchTimeout('https://api.github.com/repos/carellice/IPTVISION/releases/latest', 15000).then(function (r) { return r.json(); }).then(function (rel) {
      if (!rel || rel.draft || rel.prerelease || !isNewer(rel.tag_name, IPTV.VERSION)) return;
      var hasIpk = (rel.assets || []).some(function (a) { return /\.ipk$/i.test(a.name); });
      if (!hasIpk) return;
      A.update = String(rel.tag_name).replace(/^v/i, '');
      u.toast('Disponibile IPTVISION ' + A.update + ': dettagli in Impostazioni');
    }).catch(function () { /* senza rete o GitHub non raggiungibile: si riprova al prossimo avvio */ });
  }

  // ---------- Avvio ----------

  var account = S.account();
  if (account) openAccount(account, S.get('autoPlayLast'));
  else render();
  if (S.get('autoCheckUpdates')) setTimeout(checkUpdates, 8000);
})();
