# IPTVISION nel browser e server di casa (CasaOS)

La versione web di IPTVISION, con le stesse schermate dell'app Android, da installare sul proprio
server di casa (CasaOS, Raspberry Pi o qualsiasi Linux con Docker). Fa due cose:

- **IPTVISION nel browser**: dal telefono, dal tablet o dal PC, anche installata come app.
  Ogni persona di casa ha il suo account, con il suo account IPTV, i suoi preferiti e il suo
  "Continua a guardare".
- **Server di casa per le app IPTVISION** di Android, Windows e dei TV LG e Samsung: collegate al
  server dalle loro impostazioni, liste, guida TV, canali, film, serie e download passano da casa.
  Il telefono o il TV diventano solo uno schermo: l'account IPTV vero resta sul server e non arriva
  mai sui dispositivi. Preferiti e posizioni di ripresa sono gli stessi ovunque.

> IPTVISION è solo un lettore e non contiene canali. Va usato con un servizio IPTV a cui si ha diritto di accedere.

## Installazione

Sul server CasaOS (via SSH o dal terminale web di CasaOS):

```bash
curl -fsSL https://raw.githubusercontent.com/carellice/IPTVISION/main/PWA/casaos/installa.sh | sudo bash
```

Lo script fa qualche domanda (cartella dei dati, porta, fuso orario, codice invito, come aprirla
dal telefono), prepara l'immagine Docker sul server (la prima volta qualche minuto, su un
Raspberry Pi anche 10-15) e mostra gli indirizzi da usare. IPTVISION compare tra le app della
dashboard di CasaOS. La porta predefinita è **8765**.

Rilanciando lo stesso comando si aggiorna mantenendo dati e impostazioni.

### Come raggiungerla

| Modo | Indirizzo | Per |
|---|---|---|
| Rete di casa | `http://IP-del-server:8765` | app IPTVISION di Android, Windows e TV; IPTVISION nel browser come sito |
| Tailscale (consigliato) | `https://server.tailnet.ts.net` (lo stampa l'installer) | anche fuori casa; il browser del telefono la installa come app |

Il browser installa una web app solo in HTTPS: per averla come app sul telefono serve Tailscale
(installalo prima dall'App Store di CasaOS e attiva *HTTPS Certificates* nella pagina DNS del
pannello Tailscale). Senza HTTPS IPTVISION funziona lo stesso, come sito.

Se hai già un reverse proxy o un Cloudflare Tunnel con HTTPS, scegli "Solo rete di casa" e punta
il proxy a `http://IP-del-server:8765`.

## Account

- Apri IPTVISION e tocca **Creane uno**. Se all'installazione hai lasciato il codice invito,
  serve anche quello (è in `/var/lib/casaos/apps/iptvision/.env`, riga `INVITE_CODE`).
- Al primo accesso inserisci il tuo account IPTV (server o link M3U, utente, password): viene
  controllato e salvato sul server. Il browser e le app non ricevono mai la password IPTV.
- In **Altro → Server di casa** vedi i dispositivi collegati al tuo account (browser e app) e puoi
  scollegarli.

## App IPTVISION collegate al server di casa

Su Android, Windows e TV LG/Samsung, in **Impostazioni → Server di casa → Collega il server**
(oppure, alla prima apertura, **Usa il server di casa**):

1. Indirizzo: dentro casa `192.168.1.10` (l'IP del server; se manca la porta l'app aggiunge
   `:8765` e `http://`), fuori casa l'indirizzo Tailscale `https://…ts.net`.
2. Nome utente e password dell'account del server (o crea l'account da lì, con il codice invito).
3. Se l'account del server non ha ancora un account IPTV, l'app gli passa quello che usava finora.
   Preferiti e posizioni del dispositivo si uniscono a quelli del server.

Da quel momento l'app usa il server come se fosse il pannello IPTV: nessuna altra differenza
nelle schermate. **Scollega il server** riporta l'app all'account IPTV di prima, direttamente dal
provider. Senza server raggiungibile l'app collegata non carica liste nuove né flussi: usa la
connessione di casa o Tailscale.

## Aggiornamenti

All'installazione si può attivare l'aggiornamento automatico notturno (verso le 4): il server
controlla su GitHub la versione in `PWA/server/package.json`, prepara la nuova immagine, salva una
copia dei database in `<dati>/backup/` (ne tiene 5) e, se la nuova versione non parte, torna da
sola a quella di prima. A mano:

```bash
sudo iptvision-aggiorna
```

`--controlla` dice solo se c'è una versione nuova, `--forza` ricostruisce anche se è la stessa.
Log: `journalctl -u iptvision-aggiorna`. Per spegnerli: `systemctl disable --now iptvision-aggiorna.timer`.

Le app native si aggiornano come sempre (release su GitHub): il server non serve aggiornarlo insieme.

## Differenze dall'app Android

| App Android | IPTVISION nel browser |
|---|---|
| ExoPlayer legge TS, HLS, MKV, AC3… | il server converte con ffmpeg: video copiato, audio in AAC (TS per la diretta, MP4 a frammenti per film ed episodi); i file MP4 già leggibili passano così come sono |
| Canali MPEG-2 del digitale terrestre | il browser non li decodifica: il server li ricodifica in H.264 (pesa sul processore del server) |
| Tracce audio | per film ed episodi sì (scelte sul server); per la diretta solo la prima |
| Sottotitoli | non disponibili |
| Download per guardare offline | non disponibili (restano nell'app Android e Windows, anche col server di casa) |
| Ricerca vocale | Web Speech API (Chrome, Edge, Safari) |
| Formato HLS per la diretta | non serve: il browser riceve sempre il flusso dal server |
| Un account sul telefono | account sul server, separati per ogni persona |
| iPhone | la diretta richiede iOS 17.1 o successivo (Managed Media Source) |

## Sviluppo

```bash
cd PWA/server && npm install && npm run dev        # API su :8080, dati in server/data
cd PWA/web && npm install && npm run dev           # Vite su :5173, inoltra /api al server
cd PWA/web && npm run build                        # tsc --noEmit && vite build → server/public
```

Serve `ffmpeg` (e `ffprobe`) nel PATH per guardare canali e film dal browser.
Il server gira con Node 24 senza compilazione (type stripping) e non ha dipendenze npm.

| Cartella | Contenuto |
|---|---|
| `shared/` | modello, testi, regole delle posizioni, guida, "Cosa guardo?": usati da server e browser |
| `server/` | account, preferiti e posizioni in SQLite (un file per account), liste e guida dal provider, flussi per il browser (`play.ts`), API Xtream per le app (`relay.ts`) |
| `web/` | React + Vite, una schermata per ogni schermata dell'app Android (vedi `PORTING.md`) |
| `casaos/` | `installa.sh` e `aggiorna.sh` |

**Rilascio**: cambia `version` in `PWA/server/package.json` e fai push su `main`. Senza il cambio
di versione i server non si aggiornano.
