# IPTVISION per iPhone e iPad

App nativa (SwiftUI + libVLC) per iPhone e iPad. Per compilarla e installarla **non servono un Mac né un account sviluppatore a pagamento**:

- l'app la compila una GitHub Action su un Mac di GitHub e la pubblica come `IPTVISION.ipa` non firmato;
- chi la vuole usare la firma e la installa da **Windows** con il **proprio Apple ID gratuito**, usando `installa-iphone.bat`.

> IPTVISION è solo un lettore e non contiene canali. Va usato con un servizio IPTV a cui si ha diritto di accedere.

## Cosa fa

- **TV in diretta**: categorie, Preferiti (tieni premuto un canale o scorri a sinistra), programma in onda con barra di avanzamento. Nel player scorri a sinistra o a destra per cambiare canale. Se il flusso si interrompe, riparte da solo.
- **Film e serie**: locandine, categorie, ordinamento (nome, anno, voto, aggiunti di recente) e ricerca dentro la categoria. Ci sono anche **Continua a guardare** e **La mia lista**.
- Riprende film ed episodi da dove eri rimasto e segna gli episodi visti. A fine episodio il successivo parte dopo 10 secondi, e puoi annullarlo.
- Se lo stesso titolo è pubblicato più volte (FHD, 4K…) compare una volta sola con "N versioni", e nel dettaglio scegli quale guardare.
- **Ricerca** su canali, film e serie, con **Nascondi XXX**.
- **Più liste IPTV** salvate, con la data di scadenza dell'abbonamento.
- **Server di casa** (IPTVISION su CasaOS): canali, film e serie passano dal server, l'account IPTV resta lì, e preferiti, "Continua a guardare" e "La mia lista" sono gli stessi su ogni dispositivo. Vedi sotto.
- Player libVLC: legge MKV, TS, AC3/DTS e gli altri formati che il player di sistema rifiuta. Puoi scegliere audio e sottotitoli e allargare l'immagine a tutto schermo. L'audio continua anche a schermo bloccato.
- Layout adattivo per iPhone e iPad, in verticale e in orizzontale.

Rispetto alla versione Android **non ci sono** download offline, guida TV completa (XMLTV: si usa solo la guida breve per canale) e aggiornamento automatico. Per aggiornare l'app si usa di nuovo il `.bat`.

## Installare l'app (per chi la usa)

### Cosa serve

