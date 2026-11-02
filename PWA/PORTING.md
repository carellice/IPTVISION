# IPTVISION · port to PWA

Checklist of the conversion from the Android app (phone layout; the wide layout ≥ 720 dp is the
tablet/TV one). Every row: native source → web file → status (`todo`, `done`, `verified` =
compared with the native app). Native paths are relative to
`android/app/src/main/java/com/carellice/iptvision/`.

The same server also serves the native apps in "server mode" (Android, Windows, LG and Samsung TV):
see the last section.

## Screens and routes

| Screen | Reached from | Native file | Web file | Status |
|---|---|---|---|---|
| PWA account login / register | app start without session | (new) | `web/src/screens/Gate.tsx` | done |
| Xtream login (server or M3U link, user, password) | account without IPTV account | `ui/LoginScreen.kt` | `web/src/screens/Login.tsx` | done |
| Home: bottom bar (phone) / side nav + clock (≥ 720 px) | after login | `ui/HomeScreen.kt` | `web/src/screens/Home.tsx` | done |
| Category browser: list (phone), grid of 96 dp cards (wide) | each library section | `ui/Browse.kt` CategoryBrowser | `web/src/screens/Browse.tsx` | done |
| Open category header: back, title, count, sort menu, list/grid toggle | tap category | `ui/Browse.kt` ListHeader | `web/src/screens/Browse.tsx` | done |
| Live channels: rows / tiles with EPG now + progress, favorite star | TV | `ui/Browse.kt` LiveSection | `web/src/screens/Browse.tsx` | done |
| Movies / Series: Poster grid / MediaRow list, "N versioni", "Visto" | Film, Serie TV | `ui/Browse.kt` | `web/src/screens/Browse.tsx` | done |
| Remove from Continua a guardare (long press) | Continue category | `ui/Browse.kt` RemoveContinueDialog | `web/src/screens/Browse.tsx` | done |
| Variant choice dialog | entry with several versions | `ui/Browse.kt` VariantDialog | `web/src/screens/Dialogs.tsx` | done |
| Movie detail | movie tap | `ui/DetailScreens.kt` | `web/src/screens/Details.tsx` | done |
| Series detail: season pills, episodes, resume button | series tap | `ui/DetailScreens.kt` | `web/src/screens/Details.tsx` | done |
| Player: info / controls overlays, channel panel, tracks, next episode card | play anything | `ui/PlayerScreen.kt` | `web/src/screens/Player.tsx` | done |
| Search: field, mic, quiz button, scope pills, grouped results | Cerca | `ui/SearchSettings.kt` | `web/src/screens/Search.tsx` | done |
| "Cosa guardo?" quiz dialog | lightbulb in Cerca | `ui/Quiz.kt`, `data/Quiz.kt` | `web/src/screens/Dialogs.tsx`, `shared/quiz.ts` | done |
| Settings (Altro) | bottom bar | `ui/SearchSettings.kt` SettingsSection | `web/src/screens/Settings.tsx` | done |
| Downloads | bottom bar (phone) | `ui/DownloadsScreen.kt` | not ported: a browser can't keep GB of video offline | n/a |

Back (`AppViewModel.back`): dialog → pop stack (player stops) → close open category → section back
to TV → leave. Ported in `web/src/lib/app.ts` `back()`, mirrored on `history`.

## Navigation chrome and transitions

| Element | Spec | Native file | Web file | Status |
|---|---|---|---|---|
| Screen changes | none: `when (screen)` swaps instantly | `MainActivity.kt` | `App.tsx` | done |
| NavigationBar (M3) | 80 dp, Panel, indicator 64×32 pill Accent, labels 11 sp, "TV"/"Altro" | `ui/HomeScreen.kt` | `components/ui.tsx` NavBar | done |
| Side nav (wide) | 220 dp, Panel, logo 34 dp r8, items 14/12 padding, selected AccentSoft, Clock at bottom | `ui/HomeScreen.kt` | `screens/Home.tsx` | done |
| Player overlays | `AnimatedVisibility` fadeIn/fadeOut (default spring, stiffness 1500) | `ui/PlayerScreen.kt` | `Player.tsx` | done |
| Channel panel | slideInHorizontally from −width | `ui/PlayerScreen.kt` | `Player.tsx` | done |
| Dialogs | Android dialog window: fade + scale 0.9 → 1, ~150 ms | `Dialog`, `AlertDialog` | `components/ui.tsx` Dialog | done |
| Sort DropdownMenu | M3: scale 0.8 → 1 + fade, 120 ms in / 75 ms out | `ui/Browse.kt` | `components/ui.tsx` Menu | done |

## Theme (dark only)

| Token | Value | Native source | Status |
|---|---|---|---|
| Accent / Accent2 | `#3D7BFF` / `#00C2FF` | `ui/Components.kt` C | done |
| Bg / Panel / Surface | `#0A0B0F` / `#111318` / `#191C23` | C | done |
| SurfaceHover / SurfacePressed | `#21252E` / `#2A2F3A` | C | done |
| Stroke / StrokeStrong | `#20242D` / `#2E3340` | C | done |
| Text / Text2 / Text3 | `#F1F3F7` / `#9099A8` / `#5C6473` | C | done |
| AccentSoft | `#3D7BFF` alpha 0x22 | C | done |
| Danger / Star / Live | `#FF5D6C` / `#FFC94D` / `#FF4D5E` | C | done |
| Login gradient | vertical `#0F1830` → Bg | `ui/LoginScreen.kt` | done |

## Typography

Android default font (Roboto), shipped as `web/public/roboto.woff2` (variable, 100–900). Sizes are
the `sp` of each composable, 1:1 in px; M3 `Text` default body 16/24, weights Medium 500,
SemiBold 600, Bold 700.

