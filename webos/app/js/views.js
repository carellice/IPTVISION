/* Pezzi di interfaccia riusati dalle schermate: categorie, righe e riquadri di canali, film e serie. */
(function () {
  'use strict';
  var u = IPTV.u, h = u.h;

  /** Rende un elemento navigabile col telecomando. */
  function focusable(el, onActivate, onFocus) {
    el.classList.add('f');
    el.onActivate = onActivate;
    if (onFocus) el.onFocus = onFocus;
    el.addEventListener('click', function () { IPTV.Nav.focus(el, true); if (onActivate) onActivate(); });
    return el;
  }

  function categoryTile(c, onOpen) {
    var iconClass = c.id === '__fav' ? 'icon star' : c.id === '__continue' ? 'icon cont' : 'icon';
    var icon = c.id === '__fav' ? '★' : c.id === '__continue' ? '↻' : c.id === '__all' ? '▦' : '▢';
    return focusable(h('div', { class: 'cat', data: { id: c.id } }, [
      h('div', { class: iconClass, text: icon }),
      h('div', { class: 'count', text: String(c.count) }),
      h('div', { class: 'name ellipsis', text: c.name }),
    ]), onOpen);
  }

  function channelRow(ch, opts) {
    var sub = h('div', { class: 's ellipsis', text: opts.now || '' });
    var el = h('div', { class: 'item flat' + (opts.current ? ' current' : '') }, [
      h('div', { class: 'thumb' }, u.art(ch.logo, ch.initials)),
      h('div', { class: 'grow' }, [
        h('div', { class: 'row' }, [ch.num > 0 ? h('span', { class: 'num', text: String(ch.num) }) : null, h('span', { class: 't ellipsis', text: ch.name })]),
        sub,
      ]),
      opts.favorite ? h('span', { class: 'star', text: '★' }) : null,
    ]);
    el.setNow = function (text) { sub.textContent = text || ''; };
    return focusable(el, opts.onOpen, opts.onFocus);
  }

  function channelCard(ch, opts) {
    var sub = h('div', { class: 'meta', text: opts.now || ' ' });
    var el = h('div', { class: 'card wide' + (opts.current ? ' current' : '') }, [
      h('div', { class: 'art' }, u.art(ch.logo, ch.initials).concat(opts.favorite ? [h('span', { class: 'badge on-art', text: '★' })] : [])),
      h('div', { class: 'name', text: (ch.num > 0 ? ch.num + '  ' : '') + ch.name }),
      sub,
    ]);
    el.setNow = function (text) { sub.textContent = text || ' '; };
    return focusable(el, opts.onOpen, opts.onFocus);
  }

  /** Film o serie in vista elenco: locandina piccola, titolo, dati, versioni, avanzamento. */
  function mediaRow(it, opts) {
    var badges = [];
    if (opts.versions) badges.push(h('span', { class: 'badge', text: opts.versions }));
    if (opts.progress >= 1) badges.push(h('span', { class: 'badge q', text: 'Visto' }));
    return focusable(h('div', { class: 'item flat' }, [
      h('div', { class: 'thumb poster' }, u.art(it.poster || it.cover, it.initials)),
      h('div', { class: 'grow' }, [
        h('div', { class: 't ellipsis', text: it.name }),
        h('div', { class: 's ellipsis', text: it.meta }),
        badges.length ? h('div', { style: 'margin-top:0.35rem' }, badges) : null,
        opts.progress > 0 && opts.progress < 1 ? h('div', { style: 'width:10rem' }, u.progressBar(opts.progress)) : null,
      ]),
    ]), opts.onOpen, opts.onFocus);
  }

  function mediaCard(it, opts) {
    var extra = [];
    if (opts.versions) extra.push(h('span', { class: 'badge on-art', text: opts.versions }));
    else if (opts.progress >= 1) extra.push(h('span', { class: 'badge q on-art', text: 'Visto' }));
    if (opts.progress > 0 && opts.progress < 1) extra.push(u.progressBar(opts.progress));
    return focusable(h('div', { class: 'card' }, [
      h('div', { class: 'art' }, u.art(it.poster || it.cover, it.initials).concat(extra)),
      h('div', { class: 'name', text: it.name }),
      h('div', { class: 'meta', text: it.meta }),
    ]), opts.onOpen, opts.onFocus);
  }

  /**
   * Elenchi lunghi (anche decine di migliaia di film): si disegnano a blocchi,
   * il blocco successivo quando il focus si avvicina alla fine.
   */
  function lazyList(container, items, build, batch) {
    batch = batch || 60;
    var shown = 0;
    function more() {
      var end = Math.min(items.length, shown + batch);
      var frag = document.createDocumentFragment();
      for (var i = shown; i < end; i++) {
        (function (index) {
          var el = build(items[index], index);
          var prev = el.onFocus;
          el.onFocus = function () {
            if (index >= shown - 12 && shown < items.length) more();
            if (prev) prev();
          };
          frag.appendChild(el);
        })(i);
      }
      shown = end;
      container.appendChild(frag);
    }
    more();
    return {
      /** Disegna fino all'elemento indicato (per riprendere il focus da lì). */
      ensure: function (index) { while (shown <= index && shown < items.length) more(); return container.children[index]; },
    };
  }

  IPTV.V = {
    focusable: focusable, categoryTile: categoryTile, channelRow: channelRow, channelCard: channelCard,
    mediaRow: mediaRow, mediaCard: mediaCard, lazyList: lazyList,
  };
})();