- un PC con **Windows 10 o 11**;
- un **iPhone o iPad** con iOS 16 o successivo e il **cavo USB**;
- un **Apple ID** (va bene quello di sempre, oppure uno creato apposta e gratuito su [account.apple.com](https://account.apple.com)).

### Passo per passo

1. Apri la [release "ios"](https://github.com/carellice/IPTVISION/releases/tag/ios) e scarica **`installa-iphone.bat`**.
2. Fai doppio clic sul file. Se Windows mostra "Windows ha protetto il PC", clicca **Ulteriori informazioni**, poi **Esegui comunque**.
3. Scegli **1** e segui le istruzioni a schermo. Il file:
   1. controlla i driver Apple e, se mancano, propone di installare **iTunes**;
   2. scarica lo strumento di firma e l'ultima versione di IPTVISION;
   3. chiede Apple ID, password (non si vede mentre la scrivi) e il **codice di verifica** che Apple manda ai tuoi dispositivi. Solo la prima volta;
   4. ti chiede di collegare e sbloccare il dispositivo, poi firma e installa l'app.
4. Solo la prima volta, sull'iPhone o iPad:
   - **Impostazioni → Generali → VPN e gestione dispositivi**: tocca il tuo Apple ID e poi **Autorizza**;
   - **Impostazioni → Privacy e sicurezza → Modalità sviluppatore**: attivala, riavvia e conferma.

### Ogni 7 giorni

Con un Apple ID gratuito Apple fa durare la firma **7 giorni**: dopo, l'app non si apre più. Per rinnovarla riapri `installa-iphone.bat` e scegli **1**: si scarica anche l'ultima versione dell'app. Liste, preferiti e "Continua a guardare" restano salvati.

Per non doverci pensare puoi usare **Impactor**, lo stesso strumento ma con interfaccia grafica ([download](https://github.com/khcrysalis/Impactor/releases/latest)). Con l'opzione di aggiornamento automatico rinnova la firma da solo via Wi-Fi, se il PC è acceso. Trascina dentro `IPTVISION.ipa`, che trovi nella [release "ios"](https://github.com/carellice/IPTVISION/releases/tag/ios).

### Se qualcosa non va

| Problema | Soluzione |
|---|---|
| "Mancano i driver Apple" anche dopo aver installato iTunes | Riavvia il PC. |
| Il dispositivo non viene trovato | Usa un cavo dati, sblocca il dispositivo e tocca **Autorizza** su "Vuoi autorizzare questo computer?". |
| Errore di accesso o di sessione | Nel menu scegli **2** (Cambia Apple ID) e accedi di nuovo. |
| Errore sul numero di app | Un Apple ID gratuito può avere **3 app** firmate così su un dispositivo e registrarne **10 a settimana**. Elimina quelle che non usi o aspetta qualche giorno. |
| L'app si chiude appena aperta | La firma è scaduta (7 giorni): riapri il `.bat` e scegli **1**. |

### Server di casa

Se hai IPTVISION installato su CasaOS ([PWA/README.md](../PWA/README.md)):

1. Al primo avvio tocca **Usa il server di casa**. Se l'app è già configurata, vai in **Impostazioni → Server di casa → Collega il server**.
2. Inserisci l'indirizzo del server. Dentro casa basta l'IP, per esempio `192.168.1.10`: la porta 8765 si aggiunge da sola. Fuori casa usa l'indirizzo Tailscale (`https://…ts.net`).
3. Accedi con l'account del server, oppure creane uno (con il codice invito, se il server lo chiede).

Al collegamento, preferiti e posizioni salvati sull'iPhone si uniscono a quelli del server. Le liste IPTV del dispositivo si aggiungono a quelle del server. Poi l'app si sincronizza ogni 30 secondi. Cambiare lista dalle impostazioni la cambia per tutti i dispositivi. **Scollega il server** fa tornare l'app all'account IPTV di prima.

### Privacy

Email e password vanno solo ai server di Apple, tramite [plumesign](https://github.com/khcrysalis/Impactor), lo strumento a riga di comando di Impactor (open source, licenza MIT). Sul PC, in `%APPDATA%\PlumeImpactor`, resta un accesso salvato, non la password. Lo strumento e l'app vengono scaricati in `%LOCALAPPDATA%\IPTVISION-iOS`. Per togliere tutto basta cancellare le due cartelle.

## Compilare l'app (per chi la sviluppa)

### Struttura

```
ios/
├── project.yml            progetto Xcode (lo genera XcodeGen nella GitHub Action)
├── Podfile                libVLC (MobileVLCKit) via CocoaPods
├── installa-iphone.bat    installazione guidata da Windows
└── IPTVISION/
    ├── App.swift          avvio, tema, componenti comuni
    ├── Models.swift       canali, film, serie, episodi, testo e "versioni"
    ├── Xtream.swift       client player_api.php
    ├── ServerApi.swift    client del server di casa (/api/...)
    ├── ServerView.swift   collegamento al server di casa
    ├── Store.swift        impostazioni e punti di ripresa
    ├── AppModel.swift     stato dell'app, liste, ordinamento, riproduzione
    ├── Player.swift       libVLC
    ├── PlayerView.swift   schermata di riproduzione
    ├── HomeView.swift     schede e TV in diretta
    ├── LibraryViews.swift film, serie e dettagli
    ├── SearchSettings.swift ricerca e impostazioni
    └── LoginView.swift    accesso e nuove liste
```

Il file `.xcodeproj` non è nel repository: lo genera [XcodeGen](https://github.com/yonaskolb/XcodeGen) da `project.yml`. Per aggiungere un file Swift basta crearlo in `ios/IPTVISION/`.

### Compilazione con GitHub Actions

Il workflow [`.github/workflows/ios.yml`](../.github/workflows/ios.yml) parte:

- **da solo** a ogni push su `main` che modifica `ios/`;
- **a mano** da GitHub, con **Actions → App iOS (.ipa) → Run workflow**, oppure dal terminale:

```bash
gh workflow run ios.yml
```

```bash
gh run watch
```

Il risultato:

- `IPTVISION.ipa` tra gli **artifact** dell'esecuzione;
- su `main`, `IPTVISION.ipa` e `installa-iphone.bat` caricati nella release fissa **[`ios`](https://github.com/carellice/IPTVISION/releases/tag/ios)**. La release è segnata come pre-release, quindi non cambia l'"ultima versione" delle altre app. Il `.bat` scarica sempre da qui.

Se la compilazione fallisce, il log completo è nell'artifact `build-log`.

### Versione

`MARKETING_VERSION` in `project.yml` è la versione mostrata nelle Impostazioni. Il numero di build è il numero dell'esecuzione della GitHub Action.