## Components

| Component | Behavior | Native file | Web file | Status |
|---|---|---|---|---|
| `tvClickable` | ripple, focus: scale (default spring) + 2 dp white border + SurfacePressed; long press / Menu key | `ui/Components.kt` | `components/ui.tsx` Clickable | done |
| Artwork | image with initials placeholder (Text2, bold) on SurfaceHover | `ui/Components.kt` | `components/ui.tsx` | done |
| ProgressLine, Pill, ActionButton, Loading, Empty, SectionTitle, Badge | sizes as in source | `ui/Components.kt` | `components/ui.tsx` | done |
| OutlinedTextField | M3 outlined, floating label, Panel fill, Accent focus border | `ui/LoginScreen.kt` | `components/ui.tsx` TextField | done |
| Switch | M3 52×32, checked track Accent, unchecked SurfaceHover | `ui/SearchSettings.kt` | `components/ui.tsx` | done |
| Slider | M3, white thumb, Accent active track | `ui/PlayerScreen.kt` | `Player.tsx` | done |
| CircularProgressIndicator | M3 indeterminate 40 dp, 4 dp stroke | M3 | `components/ui.tsx` Spinner | done |
| Toast | Android toast | `MainActivity.kt` | `components/ui.tsx` Toast | done |

## Data model

Native: SharedPreferences `settings` + `positions.json` + list cache files. PWA: one SQLite file per
account (`server/src/db.ts`), with the same shape the native apps already use.

| Table | Columns | Native source | Status |
|---|---|---|---|
| meta | `xtream_server`, `xtream_username`, `xtream_password` (never sent to a client), `hideAdult`, `revision` | `data/Store.kt` Settings | done |
| favorites | streamId | Settings.favorites | done |
| positions | key, p, d, u | `positions.json` positions | done |
| watched | key | `positions.json` watched | done |
| last_episode | seriesId, episodeId, u | `positions.json` lastEpisode | done |

Server cache per IPTV account (`data/cache/<key>/`): provider JSON lists as they arrive (live 30 min,
films and series 12 h), `xmltv.xml` (6 h) and its compact parse for the browser.

Per device (localStorage, like the native SharedPreferences): outputFormat, autoplay last channel,
sort and grid per section, lastStreamId, lastCategoryId.

## Business logic (shared/)

| Logic | Native file | Web file | Status |
|---|---|---|---|
| normalize, initials, formatTime, clock, joinMeta, variantKey, qualityOf, groupVariants | `data/Models.kt` | `shared/text.ts` | done |
| Position rules (30 s, 90 s, 95 %, 600 kept) | `data/Store.kt` PositionStore | `shared/positions.ts` | done |
| parseServerInput, year/rating parsing, list parsing | `data/Xtream.kt` | `server/src/xtream.ts` | done |
| XMLTV (window −3 h … +36 h, wanted ids), short EPG, now/next | `data/Epg.kt` | `server/src/epg.ts`, `shared/epg.ts` | done |
| Library + "Nascondi XXX", channelsFor/moviesFor/seriesFor, sorts | `AppViewModel.kt` | `web/src/lib/library.ts` | done |
| Search (tokens, categories, 60 per group) | `AppViewModel.kt` | `web/src/lib/library.ts` | done |
| Quiz | `data/Quiz.kt` | `shared/quiz.ts` | done |
| Resume episode, next/prev, countdown 10 s | `AppViewModel.kt` | `web/src/lib/app.ts` | done |
| Player watchdog + reconnect (backoff 1 s … 15 s, limits 12/25/20/35 s, 6 VOD attempts) | `player/PlayerController.kt` | `web/src/lib/player.ts` | done |

## Device features

| Native | PWA | Status |
|---|---|---|
| ExoPlayer (TS, HLS, MKV, AC3…) | the server relays the stream; live TS with mpegts.js, ffmpeg copies the video and converts the audio to AAC; films probed with ffprobe and remuxed to fragmented MP4 when the browser can't read them | done |
| Audio tracks | from ffprobe, chosen on the server (`-map 0:a:N`) | done |
| Subtitles | not available in the browser | n/a |
| Voice search (RecognizerIntent it-IT) | Web Speech API `it-IT`, same toast when missing | done |
| Landscape + immersive player | Fullscreen API + `screen.orientation.lock('landscape')` | done |
| Pause when the app goes to background | `visibilitychange` | done |
| Downloads (offline) | not ported | n/a |
| In-app APK update | service worker update + nightly server update | done |
| Remote / D-pad keys | keyboard: arrows, Enter, Space, digits, I, Esc | done |

## Strings

All copy taken verbatim from the composables above (Italian).

## Server mode in the native apps

The server speaks the Xtream Codes API (`server/src/relay.ts`): `player_api.php`, `xmltv.php`,
`/live|movie|series/<user>/<token>/<id>.<ext>`. A native app in server mode logs in with the PWA
account (`POST /api/device/login` → token), then uses the CasaOS address as its Xtream server, the
PWA username as user and the token as password: its Xtream client is unchanged and every list,
guide and stream (downloads too) comes from CasaOS. The provider's credentials never leave the
server. Favorites and positions: `GET /api/state` (same shape as `positions.json`) every 30 s and
`POST /api/ops` with the changes.

| Platform | Files | Status |
|---|---|---|
| Android | `data/ServerMode.kt`, `ui/ServerScreen.kt`, `AppViewModel.kt`, `ui/SearchSettings.kt`, `res/xml/network_security_config.xml` | done |
| Windows | `Services/ServerMode.cs`, `ViewModels/MainViewModel.Server.cs`, `MainWindow.xaml` | done |
| LG / Samsung TV | `webos/app/js/server.js`, `webos/app/js/app.js`, `webos/app/js/store.js` | done |
