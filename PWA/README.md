# IPTVISION web (PWA) per CasaOS

IPTVISION per telefono e PC, nel browser: TV in diretta con guida TV, film e serie da un account Xtream Codes.
Aspetto, schermate e funzioni sono quelle dell'app Android. Gira sul tuo server di casa (CasaOS, Raspberry Pi,
qualsiasi Linux con Docker) e si installa sul telefono come un'app.

Ogni persona di casa ha il suo account IPTVISION, con il suo accesso IPTV, i suoi preferiti e il suo
Continua a guardare. Preferiti e posizioni seguono l'account: inizi un film sul telefono e lo riprendi dal PC.

> IPTVISION è solo un lettore e non contiene canali. Va usato con un servizio IPTV a cui si ha diritto di accedere.

## Installazione

Sul server, da terminale (o dal terminale di CasaOS):

```bash
curl -fsSL https://raw.githubusercontent.com/carellice/IPTVISION/main/PWA/casaos/installa.sh | sudo bash
```

Lo script fa tutto da solo e chiede solo poche cose:

1. **Cartella dei dati** (su CasaOS `/DATA/AppData/iptvision`).
2. **Porta** (8096 se libera).
3. **Codice invito**: serve per creare un account. Dallo solo a chi vuoi far entrare.
4. **Come aprirla dal telefono in HTTPS** (serve per installarla come app e per la ricerca vocale):
   - **Tailscale** (consigliato): HTTPS vero, funziona anche fuori casa e solo per i tuoi dispositivi.
     In Tailscale vanno attivati MagicDNS e i certificati HTTPS (pannello Tailscale → DNS → HTTPS Certificates).
   - **HTTPS in casa**: il server crea un suo certificato; su ogni telefono lo installi una volta da `http://<server>:8096/certificato`.
   - **Solo HTTP**: se hai già un reverse proxy o un Cloudflare Tunnel con HTTPS davanti.
5. **Aggiornamento automatico ogni notte** (consigliato).

Alla fine lo script scrive gli indirizzi da aprire. IPTVISION compare anche nella dashboard di CasaOS.

Poi:

1. Apri l'indirizzo sul telefono e tocca **Prima volta qui? Crea un account** (con il codice invito).
2. Inserisci server, utente e password del servizio IPTV, oppure incolla il link M3U completo, come nell'app.
3. Installala come app: Android (Chrome) menu ⋮ → **Installa app**; iPhone (Safari) **Condividi → Aggiungi alla schermata Home**.

## Aggiornamenti

Ogni notte verso le 4 il server controlla su GitHub se c'è una versione nuova. Se c'è, la prepara accanto a
quella in uso, fa una copia dei dati in `<cartella dati>/backup/` (tiene le ultime 5) e passa alla nuova.
Se la nuova non parte, torna da sola a quella di prima.

```bash
sudo iptvision-aggiorna             # aggiorna subito
sudo iptvision-aggiorna --controlla # dice solo se c'è una versione nuova
journalctl -u iptvision-aggiorna    # cosa è successo le ultime notti
```

L'app nel telefono si allinea al server alla riapertura; in **Altro → Aggiornamenti** c'è anche **Controlla ora**.

## Come passano i video

Il fornitore IPTV di solito risponde in HTTP e senza CORS: una pagina HTTPS non potrebbe aprirlo. Per questo
tutti i flussi passano dal server, che tiene anche le credenziali IPTV (il browser non le vede mai).

- **TV in diretta**: arriva al browser in MPEG-TS e la legge [mpegts.js](https://github.com/xqq/mpegts.js).
  Con **Converti l'audio della TV in diretta** (attivo di base) ffmpeg copia il video così com'è e converte solo
  l'audio in AAC: l'audio MP2 o AC3 dei canali del digitale nel browser non si sentirebbe. Con il formato HLS
  la conversione è sempre attiva.
- **Film ed episodi**: il server li esamina con ffprobe. MP4 e WebM con codifiche che il browser conosce
  arrivano così come sono (si può saltare avanti e indietro senza attese). Gli altri (MKV, AVI, audio AC3/DTS)
  li rimonta ffmpeg in MP4 al volo: il video si copia, solo l'audio si converte. Saltare in un punto riapre il
  flusso da lì. Le tracce audio si scelgono da **Audio e sottotitoli**.
- Molti servizi accettano **una connessione per account**: ogni utente di IPTVISION ha al massimo un flusso aperto
  verso il fornitore, e cambiare canale chiude subito quello di prima.

ffmpeg converte quasi solo audio, quindi basta anche un Raspberry Pi 4. Un video in un formato che il browser
non conosce (per esempio XviD) va invece ricodificato, e su un Raspberry Pi può non stare al passo.

## Differenze dall'app Android

| App Android | IPTVISION web |
|---|---|
| Dati sul telefono | Sul server, per account: preferiti e Continua a guardare uguali su tutti i dispositivi |
| Elenco/griglia, ordinamento, Nascondi XXX, formato HLS | Per dispositivo, come sul telefono |
| ExoPlayer legge tutto | MKV e audio AC3/MP2 passano da ffmpeg sul server (vedi sopra) |
| Sottotitoli dei film | Non disponibili: servirebbe una seconda connessione al fornitore |
| Deinterlacciamento | Non disponibile nel browser |
| Download per guardare offline | Non disponibile |
| Ricerca vocale di Google | Ricerca vocale del browser (Chrome, Edge, Safari); su Firefox non c'è |
| Orizzontale a schermo intero nel player | Sì sul telefono; sul PC pulsante schermo intero o tasto F |
| Picture-in-picture | Pulsante nella barra in alto del player |
| Telecomando di Android TV | Tastiera del PC: frecce, Invio, Spazio, numeri, I, F, Esc |
| Aggiornamento dall'APK | Il server si aggiorna da solo ogni notte |

Su iPhone la TV in diretta richiede iOS 17.1 o successivo (Media Source Extensions in Safari; non ancora provato su un iPhone vero).

## Dati e copie

Nella cartella dei dati:

- `accounts.db`: account IPTVISION e sessioni (password cifrate con scrypt);
- `users/<n>/iptvision.db`: accesso IPTV, preferiti, posizioni, episodi visti di un account;
- `users/<n>/cache/`: liste e guida TV scaricate dal fornitore (si possono cancellare: **Altro → Svuota cache**);
- `backup/`: copie fatte prima di ogni aggiornamento;
- `certs/`: certificati della modalità HTTPS in casa.

Per spostare IPTVISION su un altro server basta copiare questa cartella e rilanciare lo script.

## Sviluppo

Serve Node 24 (e ffmpeg nel PATH per provare la conversione).

```bash
cd PWA/server && npm install && npm run dev        # API su :8080, dati in server/data
cd PWA/web && npm install && npm run dev           # Vite su :5173, inoltra /api a :8080
cd PWA/web && npm run build                        # controllo dei tipi e build in server/public
```

Variabili del server: `PORT` (8080), `HTTPS_PORT` (8443), `DATA_DIR`, `INVITE_CODE` (vuoto = registrazione libera),
`FFMPEG_PATH`, `FFPROBE_PATH`.

`PORTING.md` elenca ogni schermata e regola dell'app Android con il file web che la riproduce.

**Pubblicare una versione:** aumenta `version` in `server/package.json` (e in `server/package-lock.json`) e fai push su `main`.
Senza aumento di versione i server non si aggiornano; con l'aumento si aggiornano la notte successiva.
