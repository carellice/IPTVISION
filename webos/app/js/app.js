/* IPTVISION per TV LG (webOS) e Samsung (Tizen): stato dell'app, schermate e telecomando. */
(function () {
  'use strict';
  var u = IPTV.u, h = u.h, V = IPTV.V, Nav = IPTV.Nav, KEY = Nav.KEY;
  var S = IPTV.Settings, Pos = IPTV.Positions, Player = IPTV.Player, X = IPTV.Xtream, Server = IPTV.Server;

  var ALL = '__all', FAV = '__fav', CONT = '__continue', MINE = '__mylist';
  var SECTIONS = [
    { id: 'Live', title: 'TV in diretta', icon: '📺' },
    { id: 'Movies', title: 'Film', icon: '🎬' },
    { id: 'Series', title: 'Serie TV', icon: '🎞' },
    { id: 'Discover', title: 'Film e serie', icon: '🎬' },
    { id: 'MyList', title: 'La mia lista', icon: '🔖' },
    { id: 'Search', title: 'Cerca', icon: '🔍' },
    { id: 'Settings', title: 'Impostazioni', icon: '⚙' },
  ];
  /** Le sezioni del menu: con la chiave TMDB film e serie sono una sola, "Film e serie". */
  function sections() {
    var tmdb = !!tmdbKey();
    return SECTIONS.filter(function (s) { return tmdb ? s.id !== 'Movies' && s.id !== 'Series' : s.id !== 'Discover' && s.id !== 'MyList'; });
  }
  /** La chiave messa a mano, altrimenti quella integrata nel pacchetto (js/tmdbkey.js, creato dalla release). */
  function tmdbKey() { return S.get('tmdbKey') || IPTV.TMDB_KEY || ''; }
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
    // "Nascondi XXX": via le categorie con XXX nel nome e tutto il loro contenuto, anche da Tutti e dalla ricerca.
    var hidden = {};
    if (S.get('hideAdult')) cats.forEach(function (c) { if (/xxx/i.test(c.name)) hidden[c.id] = true; });
    var visible = items.filter(function (it) { return !hidden[it.categoryId]; });
    var by = {};
    visible.forEach(function (it) { (by[it.categoryId] = by[it.categoryId] || []).push(it); });
    return { cats: cats.filter(function (c) { return by[c.id]; }), items: visible, by: by, raw: { cats: cats, items: items } };
  }

  /** Canali in diretta raggruppati per qualità; quelli del provider restano in A.liveItems per poterli rifare. */
  function liveLibrary(cats, items) {
    A.liveItems = items;
    return library(cats, u.groupChannels(items, S.get('favorites'), S.get('singleChannelList')));
  }

  /** TV in diretta con l'elenco unico: sempre "Tutti", niente categorie a cui tornare. */
  function liveLocked(section) { return section === 'Live' && S.get('singleChannelList'); }

  /** Rifà le liste con il filtro attuale (dopo aver cambiato "Nascondi XXX"). */
  function reapplyHidden() {
    ['live', 'movies', 'series'].forEach(function (k) { if (A[k]) A[k] = library(A[k].raw.cats, A[k].raw.items); });
    A.openCat = {};
  }

  // Dopo quanto le liste salvate sul TV si riscaricano dal server ("Aggiorna liste" lo fa subito).
  var MAX_AGE = { live: 6 * 3600000, movies: 24 * 3600000, series: 24 * 3600000 };

  function cacheKey(kind) { var a = A.client.account; return kind + '|' + a.server + '|' + a.username; }

  /**
   * Categorie e contenuti di una sezione: la copia sul TV si mostra subito, anche se vecchia. Se è scaduta
   * (o con "Aggiorna liste", force) quella nuova arriva in sottofondo e passa a onFresh: si aspetta il
   * download solo la prima volta.
   */
  function loadList(kind, download, onFresh, force) {
    var client = A.client, key = cacheKey(kind);
    function fetchNew() {
      return download().then(function (r) {
        var v = { at: Date.now(), cats: r[0], items: r[1] };
        // Si salva qualche secondo dopo, quando l'elenco è già a schermo.
        setTimeout(function () { if (A.client === client) IPTV.Cache.put(key, v); }, 5000);
        return v;
      });
    }
    return IPTV.Cache.get(key).then(function (c) {
      if (!(c && c.items && c.items.length)) return fetchNew();
      if (force || Date.now() - c.at >= MAX_AGE[kind]) {
        A.updating = (A.updating || 0) + 1;
        badge();
        fetchNew().then(function (v) { if (A.client === client && onFresh) onFresh(v); }, function () { /* resta la copia salvata */ })
          .then(function () { A.updating--; badge(); });
      }
      return c;
    });
  }

  /** Dopo un aggiornamento: ridisegna la schermata (in Cerca solo i risultati, per non togliere la tastiera). */
  function repaint() {
    if (A.screen !== 'home') return;
    if (A.section === 'Search') { if (A.rerunSearch) A.rerunSearch(); }
    else render(true);
  }

  /** refresh: "Aggiorna liste", le liste restano a schermo e quelle nuove arrivano in sottofondo. */
  function openAccount(account, autoPlay, refresh) {
    A.client = new X.Client(account);
    // La scadenza della lista in uso, aggiornata a ogni apertura (non serve per partire).
    var active = S.activeList();
    if (active) {
      A.client.authenticate().then(function (ui) {
        var exp = expiryOf(ui);
        if (active.expiresAt !== exp) { active.expiresAt = exp; S.saveList(active); }
      }).catch(function () { /* la vedrà il caricamento delle liste */ });
    }
    A.loading = {};
    if (!refresh) {
      A.live = A.movies = A.series = null;
      A.screen = 'home';
      A.section = 'Live';
      render();
    }
    A.loading.live = !A.live;
    var client = A.client;
    loadList('live', function () { return Promise.all([client.categories('get_live_categories'), client.channels()]); }, function (v) {
      A.live = liveLibrary(v.cats, v.items);
      repaint();
    }, refresh).then(function (c) {
      if (A.client !== client) return;
      A.live = liveLibrary(c.cats, c.items);
      A.loading.live = false;
      if (A.screen === 'home') render(!!refresh);
      if (autoPlay) autoPlayLast();
      // Film e serie già sul TV: si leggono subito, così la sezione è pronta quando la apri.
      if (refresh) { if (A.movies) ensure('movies', true); if (A.series) ensure('series', true); return; }
      ['movies', 'series'].forEach(function (k) { IPTV.Cache.get(cacheKey(k)).then(function (x) { if (x && A.client === client) ensure(k); }); });
    }).catch(function (e) {
      A.loading.live = false;
      A.error = e.message || 'Impossibile caricare i canali.';
      if (A.screen === 'home') render();
    });
  }

  function ensure(kind, force) {
    if ((A[kind] && !force) || A.loading[kind] || !A.client) return;
    A.loading[kind] = !A[kind];
    badge();
    var cats = kind === 'movies' ? 'get_vod_categories' : 'get_series_categories';
    var client = A.client;
    var idOf = function (it) { return kind === 'movies' ? it.streamId : it.seriesId; };
    loadList(kind, function () { return Promise.all([client.categories(cats), kind === 'movies' ? client.movies() : client.series()]); }, function (v) {
      // Solo le novità si annunciano: la lista a schermo diventa quella nuova senza ricominciare da capo.
      var old = {};
      (A[kind] ? A[kind].raw.items : []).forEach(function (it) { old[idOf(it)] = true; });
      var n = v.items.filter(function (it) { return !old[idOf(it)]; }).length;
      A[kind] = library(v.cats, v.items);
      if (n) u.toast(kind === 'movies' ? (n === 1 ? '1 film nuovo' : n + ' film nuovi') : (n === 1 ? '1 serie nuova' : n + ' serie nuove'));
      repaint();
    }, force).then(function (c) {
      if (A.client !== client) return;
      if (!A[kind] || !force) A[kind] = library(c.cats, c.items);
      A.loading[kind] = false;
      badge();
      repaint();
    }).catch(function (e) {
      A.loading[kind] = false;
      badge();
      u.toast(e.message || 'Impossibile caricare il catalogo.');
    });
  }

  /** Cosa si sta caricando, in alto a destra in "Film e serie" e "La mia lista". */
  function badge() {
    var el = document.getElementById('loadbadge');
    if (!el) { el = h('div', { id: 'loadbadge' }); document.body.appendChild(el); }
    var here = A.screen === 'home' && (A.section === 'Discover' || A.section === 'MyList');
    var t = !here ? null
      : A.loading.movies && !A.movies ? 'Carico i film…'
        : A.loading.series && !A.series ? 'Carico le serie…'
          : A.updating > 0 ? 'Cerco titoli nuovi…'
            : A.tmdbLoading && A.section === 'Discover' ? 'Preparo le tendenze…' : null;
    el.className = t ? 'on' : '';
    el.textContent = t || '';
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
        : cat === MINE ? inListOrder(l.items, function (m) { return m.posKey; })
          : l.by[cat] || [];
    return u.groupVariants(sorted('Movies', list), function (m) { return m.name; });
  }

  function seriesFor(cat) {
    var l = A.series;
    if (!l) return [];
    var list = cat === ALL ? l.items
      : cat === CONT ? l.items.filter(function (s) { return Pos.lastEpisode(s.seriesId); }).sort(function (a, b) { return Pos.lastEpisode(b.seriesId).u - Pos.lastEpisode(a.seriesId).u; })
        : cat === MINE ? inListOrder(l.items, listKey)
          : l.by[cat] || [];
    return u.groupVariants(sorted('Series', list), function (s) { return s.name; });
  }

  // ---------- La mia lista ----------

  function listKey(it) { return it.kind === 'movie' ? it.posKey : 's:' + it.seriesId; }

  function inListOrder(items, key) {
    return items.filter(function (it) { return Pos.inMyList(key(it)); })
      .sort(function (a, b) { return Pos.myListAddedAt(key(b)) - Pos.myListAddedAt(key(a)); });
  }

  /** Le chiavi di tutte le versioni dello stesso titolo: in lista ne basta una. */
  function myListKeys(it) {
    var l = it.kind === 'movie' ? A.movies : A.series;
    var keys = [listKey(it)];
    (l ? l.items : []).forEach(function (x) { if (x.name === it.name && keys.indexOf(listKey(x)) < 0) keys.push(listKey(x)); });
    return keys;
  }

  function inMyList(it) { return myListKeys(it).some(Pos.inMyList); }

  function toggleMyList(it) {
    var on = !inMyList(it);
    if (on) Pos.setMyList(listKey(it), true); else myListKeys(it).forEach(function (k) { Pos.setMyList(k, false); });
    Pos.save();
    u.toast(on ? it.name + ' aggiunto alla mia lista' : it.name + ' tolto dalla mia lista');
  }

  /** Finito un film, o l'ultimo episodio di una serie, il titolo esce dalla "Mia lista". */
  function leaveMyListIfFinished(p) {
    if (p.kind === 'movie') myListKeys(p.movie).forEach(function (k) { Pos.setMyList(k, false); });
    else if (p.kind === 'episode' && p.episode === p.episodes[p.episodes.length - 1]) myListKeys(p.series).forEach(function (k) { Pos.setMyList(k, false); });
  }

  function myListButton(it) {
    return V.focusable(h('div', { class: 'btn', text: inMyList(it) ? '✓  Nella mia lista' : '+  La mia lista' }), function () {
      toggleMyList(it);
      render(true);
    });
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
      var mine = section === 'Movies' ? moviesFor(MINE).length : seriesFor(MINE).length;
      if (mine) out.push({ id: MINE, name: 'La mia lista', count: mine });
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
    // "Film e serie" e "La mia lista": Indietro riapre il menu a sinistra; un altro Indietro torna alla TV in diretta.
    if (A.screen === 'home' && (A.section === 'Discover' || A.section === 'MyList')) {
      var cur = Nav.current();
      if (!(cur && cur.classList.contains('nav-item'))) { Nav.focus(root.querySelector('.rail .nav-item.active')); return true; }
    }
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
    else if (A.screen === 'server') renderServer(A.data || {});
    else if (A.screen === 'home') renderHome();
    else if (A.screen === 'movie') renderMovie(A.data);
    else if (A.screen === 'series') renderSeries(A.data);
    var target = focusAfterRender;
    if (!target && prevKey) target = root.querySelector('[data-key="' + prevKey + '"]');
    if (target && !document.body.contains(target)) target = target.dataset && target.dataset.key ? root.querySelector('[data-key="' + target.dataset.key + '"]') : null;
    if (A.screen !== 'player') Nav.setScope(root, target);
    badge();
  }

  function expiryOf(ui) {
    var n = parseInt(ui && ui.exp_date, 10);
    return n > 0 ? n : null;
  }

  function expiryText(l) {
    if (!l.expiresAt) return 'nessuna scadenza';
    var d = new Date(l.expiresAt * 1000);
    return 'scade il ' + ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
  }

  /** Passa a un'altra lista salvata: liste, guida e lettore ripartono da quell'account. */
  function useList(l) {
    if (Server.active()) {
      Server.useList(l.index).then(function (state) { Server.apply(state); reloadFromServer(); }, function (e) { u.toast(e.message); });
      return;
    }
    Player.stop();
    S.set('server', l.server); S.set('username', l.username); S.set('password', l.password);
    S.set('lastStreamId', null); S.set('lastCategoryId', null);
    A.loginError = null;
    A.stack = []; A.openCat = {}; A.epg = {};
    openAccount(S.account(), false);
  }

  /** Col server di casa: liste e guida ripartono da zero, il gettone del server resta. */
  function reloadFromServer() {
    Player.stop();
    S.set('lastStreamId', null); S.set('lastCategoryId', null);
    IPTV.Cache.clear();
    A.loginError = null;
    A.stack = []; A.openCat = {}; A.epg = {}; A.serverLists = null;
    openAccount(S.account(), false);
  }

  function renderLogin() {
    // Aperta dalle Impostazioni per aggiungere una lista: campi vuoti e si può tornare indietro.
    var adding = !!(A.data && A.data.adding);
    var server = h('input', { type: 'url', placeholder: 'http://server:porta oppure il link get.php completo', value: adding ? '' : S.get('server') || '' });
    var user = h('input', { type: 'text', value: adding ? '' : S.get('username') || '' });
    var pass = h('input', { type: 'password' });
    var alias = h('input', { type: 'text', placeholder: 'Per esempio: Casa, Sport…' });
    var err = h('div', { class: 'error' }, A.loginError || '');
    var saved = adding || S.get('homeServer') ? [] : S.lists().map(function (l) {
      return V.focusable(h('div', { class: 'btn', style: 'margin-bottom:0.4rem', text: l.alias + '  ·  ' + expiryText(l) }), function () { useList(l); });
    });
    [alias, server, user, pass].forEach(function (i) { i.classList.add('f'); i.onSubmit = function () { Nav.move('down'); }; });
    var btn = V.focusable(h('div', { class: 'btn primary', text: 'Accedi' }), function () {
      var p = X.parseServerInput(server.value);
      var acc = { server: p.server, username: (user.value || '').trim() || p.username || '', password: pass.value || p.password || '' };
      if (!acc.server || !acc.username) { err.textContent = 'Inserisci server e nome utente, oppure il link M3U completo.'; return; }
      err.textContent = 'Accesso in corso…';
      if (Server.active()) {
        // Col server di casa la lista nuova va sul server, che la usa per tutti i dispositivi.
        acc.alias = (alias.value || '').trim();
        Server.sendXtream(Server.url(), S.get('password'), acc).then(reloadFromServer, function (e) { err.textContent = e.message; });
        return;
      }
      new X.Client(acc).authenticate().then(function (ui) {
        S.saveList({ alias: (alias.value || '').trim(), server: acc.server, username: acc.username, password: acc.password, expiresAt: expiryOf(ui) });
        S.set('server', acc.server); S.set('username', acc.username); S.set('password', acc.password);
        A.loginError = null;
        A.stack = [];
        openAccount(acc, false);
      }).catch(function (e) { err.textContent = e.message || 'Accesso non riuscito.'; });
    });
    pass.onSubmit = function () { btn.onActivate(); };
    root.appendChild(h('div', { class: 'login' }, h('div', { class: 'login-box' }, [
      h('div', { class: 'brand' }, [h('img', { src: 'img/largeIcon.png', alt: '' }), h('div', null, [h('h1', { text: 'IPTVISION' }), h('div', { class: 'muted', text: 'Accedi al tuo account Xtream Codes' })])]),
      saved.length ? h('div', { class: 'muted', style: 'margin-bottom:0.4rem', text: 'Liste salvate' }) : null,
      h('div', null, saved),
      saved.length ? h('div', { class: 'muted', style: 'margin:0.4rem 0', text: 'Oppure aggiungi una lista' }) : null,
      h('label', { class: 'field' }, [h('span', { text: 'Nome della lista (facoltativo)' }), alias]),
      h('label', { class: 'field' }, [h('span', { text: 'Server o link M3U' }), server]),
      h('label', { class: 'field' }, [h('span', { text: 'Nome utente' }), user]),
      h('label', { class: 'field' }, [h('span', { text: 'Password' }), pass]),
      err, btn,
      adding ? V.focusable(h('div', { class: 'btn', style: 'margin-top:0.6rem', text: 'Annulla' }), back)
        // Senza account IPTV sul TV: si può usare quello del server di casa.
        : V.focusable(h('div', { class: 'btn', style: 'margin-top:0.6rem', text: 'Usa il server di casa' }), function () { push('server', {}); }),
      h('div', { class: 'dim', style: 'margin-top:1rem;font-size:0.85rem', text: 'Se incolli il link M3U completo, nome utente e password si compilano da soli. IPTVISION è solo un lettore e non contiene canali.' }),
    ])));
  }

  /**
   * Server di casa: accede (o crea l'account), porta sul server l'account IPTV del TV se lì manca,
   * unisce preferiti e posizioni del TV a quelli del server, poi usa il server come server Xtream.
   * Se qualcosa va storto il TV resta com'era.
   */
  function renderServer(d) {
    var address = h('input', { type: 'url', placeholder: 'http://192.168.1.10:8765', value: d.address || S.get('homeServer') || '' });
    var user = h('input', { type: 'text', value: d.user || '' });
    var pass = h('input', { type: 'password' });
    var invite = h('input', { type: 'text', placeholder: 'se il server lo chiede' });
    var err = h('div', { class: 'error' }, '');
    [address, user, pass, invite].forEach(function (i) { i.classList.add('f'); i.onSubmit = function () { Nav.move('down'); }; });
    var mode = V.focusable(h('div', { class: 'btn', text: d.register ? 'Crea un nuovo account: sì' : 'Crea un nuovo account: no' }), function () {
      d.address = address.value; d.user = user.value; d.register = !d.register;
      render(false, root.querySelector('[data-key="srv-mode"]'));
    });
    mode.dataset.key = 'srv-mode';
    var busy = false;
    var btn = V.focusable(h('div', { class: 'btn primary', text: 'Collega il server' }), function () {
      if (busy) return;
      var url = Server.normalize(address.value);
      if (!url || !user.value.trim() || !pass.value) { err.textContent = 'Inserisci indirizzo del server, nome utente e password.'; return; }
      busy = true;
      err.textContent = 'Collegamento in corso…';
      var token = null;
      var own = Server.active() ? null : S.account();
      Server.login(url, user.value.trim(), pass.value, !!d.register, invite.value.trim()).then(function (login) {
        token = login.token;
        if (!login.hasXtream) {
          if (!own) throw new Error('Questo account non ha ancora un account IPTV: aggiungilo da IPTVISION nel browser, poi riprova.');
          return Server.sendXtream(url, token, own).then(function () { return login; });
        }
        return login;
      }).then(function (login) {
        var mine = Pos.toJson();
        mine.favorites = S.get('favorites');
        // Le liste salvate sul TV si aggiungono a quelle del server.
        if (own) mine.lists = S.lists();
        return Server.importNative(url, token, mine).then(function (state) { return [login, state]; });
      }).then(function (r) {
        var login = r[0], state = r[1];
        if (Server.active()) Server.logout(Server.url(), S.get('password'));
        else S.stashOwnAccount();
        Player.stop();
        Server.clearQueue();
        S.set('server', url); S.set('username', login.username); S.set('password', login.token);
        S.set('homeServer', url); S.set('lastStreamId', null); S.set('lastCategoryId', null);
        Server.apply(state);
        IPTV.Cache.clear();
        A.stack = []; A.openCat = {}; A.epg = {};
        u.toast('Server di casa collegato');
        openAccount(S.account(), false);
        Server.loadNetwork();
      }).catch(function (e) {
        busy = false;
        if (token && S.get('password') !== token) Server.logout(url, token);
        err.textContent = e.message || 'Collegamento non riuscito.';
      });
    });
    pass.onSubmit = function () { if (d.register) Nav.move('down'); else btn.onActivate(); };
    invite.onSubmit = function () { btn.onActivate(); };
    var fields = [
      h('label', { class: 'field' }, [h('span', { text: 'Indirizzo del server' }), address]),
      mode,
      h('label', { class: 'field' }, [h('span', { text: 'Nome utente' }), user]),
      h('label', { class: 'field' }, [h('span', { text: 'Password' }), pass]),
    ];
    if (d.register) fields.push(h('label', { class: 'field' }, [h('span', { text: 'Codice invito' }), invite]));
    root.appendChild(h('div', { class: 'login' }, h('div', { class: 'login-box' }, [
      h('div', { class: 'brand' }, [h('img', { src: 'img/largeIcon.png', alt: '' }), h('div', null, [h('h1', { text: 'Server di casa' }), h('div', { class: 'muted', text: 'IPTVISION sul tuo server CasaOS' })])]),
    ].concat(fields, [
      err, btn,
      h('div', { class: 'dim', style: 'margin-top:1rem;font-size:0.85rem', text: 'Canali, film e serie passano dal server; preferiti e Continua a guardare sono gli stessi su ogni dispositivo. Dentro casa basta l\'indirizzo IP del server con la porta: lo trovi in IPTVISION nel browser, in Impostazioni → Server di casa.' }),
    ]))));
  }

  /** Torna all'account IPTV di prima, direttamente dal provider. Preferiti e posizioni restano quelli di adesso. */
  function disconnectServer() {
    Server.logout(Server.url(), S.get('password'));
    Server.clearQueue();
    Player.stop();
    S.restoreOwnAccount();
    Server.net = null;
    IPTV.Cache.clear();
    A.client = null; A.live = A.movies = A.series = null; A.stack = []; A.openCat = {}; A.epg = {};
    var account = S.account();
    if (account) openAccount(account, false);
    else { A.screen = 'login'; render(); }
  }

  /** Stile Modern UI: il menu diventa il pivot in alto (vedi app.css, classe "metro"). */
  function metro() { return document.documentElement.classList.contains('metro'); }

  function renderHome() {
    // data-enter: entrando nel menu dal contenuto si torna sulla sezione aperta (vedi nav.js).
    var rail = h('div', { class: 'rail', 'data-enter': 'active' }, [h('div', { class: 'brand' }, [h('img', { src: 'img/largeIcon.png', alt: '' }), h('h1', { text: 'IPTVISION' })])]);
    var activeItem = null;
    sections().forEach(function (s) {
      var el = V.focusable(h('div', { class: 'nav-item' + (A.section === s.id ? ' active' : ''), data: { key: 'nav-' + s.id } }, [h('span', { class: 'ni', text: s.icon }), '  ', h('span', { class: 'nt', text: s.title })]), function () {
        // OK sulla voce di menu: si entra nel contenuto dal suo primo elemento, in cima (sotto il pivot nello stile Modern UI).
        var first = root.querySelector('.content .f');
        if (first) Nav.focus(first); else Nav.move(metro() ? 'down' : 'right');
      }, function () {
        // Col telecomando basta spostarsi sulla voce per aprire la sezione.
        if (A.section !== s.id) { A.section = s.id; A.discoverFrom = null; render(false, root.querySelector('[data-key="nav-' + s.id + '"]')); }
      });
      if (A.section === s.id) activeItem = el;
      rail.appendChild(el);
    });
    var net = h('span', { id: 'srv-net', class: 'net' });
    Server.paintNetwork(net);
    rail.appendChild(h('div', { class: 'clock' }, [h('b', { text: u.clock(Date.now() / 1000) }), h('span', { text: u.today() }), net]));
    var content = h('div', { class: 'content' });
    root.appendChild(h('div', { class: 'home' }, [rail, content]));

    if (A.section === 'Search') {
      renderSearch(content);
      // Dal menu, ▶ porta alla casella di ricerca e non ai filtri sotto.
      Array.prototype.forEach.call(rail.querySelectorAll('.nav-item'), function (el) {
        var toInput = function () { return content.querySelector('[data-key="search-input"]'); };
        el.nav = metro() ? { down: toInput } : { right: toInput };
      });
    } else if (A.section === 'Settings') renderSettings(content);
    else if (A.section === 'Discover') {
      ensure('movies'); ensure('series');
      var dopen = A.openCat.Discover;
      if (dopen) renderLibrary(content, dopen.charAt(0) === 'm' ? 'Movies' : 'Series', dopen.slice(2));
      else renderDiscover(content);
    } else if (A.section === 'MyList') {
      ensure('movies'); ensure('series');
      renderMyList(content);
    } else {
      if (A.section === 'Movies') ensure('movies');
      if (A.section === 'Series') ensure('series');
      renderLibrary(content, A.section);
    }
    // Il menu prende il focus solo se il contenuto non ne ha scelto uno: prima lo prendeva sempre, e
    // chiudendo una categoria si finiva sul menu invece che sulla categoria appena chiusa.
    if (!focusAfterRender) focusAfterRender = activeItem;
  }

  /** openId: la categoria aperta da "Film e serie" (si chiude tornando lì). */
  function renderLibrary(content, section, openId) {
    var lib = section === 'Live' ? A.live : section === 'Movies' ? A.movies : A.series;
    var title = section === 'Live' ? 'TV in diretta' : section === 'Movies' ? 'Film' : 'Serie TV';
    if (!lib) {
      content.appendChild(h('div', { class: 'empty', text: A.error && section === 'Live' ? A.error : 'Caricamento…' }));
      return;
    }
    var entries = catEntries(section);
    var open = openId || A.openCat[section] || (liveLocked(section) ? ALL : null);
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
    var backBtn = V.focusable(h('div', { class: 'back btn small', text: '←' }), function () { if (openId) A.openCat.Discover = null; else A.openCat[section] = null; render(); });
    var sortBtn = V.focusable(h('div', { class: 'btn small', data: { key: 'sort' }, text: '⇅  ' + SORTS[S.sortOf(section)] }), function () { showSort(section); });
    var listBtn = V.focusable(h('div', { class: 'toggle btn small' + (grid ? '' : ' on'), data: { key: 'view-list' }, text: '☰ Elenco' }), function () { S.setGrid(section, false); render(false, root.querySelector('[data-key="view-list"]')); });
    var gridBtn = V.focusable(h('div', { class: 'toggle btn small' + (grid ? ' on' : ''), data: { key: 'view-grid' }, text: '▦ Griglia' }), function () { S.setGrid(section, true); render(false, root.querySelector('[data-key="view-grid"]')); });
    content.appendChild(h('div', { class: 'header' }, [
      liveLocked(section) && !openId ? null : backBtn,
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
        if (open === CONT) el.continueEntry = e;
        el.listItem = it;
        return el;
      });
    }
    content.appendChild(h('div', { class: 'dim', style: 'margin-top:0.6rem;font-size:0.85rem', text: open === CONT
      ? 'Tasto rosso del telecomando: rimuovi il titolo da Continua a guardare. Tasto verde: aggiungi o togli dalla mia lista.'
      : 'Tasto verde del telecomando: aggiungi o togli il titolo dalla mia lista. Finito di guardarlo, esce da solo.' }));
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
      if (!tokens.length) { info.textContent = 'Canali, film e serie insieme. Premi OK sulla casella per scrivere, oppure 🎤 Voce per dettare.'; return; }
      if (A.scope !== 'Channels') { ensure('movies'); ensure('series'); }
      function ok(key) { return tokens.every(function (t) { return key.indexOf(t) >= 0; }); }
      var total = 0;
      function group(title, list, build) {
        if (!list.length) return;
        total += list.length;
        results.appendChild(h('div', { class: 'group-title', text: title + ' · ' + list.length }));
        list.forEach(function (x) { results.appendChild(build(x)); });
      }
      // Anche le categorie: "azione", "sport", "bambini"...
      var catHits = [];
      [['Live', 'Channels', A.live, ' canali'], ['Movies', 'Movies', A.movies, ' titoli'], ['Series', 'Series', A.series, ' serie']].forEach(function (x) {
        var l = x[2];
        if (!l || (A.scope !== 'All' && A.scope !== x[1])) return;
        l.cats.forEach(function (c) {
          if ((l.by[c.id] || []).length && ok(u.normalize(c.name))) catHits.push({ section: x[0], cat: c, count: l.by[c.id].length, unit: x[3] });
        });
      });
      group('Categorie', catHits.slice(0, 60), function (x) {
        var where = x.section === 'Live' ? 'TV in diretta' : x.section === 'Movies' ? 'Film' : 'Serie TV';
        return V.focusable(h('div', { class: 'item flat' }, [
          h('div', { class: 'thumb' }, u.art(null, '▢')),
          h('div', { class: 'grow' }, [
            h('div', { class: 't ellipsis', text: x.cat.name }),
            h('div', { class: 's ellipsis', text: 'Categoria · ' + where + ' · ' + x.count + x.unit }),
          ]),
        ]), function () {
          A.section = x.section;
          A.openCat[x.section] = x.cat.id;
          A.lastCat[x.section] = x.cat.id;
          if (x.section === 'Live') S.set('lastCategoryId', x.cat.id);
          render();
        });
      });
      if ((A.scope === 'All' || A.scope === 'Channels') && A.live) {
        // Lo stesso canale in qualità o categorie diverse è un solo risultato.
        var seen = {};
        var chs = A.live.items.filter(function (c) {
          if (!ok(c.key)) return false;
          var k = u.channelKey(c.name);
          return seen[k] ? false : (seen[k] = true);
        }).slice(0, 60);
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
    var mic = V.focusable(h('div', { class: 'btn mic', data: { key: 'search-mic' }, text: '🎤  Voce' }), function () { startVoice(input, run); });
    var quiz = V.focusable(h('div', { class: 'btn mic', data: { key: 'search-quiz' }, text: '💡  Cosa guardo?' }), openQuiz);
    content.appendChild(h('div', { class: 'page-title', text: 'Cerca' }));
    content.appendChild(info);
    content.appendChild(h('div', { class: 'search-row' }, [input, mic, quiz]));
    content.appendChild(chips);
    content.appendChild(h('div', { class: 'scroll' }, results));
    run();
  }

  /**
   * Ricerca vocale dal pulsante 🎤: se il TV riconosce la voce nel browser la si usa, altrimenti
   * si apre la tastiera del TV sulla casella, che ha la dettatura (tasto microfono del telecomando).
   */
  function startVoice(input, run) {
    var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    function keyboard() {
      Nav.focus(input);
      input.focus();
      u.toast(IPTV.Platform.voice.samsung
        ? 'Tieni premuto il tasto microfono del telecomando e di\' il titolo'
        : 'Premi il tasto microfono del telecomando (o della tastiera) e parla');
    }
    if (!Rec) { keyboard(); return; }
    var rec, got = false;
    try {
      rec = new Rec();
      rec.lang = 'it-IT';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = function (ev) {
        var text = ev.results && ev.results[0] && ev.results[0][0] ? ev.results[0][0].transcript : '';
        if (!text) return;
        got = true;
        input.value = text.trim();
        run();
      };
      rec.onerror = function () { if (!got) keyboard(); };
      rec.onend = function () { if (!got) keyboard(); got = true; };
      rec.start();
      u.toast('Parla ora…');
    } catch (e) { keyboard(); }
  }

  /** Testo arrivato dalla voce (tasto microfono sui TV Samsung): apre Cerca con quel testo. */
  function voiceSearch(text) {
    if (!A.client) return;
    if (modal.classList.contains('open')) closeModal();
    if (A.screen === 'player') leavePlayer();
    A.stack = [];
    A.screen = 'home';
    A.section = 'Search';
    A.search = text;
    render();
    var first = root.querySelector('.list .f');
    if (first) Nav.focus(first);
    u.toast('Cerco "' + text + '"');
  }

  IPTV.Platform.voice.onSearch = voiceSearch;
  IPTV.Platform.voice.state = function () {
    if (A.screen === 'player') return 'Player';
    if (A.screen === 'login') return 'None';
    if (A.screen !== 'home') return 'List';
    if (A.section === 'Search') return 'Search';
    if (A.section === 'Settings') return 'Setting';
    return A.openCat[A.section] || liveLocked(A.section) ? 'List' : 'Home';
  };

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
    if (Server.active()) {
      box.appendChild(h('div', { class: 'group-title', text: 'Liste IPTV' }));
      if (!A.serverLists) {
        box.appendChild(h('div', { class: 'dim', text: 'Carico le liste del server…' }));
        A.serverLists = [];
        Server.lists().then(function (l) { A.serverLists = l; if (A.screen === 'home' && A.section === 'Settings') render(true); }, function (e) { u.toast(e.message); });
      }
      (A.serverLists || []).forEach(function (l) {
        box.appendChild(h('div', { class: 'info-line' }, [h('b', { text: l.alias + (l.active ? ' · in uso' : '') }), l.username + ' · ' + expiryText(l)]));
        if (l.active) return; // senza lista in uso il server non avrebbe niente da mostrare
        box.appendChild(V.focusable(h('div', { class: 'btn', text: 'Usa ' + l.alias }), function () { useList(l); }));
        box.appendChild(V.focusable(h('div', { class: 'btn', text: 'Rimuovi ' + l.alias }), function () {
          Server.removeList(l.index).then(function (lists) { A.serverLists = lists; render(true); }, function (e) { u.toast(e.message); });
        }));
      });
      box.appendChild(V.focusable(h('div', { class: 'btn', text: 'Aggiungi lista' }), function () { A.loginError = null; push('login', { adding: true }); }));
    } else {
      box.appendChild(h('div', { class: 'group-title', text: 'Liste IPTV' }));
      var active = S.activeList();
      S.lists().forEach(function (l) {
        var inUse = active === l;
        box.appendChild(h('div', { class: 'info-line' }, [h('b', { text: l.alias + (inUse ? ' · in uso' : '') }), l.username + ' · ' + expiryText(l)]));
        if (!inUse) box.appendChild(V.focusable(h('div', { class: 'btn', text: 'Usa ' + l.alias }), function () { useList(l); }));
        box.appendChild(V.focusable(h('div', { class: 'btn', text: 'Rimuovi ' + l.alias }), function () {
          S.removeList(l);
          if (inUse) logout(); else render(true);
        }));
      });
      box.appendChild(V.focusable(h('div', { class: 'btn', text: 'Aggiungi lista' }), function () { A.loginError = null; push('login', { adding: true }); }));
    }
    box.appendChild(h('div', { class: 'group-title', text: 'Server di casa' }));
    if (Server.active()) {
      box.appendChild(h('div', { class: 'info-line' }, [h('b', { text: 'Indirizzo' }), Server.url()]));
      box.appendChild(h('div', { class: 'dim', style: 'margin:0.3rem 0', text: Server.error || ('Canali, film e serie passano dal server.' + (Server.syncedAt ? ' Aggiornato alle ' + u.clock(Server.syncedAt / 1000) + '.' : '')) }));
      box.appendChild(V.focusable(h('div', { class: 'btn', text: '↻  Aggiorna ora' }), function () {
        A.serverLists = null;
        Server.pull(true).then(function () { render(true); });
      }));
      box.appendChild(V.focusable(h('div', { class: 'btn', text: 'Scollega il server' }), disconnectServer));
    } else {
      box.appendChild(h('div', { class: 'dim', style: 'margin:0.3rem 0', text: 'Spento: il TV si collega direttamente al provider IPTV.' }));
      box.appendChild(V.focusable(h('div', { class: 'btn', text: 'Collega il server' }), function () { push('server', {}); }));
    }
    box.appendChild(h('div', { class: 'group-title', text: 'Aspetto' }));
    var skin = S.get('skin');
    var skins = h('div', { class: 'seasons' });
    [['classic', 'Moderno'], ['skeuo', 'Skeuomorfico'], ['metro', 'Modern UI'], ['dueffe', 'Dueffe'], ['nothing', 'Nothing']].forEach(function (o) {
      var on = skin === o[0] || (o[0] === 'classic' && skin !== 'skeuo' && skin !== 'metro' && skin !== 'dueffe' && skin !== 'nothing');
      skins.appendChild(V.focusable(h('div', { class: 'chip' + (on ? ' on' : ''), data: { key: 'skin-' + o[0] }, text: o[1] }), function () {
        S.set('skin', o[0]);
        document.documentElement.classList.toggle('skeuo', o[0] === 'skeuo');
        document.documentElement.classList.toggle('metro', o[0] === 'metro');
        document.documentElement.classList.toggle('dueffe', o[0] === 'dueffe');
        document.documentElement.classList.toggle('nothing', o[0] === 'nothing');
        render(false, root.querySelector('[data-key="skin-' + o[0] + '"]'));
      }));
    });
    box.appendChild(skins);
    box.appendChild(h('div', { class: 'dim', style: 'margin:0 0 0.6rem', text: {
      skeuo: 'Pelle, lino, metallo spazzolato e pulsanti lucidi.',
      metro: 'Lo stile di Windows Phone: nero, piatto, angoli vivi, titoli grandi e sezioni in alto.',
      dueffe: 'Fondo quasi nero, superfici calde, avorio e oro, angoli morbidi.',
      nothing: 'Nero OLED, bianco e un solo rosso, titoli a matrice di punti, linee sottili al posto delle ombre.',
    }[skin] || 'Lo stile di sempre: scuro, arrotondato, menu di lato.' }));
    tmdbSettings(box);
    box.appendChild(h('div', { class: 'group-title', text: 'Riproduzione' }));
    box.appendChild(settingRow('Formato HLS (m3u8) per la TV in diretta', 'Di solito MPEG-TS è più stabile; prova HLS se un canale non parte.',
      S.get('outputFormat') === 'm3u8', function () { S.set('outputFormat', S.get('outputFormat') === 'm3u8' ? 'ts' : 'm3u8'); }));
    box.appendChild(settingRow('Riprendi l\'ultimo canale all\'avvio', 'Apri l\'app e il canale riparte da dov\'eri rimasto.',
      S.get('autoPlayLast'), function () { S.set('autoPlayLast', !S.get('autoPlayLast')); }));
    box.appendChild(settingRow('Canali in un elenco unico', 'Come il digitale terrestre: niente categorie, ogni canale una volta sola, partendo dalla qualità migliore.',
      S.get('singleChannelList'), function () {
        S.set('singleChannelList', !S.get('singleChannelList'));
        A.openCat.Live = null;
        if (A.live && A.liveItems) A.live = liveLibrary(A.live.raw.cats, A.liveItems);
      }));
    box.appendChild(settingRow('Nascondi XXX', 'Toglie canali, film e serie delle categorie con XXX nel nome.',
      S.get('hideAdult'), function () { S.set('hideAdult', !S.get('hideAdult')); reapplyHidden(); }));
    box.appendChild(h('div', { class: 'group-title', text: 'Dati' }));
    box.appendChild(V.focusable(h('div', { class: 'btn', text: '↻  Aggiorna liste' }), function () {
      A.epg = {};
      u.toast('Aggiorno le liste…');
      openAccount(S.account(), false, true);
    }));
    box.appendChild(h('div', { class: 'group-title', text: 'Versione' }));
    box.appendChild(h('div', { class: 'info-line' }, [h('b', { text: 'Installata' }), IPTV.VERSION]));
    if (A.update) {
      box.appendChild(h('div', { class: 'info-line', style: 'color:var(--accent2)', text: 'Disponibile IPTVISION ' + A.update + '. Scarica il file ' + IPTV.Platform.ext + ' dalle release su GitHub e installalo dal PC (vedi README).' }));
    }
    box.appendChild(h('div', { class: 'group-title', text: '' }));
    box.appendChild(V.focusable(h('div', { class: 'btn', text: 'Esci dall\'account' }), logout));
    box.appendChild(h('div', { class: 'dim', style: 'margin-top:1rem;font-size:0.8rem', text: 'IPTVISION è solo un lettore e non contiene canali. Va usato con un servizio IPTV a cui si ha diritto di accedere.' }));
  }

  /** La chiave TMDB del TV: con questa film e serie diventano una sola schermata con copertine, tendenze e generi. */
  function tmdbSettings(box) {
    box.appendChild(h('div', { class: 'group-title', text: 'TMDB' }));
    box.appendChild(h('div', { class: 'dim', style: 'margin:0.3rem 0 0.6rem', text: 'Con una chiave di themoviedb.org (la "Chiave API" o il "Token di accesso in lettura" che trovi nel tuo profilo TMDB, alla voce API) film e serie diventano una sola schermata, con copertine, tendenze e generi. Con il server di casa vale per tutti i dispositivi collegati.' }));
    if (!S.get('tmdbKey') && IPTV.TMDB_KEY) box.appendChild(h('div', { class: 'info-line' }, [h('b', { text: 'Chiave' }), 'Integrata nell\'app (puoi usare la tua)']));
    if (S.get('tmdbKey')) {
      box.appendChild(h('div', { class: 'info-line' }, [h('b', { text: 'Chiave' }), 'Inserita']));
      box.appendChild(V.focusable(h('div', { class: 'btn', data: { key: 'tmdb-remove' }, text: 'Rimuovi chiave' }), function () { setTmdbKey(''); }));
      return;
    }
    var input = h('input', { type: 'text', placeholder: 'Chiave API o token TMDB' });
    input.classList.add('f');
    input.dataset.key = 'tmdb-input';
    var save = function () {
      var k = input.value.trim();
      if (!k) return;
      u.toast('Controllo la chiave…');
      IPTV.Tmdb.check(k).then(function () { setTmdbKey(k); u.toast('Chiave TMDB salvata: trovi tutto in "Film e serie"'); }, function (e) { u.toast(e.message); });
    };
    input.onSubmit = save;
    box.appendChild(h('div', { class: 'field', style: 'max-width:34rem' }, input));
    box.appendChild(V.focusable(h('div', { class: 'btn primary', text: 'Salva chiave' }), save));
  }

  /** Con il server di casa la chiave è dell'account: la ricevono tutti i dispositivi collegati. */
  function setTmdbKey(k, fromServer) {
    S.set('tmdbKey', k);
    if (!fromServer) Server.queue({ op: 'tmdbKey', key: k }, true);
    IPTV.Tmdb.clear();
    A.tmdbRows = null; A.tmdbError = null; A.tmdbLoading = false;
    A.openCat.Discover = null;
    if (fromServer) {
      if (!tmdbKey() && (A.section === 'Discover' || A.section === 'MyList')) A.section = 'Live';
      if (tmdbKey() && (A.section === 'Movies' || A.section === 'Series')) A.section = 'Discover';
      return; // ridisegna Server.onState
    }
    render(false, root.querySelector('[data-key="nav-Settings"]'));
  }
  Server.onTmdbKey = function (k) { setTmdbKey(k, true); };

  // ---------- Film e serie (TMDB) ----------

  var discoverFilter = 'all';
  // Con "Tutto": le categorie della lista in fondo, dei film o delle serie (mai insieme).
  var discoverCatSeries = false;

  function loadTmdb() {
    var key = tmdbKey();
    if (!key || A.tmdbRows || A.tmdbLoading) return;
    A.tmdbLoading = true;
    IPTV.Tmdb.check(key).catch(function (e) { A.tmdbError = e.message; });
    IPTV.Tmdb.loadRows(key).then(function (rows) {
      A.tmdbLoading = false;
      badge();
      if (tmdbKey() !== key) return;
      A.tmdbRows = rows;
      A.tmdbMatched = null;
      if (A.screen === 'home' && A.section === 'Discover' && !A.openCat.Discover) render(true);
    });
  }

  function itemKey(it) { return it.kind === 'movie' ? it.posKey : 's:' + it.seriesId; }

  /** Le liste di TMDB diventano titoli del catalogo ({ entry, tmdb }), ognuno una volta per riga. */
  function matchedRows() {
    if (!A.tmdbRows || (!A.movies && !A.series)) return null;
    if (A.tmdbMatched && A.tmdbMatched.movies === A.movies && A.tmdbMatched.series === A.series) return A.tmdbMatched.rows;
    var idx = IPTV.Tmdb.index(A.movies ? A.movies.items : [], A.series ? A.series.items : []);
    var rows = A.tmdbRows.map(function (r) {
      var seen = {}, titles = [];
      r.items.forEach(function (c) {
        var e = IPTV.Tmdb.find(c, idx);
        if (!e || seen[itemKey(e.item)]) return;
        seen[itemKey(e.item)] = true;
        titles.push({ entry: e, tmdb: c });
      });
      return { id: r.id, title: r.title, top: r.top, titles: titles };
    });
    A.tmdbMatched = { movies: A.movies, series: A.series, rows: rows };
    return rows;
  }

  function openTitle(t) { openEntry(t.entry); }

  /** I film partono subito (da dove si era rimasti), le serie aprono gli episodi. */
  function playTitle(t) {
    if (t.entry.item.kind === 'movie' && t.entry.variants.length === 1) playMovie(t.entry.item, false); else openTitle(t);
  }

  function maxProgress(e) {
    return e.item.kind === 'movie' ? Math.max.apply(null, e.variants.map(function (v) { return Pos.progress(v.posKey); })) : 0;
  }

  function renderDiscover(content) {
    // Si mostra appena c'è uno dei due cataloghi: l'altro (e TMDB) arriva dopo. Prima, la pagina com'è fatta coi riquadri che pulsano.
    if (!A.movies && !A.series) { content.appendChild(h('div', { class: 'scroll' }, h('div', { class: 'discover' }, [skelRow(), skelRow(), skelRow()]))); return; }
    loadTmdb();
    var M = A.movies || { cats: [], items: [] }, SR = A.series || { cats: [], items: [] };
    var pass = function (t) { return discoverFilter === 'all' || (discoverFilter === 'movie') === (t.entry.item.kind === 'movie'); };
    var rows = matchedRows();
    var known = {};
    (rows || []).forEach(function (r) { r.titles.forEach(function (t) { known[itemKey(t.entry.item)] = t.tmdb; }); });
    var wrap = function (e) { return { entry: e, tmdb: known[itemKey(e.item)] || null }; };

    var cont = moviesFor(CONT).map(function (e) { return { t: wrap(e), u: Math.max.apply(null, e.variants.map(function (v) { return Pos.updatedAt(v.posKey); })) }; })
      .concat(seriesFor(CONT).map(function (e) { var le = Pos.lastEpisode(e.item.seriesId); return { t: wrap(e), u: le ? le.u : 0 }; }))
      .sort(function (a, b) { return b.u - a.u; }).map(function (x) { return x.t; }).filter(pass);
    var mine = moviesFor(MINE).concat(seriesFor(MINE)).map(wrap).filter(pass)
      .sort(function (a, b) { return Pos.myListAddedAt(itemKey(b.entry.item)) - Pos.myListAddedAt(itemKey(a.entry.item)); });
    var recent = u.groupVariants(M.items.slice().sort(function (a, b) { return (b.added || 0) - (a.added || 0); }).slice(0, 80), function (m) { return m.name; }).slice(0, 30).map(wrap);
    var tmdbRows = (rows || []).map(function (r) { return { id: r.id, title: r.title, top: r.top, titles: r.titles.filter(pass) }; })
      .filter(function (r) { return r.titles.length >= (r.top ? 5 : 4); });

    var box = h('div', { class: 'discover' });
    content.appendChild(h('div', { class: 'scroll' }, box));

    var chips = h('div', { class: 'seasons', style: 'margin-bottom:0.4rem' });
    [['all', 'Tutto'], ['movie', 'Film'], ['tv', 'Serie TV']].forEach(function (o) {
      chips.appendChild(V.focusable(h('div', { class: 'chip' + (discoverFilter === o[0] ? ' on' : ''), data: { key: 'df-' + o[0] }, text: o[1] }), function () {
        discoverFilter = o[0];
        render(false, root.querySelector('[data-key="df-' + o[0] + '"]'));
      }));
    });
    chips.appendChild(V.focusable(h('div', { class: 'chip', data: { key: 'df-cats' }, text: 'Categorie ▾' }), showDiscoverCategories));
    box.appendChild(chips);
    if (A.tmdbError) box.appendChild(h('div', { style: 'color:var(--live);margin:0.4rem 0 0.8rem', text: A.tmdbError + ' Controlla la chiave in Impostazioni → TMDB.' }));
    // Sul TV niente carosello in cima: la pagina parte dai filtri e dalle righe.
    if (!rows && !A.tmdbError && tmdbKey()) { box.appendChild(skelRow()); box.appendChild(skelRow()); }

    // Le righe si disegnano a blocchi: le successive quando il focus si avvicina alla fine.
    var all = [];
    if (cont.length) all.push({ title: 'Continua a guardare', wide: true, titles: cont });
    if (mine.length) all.push({ title: 'La mia lista', titles: mine, lookup: true });
    tmdbRows.forEach(function (r, i) {
      all.push({ title: r.top ? r.title + ' in Italia' : r.title, top: r.top, titles: r.titles.slice(0, r.top ? 10 : 24) });
      if (i === 1 && discoverFilter !== 'tv' && recent.length) all.push({ title: 'Aggiunti di recente', titles: recent, lookup: true, all: 'm:' + ALL });
    });
    if (rows && !tmdbRows.length && !A.tmdbError) all.push({ note: 'Nessun titolo di TMDB trovato nel catalogo: sotto ci sono le categorie della lista.' });
    all.push({ heading: 'Le categorie della lista' });
    // Le categorie della lista a griglia (nome e quanti titoli): scelta una, tutti i suoi titoli.
    function catsOf(L, p) {
      return L.cats.map(function (c) { return { id: p + c.id, name: c.name, count: ((L.by || {})[c.id] || []).length }; })
        .filter(function (c) { return c.count > 0; });
    }
    all.push({ catGrid: { m: discoverFilter !== 'tv' ? catsOf(M, 'm:') : [], s: discoverFilter !== 'movie' ? catsOf(SR, 's:') : [] } });

    var shown = 0;
    function more() {
      var end = Math.min(all.length, shown + 6);
      for (var i = shown; i < end; i++) box.appendChild(rowBox(all[i], i));
      shown = end;
    }
    function rowBox(r, i) {
      if (r.note) return h('div', { class: 'dim', style: 'margin:1rem 0', text: r.note });
      if (r.heading) return h('div', { class: 'page-title', style: 'margin-top:2rem', text: r.heading });
      if (r.catGrid) {
        var cg = r.catGrid, both = cg.m.length > 0 && cg.s.length > 0;
        var grid = h('div', { class: 'tiles', style: 'margin:0.4rem 0 0 -0.45rem' });
        var fill = function () {
          grid.innerHTML = '';
          ((both ? discoverCatSeries : !cg.m.length) ? cg.s : cg.m).forEach(function (c) {
            var el = V.categoryTile(c, function () { A.discoverFrom = c.id; A.openCat.Discover = c.id; render(); });
            el.dataset.key = 'all-' + c.id;
            grid.appendChild(el);
          });
        };
        fill();
        if (!both) return grid;
        // Con "Tutto" un selettore Film / Serie TV: si cambia sul posto, senza ridisegnare la pagina.
        var sw = h('div', { class: 'seasons', style: 'margin-top:0.6rem' });
        [[false, 'Film'], [true, 'Serie TV']].forEach(function (o) {
          var chip = V.focusable(h('div', { class: 'chip' + (discoverCatSeries === o[0] ? ' on' : ''), data: { key: 'dcs-' + o[0] }, text: o[1] }), function () {
            discoverCatSeries = o[0];
            Array.prototype.forEach.call(sw.children, function (c) { c.classList.toggle('on', c === chip); });
            fill();
          });
          sw.appendChild(chip);
        });
        return h('div', null, [sw, grid]);
      }
      var titles = r.titles;
      if (r.cat) {
        var id = r.cat.slice(2);
        titles = (r.cat.charAt(0) === 'm' ? moviesFor(id) : seriesFor(id)).slice(0, 24).map(function (e) { return { entry: e, tmdb: null }; });
        if (!titles.length) return h('div');
      }
      var tiles = h('div', { class: 'dtiles' });
      titles.forEach(function (t, n) {
        var el = r.top ? topTile(t, n + 1) : r.wide ? wideTile(t) : posterTile(t, !!r.cat, !!r.lookup);
        var prev = el.onFocus;
        el.onFocus = function () { if (i >= shown - 2) more(); if (prev) prev(); };
        tiles.appendChild(el);
      });
      var allId = r.all || r.cat;
      if (allId) {
        // In fondo alla riga, grande come una locandina: apre tutti i titoli della categoria.
        var see = V.focusable(h('div', { class: 'dtile seeall', data: { key: 'all-' + allId } }, [
          h('div', { class: 'art' }, h('div', { class: 'sa' }, [h('i', { text: '→' }), h('b', { text: 'Guarda tutto' })])),
          r.cat ? h('div', { class: 'cap' }) : null,
        ]), function () { A.discoverFrom = allId; A.openCat.Discover = allId; render(); });
        see.onFocus = function () { if (i >= shown - 2) more(); };
        tiles.appendChild(see);
      }
      return h('div', { class: 'drow' }, [h('div', { class: 'drow-title' }, [h('span', { text: r.title })]), h('div', { class: 'hscroll' }, tiles)]);
    }
    more();
    // Tornando da "Guarda tutto": la riga si disegna e il focus torna sulla sua card.
    if (A.discoverFrom) {
      var sel = '[data-key="all-' + A.discoverFrom + '"]';
      while (!box.querySelector(sel) && shown < all.length) more();
      focusAfterRender = box.querySelector(sel);
      A.discoverFrom = null;
    }
  }

  function skelRow() {
    var tiles = [];
    for (var n = 0; n < 7; n++) tiles.push(h('i', { class: 'skel skel-tile' }));
    return h('div', { class: 'drow' }, [h('div', { class: 'skel skel-title' }), h('div', { class: 'hscroll' }, tiles)]);
  }

  /** Con la chiave TMDB: film e serie aggiunti con +, in una pagina tutta loro e nell'ordine in cui li hai aggiunti. */
  function renderMyList(content) {
    if (!A.movies && !A.series) { content.appendChild(h('div', { class: 'empty', text: 'Caricamento della tua lista…' })); return; }
    var list = moviesFor(MINE).concat(seriesFor(MINE)).map(function (e) { return { entry: e, tmdb: null }; })
      .sort(function (a, b) { return Pos.myListAddedAt(itemKey(b.entry.item)) - Pos.myListAddedAt(itemKey(a.entry.item)); });
    content.appendChild(h('div', { class: 'page-title', text: 'La mia lista' }));
    content.appendChild(h('div', { class: 'dim', style: 'margin-bottom:0.6rem', text: list.length === 1 ? '1 titolo' : list.length + ' titoli' }));
    if (!list.length) { content.appendChild(h('div', { class: 'empty', text: 'La lista è vuota: aggiungi film e serie con + dalla loro scheda.' })); return; }
    var grid = h('div', { class: 'mygrid' });
    list.forEach(function (t) { grid.appendChild(posterTile(t, true, true)); });
    content.appendChild(h('div', { class: 'scroll' }, grid));
  }

  function posterUrl(t) { return IPTV.Tmdb.img(t.tmdb && t.tmdb.poster) || t.entry.item.poster || t.entry.item.cover; }

  /** La scheda TMDB del titolo quando manca (la mia lista, aggiunti di recente, continua a guardare). */
  function withTmdb(t, cb) {
    if (t.tmdb || !tmdbKey()) return;
    var it = t.entry.item;
    IPTV.Tmdb.lookup(tmdbKey(), it.kind === 'movie' ? 'movie' : 'tv', it.name, it.year).then(function (c) { if (c) { t.tmdb = c; cb(c); } });
  }

  /** Cambia l'immagine di un riquadro (si carica quando arriva vicino allo schermo, vedi util.js). */
  function swapArt(art, url) {
    var img = art.querySelector('img');
    if (!url || !img) return;
    if (img.getAttribute('src')) img.src = url; else img.dataset.src = url;
  }

  function posterTile(t, caption, lookup) {
    var it = t.entry.item;
    var p = maxProgress(t.entry);
    var art = h('div', { class: 'art' }, u.art(posterUrl(t), it.initials)
      .concat(it.kind !== 'movie' && !caption ? [h('span', { class: 'kind', text: 'SERIE' })] : [])
      .concat(p > 0 && p < 1 ? [u.progressBar(p)] : []));
    var el = V.focusable(h('div', { class: 'dtile' }, [art, caption ? h('div', { class: 'cap', text: it.name }) : null]), function () { openTitle(t); });
    el.dataset.key = 'd-' + itemKey(it);
    el.listItem = it;
    if (lookup) withTmdb(t, function (c) { swapArt(art, IPTV.Tmdb.img(c.poster)); });
    return el;
  }

  function topTile(t, n) {
    var it = t.entry.item;
    var el = V.focusable(h('div', { class: 'dtile top' }, [h('span', { class: 'rank', text: String(n) }), h('div', { class: 'art' }, u.art(posterUrl(t), it.initials))]), function () { openTitle(t); });
    el.listItem = it;
    return el;
  }

  /** Continua a guardare: la scena del titolo con l'avanzamento, come fanno i servizi di streaming. */
  function wideTile(t) {
    var it = t.entry.item;
    var p = maxProgress(t.entry);
    var scene = IPTV.Tmdb.img(t.tmdb && t.tmdb.backdrop, 'w780');
    var art = h('div', { class: 'art' }, u.art(scene || it.poster || it.cover, it.initials).concat([h('span', { class: 'play', text: '▶' })]).concat(p > 0 && p < 1 ? [u.progressBar(p)] : []));
    var name = h('div', { class: 'name ellipsis', text: (t.tmdb && t.tmdb.title) || it.name });
    var el = V.focusable(h('div', { class: 'dtile wide' }, [art, name, h('div', { class: 'cap ellipsis', text: it.kind === 'movie' ? 'Film' : 'Serie TV · riprendi l\'episodio' })]), function () { playTitle(t); });
    el.continueEntry = t.entry;
    el.listItem = it;
    withTmdb(t, function (c) {
      name.textContent = c.title || it.name;
      swapArt(art, IPTV.Tmdb.img(c.backdrop, 'w780'));
    });
    return el;
  }

  function showDiscoverCategories() {
    var box = h('div', { class: 'dialog' }, [h('h3', { text: 'Categorie' })]);
    var list = h('div', { class: 'scroll', style: 'max-height:30rem' });
    function add(prefix, title, allName, cats) {
      list.appendChild(h('div', { class: 'group-title', text: title }));
      [{ id: ALL, name: allName }].concat(cats).forEach(function (c) {
        list.appendChild(V.focusable(h('div', { class: 'opt', text: c.name }), function () { closeModal(); A.openCat.Discover = prefix + ':' + c.id; render(); }));
      });
    }
    if (discoverFilter !== 'tv') add('m', 'Film', 'Tutti i film', A.movies ? A.movies.cats : []);
    if (discoverFilter !== 'movie') add('s', 'Serie TV', 'Tutte le serie', A.series ? A.series.cats : []);
    box.appendChild(list);
    openModal(box);
  }

  /** Torna alla schermata di accesso; le liste salvate restano lì da scegliere. */
  function logout() {
    Player.stop();
    if (Server.active()) { Server.logout(Server.url(), S.get('password')); Server.clearQueue(); S.restoreOwnAccount(); }
    S.clearAccount();
    IPTV.Cache.clear();
    A.client = null; A.live = A.movies = A.series = null; A.stack = []; A.openCat = {}; A.data = null;
    A.screen = 'login';
    render();
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
    var tm = detailTmdb(d, 'movie', m.name, m.year, 'movie');
    var play = V.focusable(h('div', { class: 'btn primary', data: { key: 'play' }, text: resume > 0 ? '▶  Riprendi da ' + u.formatTime(resume) : '▶  Guarda' }), function () { playMovie(m, false); });
    var buttons = [play];
    if (resume > 0) buttons.push(V.focusable(h('div', { class: 'btn', text: '↺  Dall\'inizio' }), function () { playMovie(m, true); }));
    buttons.push(myListButton(m));
    root.appendChild(h('div', { class: 'detail' }, [
      backdrop(tm),
      h('div', { class: 'poster' }, u.art(IPTV.Tmdb.img(tm && tm.poster, 'w500') || m.poster, m.initials)),
      h('div', { class: 'grow' }, [
        h('h2', { text: m.name }),
        h('div', { class: 'muted', text: u.joinMeta(info.year || m.year, info.genre, info.duration, m.rating > 0 ? '★ ' + m.rating.toFixed(1) : null) }),
        info.tech ? h('div', { class: 'dim', text: [u.techResolution(info.tech)].concat(u.techDetails(info.tech)).filter(Boolean).join('  ·  ') }) : null,
        h('div', { style: 'margin-top:1.4rem' }, buttons),
        info.plot || (tm && tm.overview) ? h('div', { class: 'plot', text: info.plot || tm.overview }) : null,
        info.director ? h('div', { class: 'muted', text: 'Regia: ' + info.director }) : null,
        info.cast ? h('div', { class: 'muted', style: 'margin-top:0.3rem', text: 'Cast: ' + info.cast }) : null,
      ]),
    ]));
    if (!focusAfterRender) focusAfterRender = play;
  }

  /** Con la chiave TMDB: la scheda del titolo, chiesta una volta (poi si ridisegna la schermata). */
  function detailTmdb(d, kind, name, year, screen) {
    var key = tmdbKey();
    if (!key) return null;
    if (d.tm === undefined) {
      d.tm = null;
      IPTV.Tmdb.lookup(key, kind, name, year).then(function (c) { d.tm = c; if (c && A.screen === screen && A.data === d) render(true); });
    }
    return d.tm;
  }

  /** La scena del titolo che sfuma dietro la scheda. */
  function backdrop(tm) {
    var url = IPTV.Tmdb.img(tm && tm.backdrop, 'w1280');
    return url ? h('div', { class: 'backdrop', style: 'background-image:url("' + url + '")' }) : null;
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
    var tm = detailTmdb(d, 'tv', s.name, s.year, 'series');
    var eps = info ? info.episodes : [];
    var seasons = [];
    eps.forEach(function (e) { if (seasons.indexOf(e.season) < 0) seasons.push(e.season); });
    var resume = resumeEpisode(s, eps);
    if (d.season === null && resume) d.season = resume.season;
    var box = h('div', { class: 'list' });
    var head = h('div', { class: 'row', style: 'margin-bottom:1rem' }, [
      h('div', { class: 'poster', style: 'width:10rem;height:15rem;margin-right:1.6rem;border-radius:0.8rem;overflow:hidden;position:relative;background:var(--surface-hover)' }, u.art(IPTV.Tmdb.img(tm && tm.poster, 'w500') || s.cover, s.initials)),
      h('div', { class: 'grow' }, [
        h('h2', { text: s.name }),
        h('div', { class: 'muted', text: u.joinMeta((info && info.year) || s.year, (info && info.genre) || s.genre, seasons.length ? seasons.length + ' stagioni' : null) }),
        h('div', { class: 'plot', text: (info && info.plot) || s.plot || (tm && tm.overview) || '' }),
      ]),
    ]);
    var play = null;
    if (resume) {
      var r = Pos.resumeMs(resume.posKey);
      play = V.focusable(h('div', { class: 'btn primary', data: { key: 'play' }, text: '▶  ' + (r > 0 ? 'Riprendi S' + resume.season + ' E' + resume.number + ' da ' + u.formatTime(r) : 'Guarda S' + resume.season + ' E' + resume.number) }),
        function () { playEpisode(s, resume, eps, false); });
      head.lastChild.appendChild(play);
    }
    head.lastChild.appendChild(myListButton(s));
    var chips = h('div', { class: 'seasons', 'data-enter': 'on' });
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
    root.appendChild(h('div', { class: 'detail', style: 'display:block' }, [backdrop(tm), h('div', { class: 'scroll', style: 'height:100%' }, [
      head, info ? chips : h('div', { class: 'muted', text: 'Caricamento episodi…' }), box,
    ])]));
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

  /** Toglie un film o una serie da "Continua a guardare" (tutte le versioni), dopo conferma. */
  function confirmRemoveContinue(e) {
    A.modalReturn = Nav.current();
    var it = e.item;
    var box = h('div', { class: 'dialog' }, [h('h3', { text: 'Rimuovere da Continua a guardare?' }), h('div', { class: 'sub ellipsis', text: it.name })]);
    var remove = V.focusable(h('div', { class: 'opt' }, '✕  Rimuovi'), function () {
      e.variants.forEach(function (v) {
        if (v.kind === 'movie') Pos.forgetPosition(v.posKey); else Pos.forgetSeries(v.seriesId);
      });
      Pos.save();
      A.modalReturn = null;
      closeModal();
      u.toast(it.name + ' tolto da Continua a guardare');
      render();
    });
    box.appendChild(remove);
    box.appendChild(V.focusable(h('div', { class: 'opt' }, '     Annulla'), closeModal));
    openModal(box, remove);
  }

  /** Titolo pubblicato più volte (per esempio in FHD e in 4K): si sceglie quale versione aprire. */
  // Dati tecnici delle versioni dei film, chiesti al server la prima volta che si apre la scelta.
  var variantInfo = {};
  var RESOLUTION_TAGS = { '4K': 1, 'UHD': 1, '2160P': 1, 'FHD': 1, '1080P': 1, 'HD': 1, '720P': 1, 'SD': 1, '480P': 1 };

  /** Qualità di una versione: dal file se il server la dà, più le sigle del nome che non dicono la stessa cosa. */
  function variantQuality(v, tech) {
    var res = u.techResolution(tech);
    var tags = (u.qualityOf(v.name) || '').split(' ').filter(function (t) { return t && !(res && RESOLUTION_TAGS[t]); });
    if (res) tags.unshift(res);
    return tags.join(' ');
  }

  function categoryName(lib, id) {
    var name = null;
    if (lib) lib.cats.forEach(function (c) { if (c.id === id) name = c.name; });
    return name;
  }

  function showVariants(e) {
    A.modalReturn = Nav.current();
    var box = h('div', { class: 'dialog' }, [h('h3', { text: 'Scegli la versione' }), h('div', { class: 'sub ellipsis', text: e.item.name })]);
    var list = h('div', { class: 'scroll', style: 'max-height:32rem' });
    e.variants.forEach(function (v, i) {
      var p = v.posKey ? Pos.progress(v.posKey) : 0;
      var movie = v.kind === 'movie';
      var cat = categoryName(movie ? A.movies : A.series, v.categoryId);
      var badge = h('span', { class: 'badge q', text: variantQuality(v, null) || 'Versione ' + (i + 1) });
      var details = h('div', { class: 'dim', text: movie && !(v.streamId in variantInfo) ? 'Leggo i dettagli della versione…' : (cat ? 'Categoria: ' + cat : '') });
      // Si aggiornano solo badge e dettagli, senza ridisegnare la finestra: il focus resta dov'è.
      var fill = function (info) {
        var tech = info && info.tech;
        badge.textContent = variantQuality(v, tech) || 'Versione ' + (i + 1);
        details.textContent = u.techDetails(tech).concat(info && info.duration ? [info.duration] : [], cat ? ['Categoria: ' + cat] : []).join('  ·  ');
      };
      if (movie && v.streamId in variantInfo) fill(variantInfo[v.streamId]);
      else if (movie && A.client) {
        A.client.vodInfo(v.streamId).then(function (info) { variantInfo[v.streamId] = info; fill(info); })
          .catch(function () { variantInfo[v.streamId] = null; fill(null); });
      }
      list.appendChild(V.focusable(h('div', { class: 'opt' }, [
        h('div', { class: 'thumb poster' }, u.art(v.poster || v.cover, v.initials)),
        h('div', { class: 'grow' }, [
          h('div', null, [badge, p > 0 && p < 1 ? h('span', { class: 'badge', text: 'Iniziato' }) : null, p >= 1 ? h('span', { class: 'badge', text: 'Visto' }) : null]),
          h('div', { class: 't ellipsis', style: 'margin-top:0.3rem;font-weight:600', text: v.name }),
          h('div', { class: 'dim', text: v.meta }),
          details,
        ]),
      ]), function () { closeModal(); openItem(v); }));
    });
    box.appendChild(list);
    box.appendChild(h('div', { class: 'hint', text: 'OK per scegliere · Indietro per annullare' }));
    openModal(box);
  }

  // ---------- Cosa guardo? ----------
  // Poche domande a risposta multipla e qualche film o serie consigliati: stesse domande e regole di Windows e Android.

  var QUIZ = [
    { key: 'type', text: 'Cosa ti va di guardare?', options: [['Un film', 'movie'], ['Una serie TV', 'series'], ['Fa lo stesso', 'any']] },
    { key: 'mood', text: 'Che emozioni cerchi?', options: [
      ['Ridere', 'comedy'], ['Azione e adrenalina', 'action'], ['Paura e brividi', 'horror'], ['Emozioni e amore', 'drama'],
      ['Fantascienza e fantasy', 'fantasy'], ['Gialli, crimini e storie vere', 'crime'], ['Animazione e famiglia', 'family'], ['Sorprendimi', 'any']] },
    { key: 'period', text: 'Di che periodo?', options: [['Uscito di recente', 'recent'], ['Anni 2000 e 2010', '2000s'], ['Un classico', 'classic'], ['Fa lo stesso', 'any']] },
    { key: 'rating', text: 'Vuoi andare sul sicuro?', options: [['Sì, solo titoli molto votati', 'top'], ['Fa lo stesso', 'any']] },
  ];
  // Parole (già normalizzate) che riconoscono il genere nel nome della categoria o nel genere della serie.
  var MOOD_WORDS = {
    comedy: ['commedi', 'comed', 'comic', 'umor', 'sitcom', 'parodi'],
    action: ['azion', 'action', 'avventur', 'adventur', 'thriller', 'guerra', 'war', 'western', 'spionag', 'marzial', 'martial'],
    horror: ['horror', 'terror', 'paura', 'brivid', 'zombi', 'slasher', 'soprannatural', 'supernatural'],
    drama: ['dramm', 'drama', 'romant', 'romanc', 'amore', 'love', 'sentiment'],
    fantasy: ['fantasy', 'fantasc', 'sci fi', 'scifi', 'science fiction', 'fantastic', 'supereroi', 'superhero', 'marvel'],
    crime: ['crime', 'crimin', 'giall', 'poliz', 'mister', 'myster', 'document', 'docu', 'biograf', 'true story', 'storic'],
    family: ['animaz', 'animat', 'cartoon', 'cartoni', 'bambin', 'kids', 'famigl', 'family', 'disney', 'ragazz'],
  };

  function openQuiz() {
    A.modalReturn = Nav.current();
    ensure('movies');
    ensure('series');
    quizStep(0, {});
  }

  function quizStep(i, answers) {
    if (i >= QUIZ.length) { quizResults(answers); return; }
    var q = QUIZ[i];
    var box = h('div', { class: 'dialog' }, [h('h3', { text: 'Cosa guardo?' }), h('div', { class: 'sub', text: 'Domanda ' + (i + 1) + ' di ' + QUIZ.length })]);
    box.appendChild(h('div', { style: 'font-size:1.25rem;font-weight:600;margin:0.4rem 0 0.8rem', text: q.text }));
    var first = null;
    q.options.forEach(function (o) {
      var el = V.focusable(h('div', { class: 'opt', text: o[0] }), function () {
        answers[q.key] = o[1];
        quizStep(i + 1, answers);
      });
      if (!first) first = el;
      box.appendChild(el);
    });
    box.appendChild(h('div', { class: 'hint', text: 'OK per scegliere · Indietro per chiudere' }));
    openModal(box, first);
  }

  function quizResults(answers) {
    var box = h('div', { class: 'dialog' }, [h('h3', { text: 'Cosa guardo?' }), h('div', { class: 'sub', text: 'I nostri consigli' })]);
    if (A.loading.movies || A.loading.series) {
      box.appendChild(h('div', { class: 'muted', style: 'margin:1rem 0', text: 'Cerco qualcosa per te…' }));
      openModal(box);
      setTimeout(function () { if (modal.classList.contains('open') && modal.contains(box)) quizResults(answers); }, 700);
      return;
    }
    var r = recommend(answers);
    if (r.note) box.appendChild(h('div', { class: 'muted', style: 'margin-bottom:0.6rem', text: r.note }));
    var list = h('div', { class: 'scroll', style: 'max-height:28rem' });
    var first = null;
    r.picks.forEach(function (it) {
      var el = V.focusable(h('div', { class: 'opt' }, [
        h('div', { class: 'thumb poster' }, u.art(it.poster || it.cover, it.initials)),
        h('div', { class: 'grow' }, [
          h('div', { class: 't ellipsis', style: 'font-weight:600', text: it.name }),
          h('div', { class: 'dim', text: u.joinMeta(it.kind === 'movie' ? 'Film' : 'Serie TV', it.meta) }),
        ]),
      ]), function () { A.modalReturn = null; closeModal(); openItem(it); });
      if (!first) first = el;
      list.appendChild(el);
    });
    box.appendChild(list);
    var more = V.focusable(h('div', { class: 'btn primary small', text: 'Altri consigli' }), function () { quizResults(answers); });
    box.appendChild(h('div', { style: 'margin-top:0.8rem' }, [
      more,
      V.focusable(h('div', { class: 'btn small', text: 'Ricomincia' }), function () { quizStep(0, {}); }),
    ]));
    openModal(box, first || more);
  }

  function recommend(answers) {
    var type = answers.type || 'any', mood = answers.mood || 'any', period = answers.period || 'any', top = answers.rating === 'top';
    function names(l) { var o = {}; if (l) l.cats.forEach(function (c) { o[c.id] = c.name; }); return o; }
    function yearOf(y) { return parseInt(String(y || '').slice(0, 4), 10) || 0; }
    var vodNames = names(A.movies), seriesNames = names(A.series);
    var pool = [];
    // Solo titoli nuovi: niente film già visti o iniziati, niente serie già aperte.
    if (type !== 'series' && A.movies) A.movies.items.forEach(function (m) {
      if (Pos.progress(m.posKey) === 0) pool.push({ it: m, text: u.normalize(vodNames[m.categoryId] || ''), year: yearOf(m.year), rating: m.rating || 0 });
    });
    if (type !== 'movie' && A.series) A.series.items.forEach(function (s) {
      if (!Pos.lastEpisode(s.seriesId)) pool.push({ it: s, text: u.normalize((seriesNames[s.categoryId] || '') + ' ' + (s.genre || '')), year: yearOf(s.year), rating: s.rating || 0 });
    });
    if (!pool.length) return { picks: [], note: 'Il catalogo non è ancora disponibile: riprova tra poco.' };

    var now = new Date().getFullYear();
    var maxRating = Math.max.apply(null, pool.map(function (c) { return c.rating; }));
    function moodOk(c) { return mood === 'any' || MOOD_WORDS[mood].some(function (w) { return c.text.indexOf(w) >= 0; }); }
    function periodOk(c) {
      if (period === 'recent') return c.year >= now - 3;
      if (period === '2000s') return c.year >= 2000 && c.year < now - 3;
      if (period === 'classic') return c.year > 1900 && c.year < 2000;
      return true;
    }
    function ratingOk(c) { return !top || maxRating <= 0 || c.rating >= maxRating * 0.7; }

    // Se nessun titolo soddisfa tutte le risposte si rinuncia prima al voto, poi al periodo, poi al genere.
    var note = null;
    var picks = pool.filter(function (c) { return moodOk(c) && periodOk(c) && ratingOk(c); });
    if (!picks.length) { picks = pool.filter(function (c) { return moodOk(c) && periodOk(c); }); note = 'Nessun titolo con tutte le risposte: ecco i più vicini.'; }
    if (!picks.length) picks = pool.filter(moodOk);
    if (!picks.length) { picks = pool; note = 'Nel catalogo non ho trovato quel genere: ecco qualcosa da scoprire.'; }

    // Un po' di caso, ma i titoli più votati hanno più probabilità di uscire.
    picks = picks.map(function (c) { return { c: c, s: (c.rating > 0 ? c.rating : maxRating * 0.4) * (0.5 + Math.random()) }; })
      .sort(function (a, b) { return b.s - a.s; });
    var seen = {}, out = [];
    for (var i = 0; i < picks.length && out.length < 6; i++) {
      var k = u.variantKey(picks[i].c.it.name);
      if (seen[k]) continue;
      seen[k] = true;
      out.push(picks[i].c.it);
    }
    return { picks: out, note: note };
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
    A.live.items.forEach(function (c) { if (c.streamId === id || (c.alternates || []).indexOf(id) >= 0) ch = c; });
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
    var fmt = S.get('outputFormat');
    Player.play(A.client.liveUrl(ch.streamId, fmt), true, 0,
      (ch.alternates || []).map(function (id) { return A.client.liveUrl(id, fmt); }));
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
      if (Pos.update(p.kind === 'movie' ? p.movie.posKey : p.episode.posKey, Player.position(), Player.duration())) leaveMyListIfFinished(p);
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
    if (p.kind === 'movie') { Pos.markWatched(p.movie.posKey); leaveMyListIfFinished(p); Pos.save(); leavePlayer(); return; }
    Pos.markWatched(p.episode.posKey);
    leaveMyListIfFinished(p);
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
    // Server di casa: le modifiche fatte qui partono, quelle degli altri dispositivi arrivano.
    if (ticks % 30 === 0 && Server.active()) Server.flush().then(function () { return Server.pull(); }).then(Server.loadNetwork);
  }, 1000);

  // Preferiti e posizioni arrivati dal server: si ridisegna, tranne durante la visione e la scrittura.
  Server.onState = function () {
    var typing = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (A.screen !== 'player' && A.screen !== 'server' && A.screen !== 'login' && !typing) render(true);
  };

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
        if (Date.now() - lastBackAt < 2500) IPTV.Platform.exit();
        else { lastBackAt = Date.now(); u.toast('Premi di nuovo Indietro per uscire'); }
        handled = true;
      }
    } else if (code === KEY.GREEN && Nav.current() && Nav.current().listItem) {
      // Tasto verde su un film o una serie: "Mia lista".
      toggleMyList(Nav.current().listItem);
      render(true);
      handled = true;
    } else if (code === KEY.RED) {
      // Tasto rosso su un canale: preferito.
      var cur = Nav.current();
      if (cur && cur.channel) {
        S.toggleFavorite(cur.channel.streamId);
        u.toast(S.isFavorite(cur.channel.streamId) ? cur.channel.name + ' aggiunto ai preferiti' : cur.channel.name + ' tolto dai preferiti');
        render(true);
        handled = true;
      } else if (cur && cur.continueEntry) {
        // Tasto rosso in "Continua a guardare": toglie il titolo dall'elenco.
        confirmRemoveContinue(cur.continueEntry);
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

  /** Avvisa se su GitHub c'è una versione più recente: sul TV si aggiorna reinstallando il pacchetto (.ipk LG, .wgt Samsung) dal PC. */
  function checkUpdates() {
    u.fetchTimeout('https://api.github.com/repos/carellice/IPTVISION/releases/latest', 15000).then(function (r) { return r.json(); }).then(function (rel) {
      if (!rel || rel.draft || rel.prerelease || !isNewer(rel.tag_name, IPTV.VERSION)) return;
      var ext = IPTV.Platform.ext;
      var hasPackage = (rel.assets || []).some(function (a) { return a.name.toLowerCase().slice(-ext.length) === ext; });
      if (!hasPackage) return;
      A.update = String(rel.tag_name).replace(/^v/i, '');
      u.toast('Disponibile IPTVISION ' + A.update + ': dettagli in Impostazioni');
    }).catch(function () { /* senza rete o GitHub non raggiungibile: si riprova al prossimo avvio */ });
  }

  // ---------- Avvio ----------

  var account = S.account();
  if (account) openAccount(account, S.get('autoPlayLast'));
  else render();
  if (Server.active()) Server.pull(true).then(Server.loadNetwork);
  if (S.get('autoCheckUpdates')) setTimeout(checkUpdates, 8000);
})();
