<div align="center">

<img src="src/IPTVISION/Assets/logo.png" width="96" alt="Logo IPTVISION" />

# IPTVISION

**Lettore IPTV per Windows: leggero e veloce, pensato per guardare la TV dal PC o dal divano.**

TV in diretta, film e serie da un account Xtream Codes, con guida TV, ricerca vocale e una modalità TV da usare con controller o telecomando.

[![Ultima versione](https://img.shields.io/github/v/release/carellice/IPTVISION?label=versione&color=3D7BFF)](https://github.com/carellice/IPTVISION/releases/latest)
[![Download](https://img.shields.io/github/downloads/carellice/IPTVISION/total?label=download&color=00C2FF)](https://github.com/carellice/IPTVISION/releases)
![Windows 10/11](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4)
![.NET 8](https://img.shields.io/badge/.NET-8-512BD4)

### [⬇ Scarica l'ultima versione](https://github.com/carellice/IPTVISION/releases/latest)

<img src="docs/screenshots/principale.png" alt="Finestra principale di IPTVISION" />

</div>

---

## Perché IPTVISION

Molti guardano i canali del digitale terrestre in streaming perché non hanno l'antenna collegata alla TV. IPTVISION serve proprio a questo: apri il programma e il canale riparte da dov'eri rimasto. Cambi canale con le frecce e la riproduzione si riprende da sola se la connessione salta.

- **Fluido:** motore video libVLC con decodifica hardware. Mentre guarda, il programma usa circa l'1–2% della CPU.
- **Affidabile:** se un flusso si blocca o si interrompe, IPTVISION lo riapre in automatico, aspettando un po' di più a ogni tentativo.
- **Semplice:** inserisci server, utente e password, oppure incolla il link M3U, e la lista è pronta.

> IPTVISION è solo un lettore e non contiene canali. Va usato con un servizio IPTV a cui si ha diritto di accedere.

## Funzioni

### 📺 TV in diretta
- Prima scegli la categoria, poi il canale. Ci sono anche i Preferiti e l'elenco Tutti.
- La guida TV indica il programma in onda e il successivo, con una barra di avanzamento. La guida viene da `xmltv.php`, oppure da `get_short_epg` se la prima non c'è.
- Cambi canale con le frecce, con PagSu/PagGiù o digitando il numero. Backspace torna al canale visto prima.
- Le righe tipiche dei canali 576i/1080i del digitale vengono tolte in automatico (deinterlacciamento).
- La lista canali è salvata sul PC: anche se il server è lento all'avvio, la visione parte subito.

### 🎬 Film e serie TV
- Locandine, categorie, anno e voto.
- Se interrompi un film o un episodio, la volta dopo riparte da lì. La sezione **Continua a guardare** raccoglie tutto quello che hai lasciato a metà.
- Per le serie: stagioni ed episodi, con quelli già visti segnati. Alla fine di un episodio parte il successivo dopo 10 secondi, e puoi annullarlo.

### 🔎 Ricerca unica, anche a voce
Cerca insieme tra canali, film e serie: i risultati sono raggruppati per tipo e non serve scrivere gli accenti. Il pulsante 🎤 o **Ctrl+M** attiva la digitazione vocale di Windows, che capisce l'italiano.

<img src="docs/screenshots/ricerca.png" alt="Ricerca unica" />

### 🛋️ Modalità TV
Un'interfaccia a schermo intero, ispirata a Steam Big Picture, da usare dal divano. La attivi con **Ctrl+T** o dalle Impostazioni, dove puoi anche far partire IPTVISION direttamente così.

- Riquadri grandi, orologio e una legenda dei comandi sempre visibile.
- Si usa con le sole **frecce, Invio ed Esc**, quindi anche con un telecomando per PC.
- Funziona con i **controller Xbox** e con quelli compatibili XInput.

<img src="docs/screenshots/modalita-tv.png" alt="Modalità TV" />

| Controller | Tastiera / telecomando | Azione |
|---|---|---|
| Croce, levetta | Frecce | Muoversi |
| A | Invio | OK, apri |
| B, Back | Esc, Backspace | Indietro |
| X | Spazio | Pausa |
| Y | I | Info |
| LB / RB | PagGiù / PagSu | Sezione; mentre guardi, canale o episodio |
| LT / RT | − / + | Volume |
| Start | Menu | Torna alla visione |

### 🔄 Aggiornamenti automatici
All'avvio IPTVISION controlla se è uscita una nuova versione. Se c'è, la trovi in **Impostazioni → Aggiornamenti**: un clic la scarica e la installa, e il programma si riapre da solo. Account, preferiti e posizioni di visione restano dove sono.

## Installazione

1. Scarica `IPTVISION-Setup-x.y.z.exe` dalle [release](https://github.com/carellice/IPTVISION/releases/latest).
2. Avvialo. Non servono permessi di amministratore e non bisogna installare .NET.
3. Apri IPTVISION e inserisci i dati del tuo account Xtream Codes, oppure incolla il link M3U completo.

Il programma si installa in `%LOCALAPPDATA%\Programs\IPTVISION` e funziona su Windows 10 e 11 a 64 bit.

## Scorciatoie da tastiera

| Tasto | Azione |
|---|---|
| Ctrl+1 / 2 / 3 | Sezione TV / Film / Serie TV |
| ↑ / ↓, PagSu / PagGiù | TV: canale successivo / precedente |
| 0–9 | Vai al canale per numero |
| Backspace | Canale visto prima; da film/serie torna alla TV |
| ← / →, rotella | TV: volume |
| ← / → (Shift: 1 min) | Film/episodi: indietro / avanti 10 s |
| ↑ / ↓ | Film/episodi: volume |
| PagSu / PagGiù, N | Episodio successivo / precedente |
| Home | Film/episodi: ricomincia dall'inizio |
| M | Muto |
| F, F11, doppio clic | Schermo intero (Esc per uscire) |
| L | Mostra/nascondi lista |
| I | Info programma |
| P | Preferito |
| R, F5 | Ricarica canale |
| Spazio | TV: avvia/ferma · film: pausa |
| Ctrl+F / Ctrl+R | Cerca / aggiorna lista |
| Ctrl+M | Ricerca vocale |
| Ctrl+T | Entra/esci dalla modalità TV |

## Dati e privacy

- La password è cifrata con DPAPI di Windows: può leggerla solo il tuo utente Windows.
- Impostazioni: `%APPDATA%\IPTVISION\settings.json`
- Posizioni di ripresa ed episodi visti: `%APPDATA%\IPTVISION\positions.json`
- Cache di canali, film, serie, guida TV e loghi, e il log: `%LOCALAPPDATA%\IPTVISION\`
- IPTVISION non raccoglie statistiche. Si collega solo al tuo server IPTV e a GitHub, per controllare se ci sono aggiornamenti.

## Sviluppo

Serve: [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) su Windows.

```bash
dotnet run --project src/IPTVISION
```

Struttura del progetto:

```
src/IPTVISION/
  Services/     client Xtream, player libVLC, guida TV, cache, aggiornamenti, controller
  ViewModels/   logica dell'interfaccia (MVVM con CommunityToolkit.Mvvm)
  Themes/       stili e palette
  MainWindow    finestra, comandi sovrapposti al video, modalità TV
installer/      script Inno Setup
scripts/        script di rilascio
```

Per provare il programma senza toccare i propri dati, imposta la variabile d'ambiente `IPTVISION_PROFILE` su una cartella vuota.

### Pubblicare una nuova versione

```bash
release.bat
```

Lo script fa tutto da solo:

1. aumenta la versione in `IPTVISION.csproj` (`1.2.3` diventa `1.2.4`);
2. compila il programma in modalità self-contained;
3. crea il setup con Inno Setup, e se Inno Setup manca lo installa con winget;
4. fa il commit, crea il tag `vX.Y.Z` e fa il push;
5. crea la release su GitHub, carica il setup e scrive le note prendendole dai commit.

Altre varianti:
- `release.bat minor` aumenta la versione minore (`1.3.0`);
- `release.bat major "Note della versione"` aumenta la versione principale e usa le note che scrivi tu.

Serve la [GitHub CLI](https://cli.github.com/) già autenticata (`gh auth login`).

## Tecnologie

[WPF / .NET 8](https://github.com/dotnet/wpf) · [LibVLCSharp](https://github.com/videolan/libvlcsharp) · [CommunityToolkit.Mvvm](https://github.com/CommunityToolkit/dotnet) · [Inno Setup](https://jrsoftware.org/isinfo.php)

## Licenza

[MIT](LICENSE). libVLC è distribuita con licenza LGPL 2.1.
