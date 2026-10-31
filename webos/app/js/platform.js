/*
 * Su quale TV gira l'app: LG (webOS) o Samsung (Tizen). Il codice è lo stesso per entrambi;
 * cambiano solo i codici di alcuni tasti, come si chiude l'app e il pacchetto da installare.
 */
(function () {
  'use strict';

  var tz = window.tizen;
  var tizen = !!(tz && tz.tvinputdevice);

  // Su Tizen i tasti multimediali, i colori, i canali e i numeri arrivano all'app solo se li si registra.
  var KEYS = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
    'ChannelUp', 'ChannelDown', 'ColorF0Red', 'Info', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  if (tizen) {
    KEYS.forEach(function (k) {
      try { tz.tvinputdevice.registerKey(k); } catch (e) { /* tasto che questo telecomando non ha */ }
    });
  }

  /** Codice del tasto Tizen con quel nome, o quello di riserva se il TV non lo conosce. */
  function code(name, fallback) {
    if (!tizen) return fallback;
    try { return tz.tvinputdevice.getKey(name).code || fallback; } catch (e) { return fallback; }
  }

  /*
   * Ricerca vocale sui TV Samsung (Tizen 6.0 e successivi): tenendo premuto il tasto microfono e
   * dicendo il titolo, il TV passa all'app il testo riconosciuto (VoiceInteraction API).
   * L'app imposta voice.onSearch e voice.state; sugli altri TV non succede nulla.
   */
  var voice = { onSearch: null, state: function () { return 'Home'; }, samsung: false };
  var vi = tizen && window.webapis && window.webapis.voiceinteraction;
  if (vi) {
    var field = function (term, name) {
      try { return (vi.getDataFromSearchTerm(term, name) || '').trim(); } catch (e) { return ''; }
    };
    try {
      vi.setCallback({
        onupdatestate: function () { return voice.state(); },
        onsearch: function (term) {
          var text = field(term, 'SEARCH_TERM_TITLE') || field(term, 'SEARCH_TERM_UTTERANCE');
          // "Cerca Matrix" → "Matrix"
          text = text.replace(/^(cerca|trova|search)\s+/i, '');
          if (!text || !voice.onSearch) return false;
          voice.onSearch(text);
          return true;
        },
      });
      vi.listen();
      voice.samsung = true;
    } catch (e) { /* TV precedente a Tizen 6.0 o permesso mancante: resta la dettatura della tastiera */ }
  }

  IPTV.Platform = {
    voice: voice,
    tizen: tizen,
    /** Marca del TV, per i testi. */
    brand: tizen ? 'Samsung' : 'LG',
    /** Estensione del pacchetto da installare sul TV. */
    ext: tizen ? '.wgt' : '.ipk',
    code: code,
    exit: function () {
      if (tizen) {
        try { tz.application.getCurrentApplication().exit(); return; } catch (e) { /* si prova window.close */ }
      }
      window.close();
    },
  };
})();
