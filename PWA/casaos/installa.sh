#!/usr/bin/env bash
# Installazione guidata di IPTVISION (PWA) su CasaOS.
#
# Sul server CasaOS (via SSH o dal terminale web di CasaOS):
#   curl -fsSL https://raw.githubusercontent.com/carellice/IPTVISION/main/PWA/casaos/installa.sh | sudo bash
# oppure, dalla cartella del repository:
#   sudo bash PWA/casaos/installa.sh
#
# Rilanciandolo si aggiorna IPTVISION all'ultima versione: i dati restano dove sono.
# Installa anche il comando "iptvision-aggiorna" e, se vuoi, un timer che aggiorna IPTVISION ogni notte.

set -euo pipefail

REPO="carellice/IPTVISION"
BRANCH="${APP_BRANCH:-main}"
APP="iptvision"
IMAGE="iptvision-pwa:latest"
CASAOS_APPS="/var/lib/casaos/apps"

# --- aspetto -----------------------------------------------------------------------------------

if [ -t 1 ]; then
  B=$'\e[1m'; D=$'\e[2m'; R=$'\e[0m'; V=$'\e[35m'; G=$'\e[32m'; Y=$'\e[33m'; E=$'\e[31m'
else
  B=""; D=""; R=""; V=""; G=""; Y=""; E=""
fi
step() { printf "\n${V}${B}==> %s${R}\n" "$1"; }
info() { printf "    %s\n" "$1"; }
ok() { printf "    ${G}✓${R} %s\n" "$1"; }
warn() { printf "    ${Y}!${R} %s\n" "$1"; }
fail() { printf "\n${E}${B}ERRORE:${R} %s\n" "$1" >&2; exit 1; }

# Le domande leggono sempre dal terminale, anche quando lo script arriva da "curl | bash".
TTY=/dev/tty
[ -r "$TTY" ] || fail "Serve un terminale interattivo: lancia lo script da SSH o dal terminale di CasaOS."

ask() { # ask "domanda" "predefinito" -> REPLY
  local question="$1" default="${2:-}"
  if [ -n "$default" ]; then printf "    %s ${D}[%s]${R}: " "$question" "$default" >"$TTY"; else printf "    %s: " "$question" >"$TTY"; fi
  IFS= read -r REPLY <"$TTY" || true
  REPLY="${REPLY:-$default}"
}

ask_yes() { # ask_yes "domanda" s|n
  local default="${2:-s}" hint="S/n"
  [ "$default" = "n" ] && hint="s/N"
  printf "    %s ${D}[%s]${R}: " "$1" "$hint" >"$TTY"
  IFS= read -r REPLY <"$TTY" || true
  REPLY="${REPLY:-$default}"
  [[ "$REPLY" =~ ^[sSyY] ]]
}

printf "${V}${B}"
cat <<'EOF'

    ____   ___   ____      _      ____
   / ___| / _ \ / ___|    / \    / ___|
  | |    | | | |\___ \   / _ \  | |
  | |___ | |_| | ___) | / ___ \ | |___
   \____| \___/ |____/ /_/   \_\ \____|

  CasaOS App Converter · installazione di IPTVISION
EOF
printf "${R}\n"
info "Ti guido passo passo. Premi Invio per accettare il valore tra parentesi."

# --- controlli ---------------------------------------------------------------------------------

step "Controlli"
[ "$(id -u)" -eq 0 ] || fail "Lancia lo script come amministratore: sudo bash installa.sh"
command -v docker >/dev/null || fail "Docker non trovato. CasaOS lo installa da sé: sei sul server giusto?"
docker info >/dev/null 2>&1 || fail "Docker non risponde. Prova: systemctl start docker"
if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null; then COMPOSE=(docker-compose)
else fail "Docker Compose non trovato."
fi
ok "Docker pronto ($(docker --version | sed 's/Docker version //; s/,.*//'))"
if [ -d "$CASAOS_APPS" ] || systemctl list-units --type=service 2>/dev/null | grep -q casaos; then
  CASAOS=1
  ok "CasaOS trovato: IPTVISION comparirà tra le app della dashboard"
else
  CASAOS=0
  warn "CasaOS non trovato: installo IPTVISION come normale container Docker"
fi

ARCH=$(uname -m)
case "$ARCH" in
  x86_64|aarch64|arm64) ok "Processore $ARCH supportato" ;;
  armv7l) warn "Processore a 32 bit ($ARCH): la build potrebbe richiedere parecchi minuti" ;;
  *) warn "Processore $ARCH non testato: provo comunque" ;;
esac

# --- configurazione esistente ------------------------------------------------------------------

if [ "$CASAOS" = 1 ]; then APP_DIR="$CASAOS_APPS/$APP"; else APP_DIR="/opt/$APP"; fi
ENV_FILE="$APP_DIR/.env"
UPDATE=0
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
  # La porta di prima: serve a ritrovare il collegamento Tailscale anche se ora la porta cambia.
  PREV_PORT="${PORT:-}"
  step "IPTVISION è già installata"
  info "Dati in: ${DATA_DIR:-?}"
  if ask_yes "Aggiorno all'ultima versione mantenendo dati e impostazioni?" s; then
    UPDATE=1
  else
    info "Rifacciamo la configurazione (i dati restano dove sono)."
  fi
fi

# --- codice sorgente ---------------------------------------------------------------------------

step "Scarico IPTVISION"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../Dockerfile" ] && [ -d "$SCRIPT_DIR/../web" ]; then
  SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
  ok "Uso il codice di questa cartella: $SRC"
else
  command -v curl >/dev/null || fail "Serve curl per scaricare IPTVISION."
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$WORK" \
    || fail "Download da GitHub non riuscito. Controlla la connessione."
  SRC="$(find "$WORK" -maxdepth 4 -type d -path "*/PWA" | head -n1)"
  [ -n "$SRC" ] || fail "Cartella PWA non trovata nel download."
  ok "Scaricato da github.com/$REPO ($BRANCH)"
fi

# --- domande -----------------------------------------------------------------------------------

# Tailscale può essere installato sul sistema o come app di CasaOS (un container).
TS=()
find_tailscale() {
  if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then TS=(tailscale); return 0; fi
  local name
  name=$(docker ps --format '{{.Names}} {{.Image}}' | awk 'tolower($2) ~ /tailscale/ {print $1; exit}')
  if [ -n "$name" ] && docker exec "$name" tailscale status >/dev/null 2>&1; then TS=(docker exec "$name" tailscale); return 0; fi
  return 1
}

# Le app già collegate a Tailscale sul server, una riga "porta destinazione" per ciascuna,
# lette da "tailscale serve status" (https://nome.ts.net[:porta] seguito da "|-- / proxy <destinazione>").
ts_served() {
  "${TS[@]}" serve status 2>/dev/null | awk '
    /^https:\/\// { n = split($1, a, ":"); port = (n > 2) ? a[3] : 443; sub(/\/.*/, "", port); next }
    index($0, "|--") == 1 && port != "" { print port, $NF; port = "" }'
}

# Sceglie la porta HTTPS di Tailscale per questa app: quella che la serve già, poi quella salvata
# nell'installazione precedente se è libera, poi la prima libera. Stampa niente se sono tutte occupate.
ts_port_for() {
  local saved="$1" served port target own
  served=$(ts_served)
  while read -r port target; do
    for own in $OWN_TARGETS; do
      [ -n "$port" ] && [ "$target" = "$own" ] && { echo "$port"; return; }
    done
  done <<< "$served"
  for port in $saved 443 8443 10000 10001 10002 10003 10004 10005 10006 10007 10008 10009; do
    echo "$served" | awk '{print $1}' | grep -qx "$port" || { echo "$port"; return; }
  done
}

LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
LAN_IP=${LAN_IP:-127.0.0.1}

port_free() {
  ! (ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null) | awk '{print $4}' | grep -Eq "[:.]$1\$"
}

if [ "$UPDATE" = 0 ]; then
  step "Configurazione"

  default_data="/DATA/AppData/$APP"
  [ -d /DATA ] || default_data="/opt/$APP/data"
  ask "Cartella dove salvare i dati" "${DATA_DIR:-$default_data}"
  DATA_DIR="$REPLY"

  default_port="${PORT:-8096}"
  while true; do
    ask "Porta per aprire IPTVISION nel browser" "$default_port"
    PORT="$REPLY"
    [[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || { warn "Scrivi un numero tra 1 e 65535."; continue; }
    if docker ps --format '{{.Names}}' | grep -qx "$APP"; then break; fi
    port_free "$PORT" && break
    warn "La porta $PORT è già usata da un altro servizio, scegline un'altra."
  done

  host_tz=$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || echo "")
  ask "Fuso orario (per gli orari della guida TV)" "${TZ:-${host_tz:-Europe/Rome}}"
  TZ="$REPLY"

  step "Chi può creare un account?"
  info "Ogni persona ha il suo account IPTVISION, con il suo accesso IPTV, i suoi preferiti e Continua a guardare."
  info "Per crearne uno serve un codice invito: dallo solo a chi vuoi far entrare."
  # Senza "|| true" pipefail fermerebbe lo script: tr esce con SIGPIPE quando head ha finito.
  default_code="${INVITE_CODE:-$( (tr -dc 'a-z0-9' </dev/urandom 2>/dev/null || true) | head -c 8)}"
  ask "Codice invito (scrivi - per non chiederlo)" "${default_code:-casa}"
  INVITE_CODE="$REPLY"
  [ "$INVITE_CODE" = "-" ] && INVITE_CODE=""
  [[ "$INVITE_CODE" =~ ^[A-Za-z0-9._-]*$ ]] || { warn "Uso solo lettere, numeri, punto e trattino: tolgo gli altri caratteri."; INVITE_CODE=$(printf '%s' "$INVITE_CODE" | tr -dc 'A-Za-z0-9._-'); }

  step "Come vuoi aprire IPTVISION dal telefono?"
  info "Per installarla come app e per la ricerca vocale il telefono deve usare HTTPS."
  echo
  has_tailscale=0
  find_tailscale && has_tailscale=1
  if [ "$has_tailscale" = 1 ]; then
    info "1) Tailscale ${G}(consigliato, trovato su questo server)${R}: HTTPS vero, funziona anche fuori casa"
  else
    info "1) Tailscale: HTTPS vero anche fuori casa ${D}(da installare prima dall'App Store di CasaOS)${R}"
  fi
  info "2) HTTPS in casa: installi una volta un certificato sul telefono"
  info "3) Solo HTTP: hai già un reverse proxy o un Cloudflare Tunnel con HTTPS"
  while true; do
    ask "Scelta" "$([ "$has_tailscale" = 1 ] && echo 1 || echo 2)"
    case "$REPLY" in 1) MODE=tailscale; break ;; 2) MODE=local; break ;; 3) MODE=http; break ;; *) warn "Scrivi 1, 2 o 3." ;; esac
  done
  if [ "$MODE" = tailscale ] && [ "$has_tailscale" = 0 ]; then
    warn "Tailscale non è attivo qui: installalo dall'App Store di CasaOS e rilancia questo script."
    warn "Intanto preparo l'HTTPS in casa (opzione 2), così puoi già usarla."
    MODE=local
  fi

  HTTPS_PORT="${HTTPS_PORT:-$((PORT + 1))}"
  HTTPS_HOSTS=""
  if [ "$MODE" = local ]; then
    while true; do
      ask "Porta HTTPS" "$HTTPS_PORT"
      HTTPS_PORT="$REPLY"
      [[ "$HTTPS_PORT" =~ ^[0-9]+$ ]] && [ "$HTTPS_PORT" != "$PORT" ] || { warn "Scegli un numero diverso dalla porta HTTP."; continue; }
      docker ps --format '{{.Names}}' | grep -qx "$APP" && break
      port_free "$HTTPS_PORT" && break
      warn "La porta $HTTPS_PORT è già usata, scegline un'altra."
    done
    ask "Indirizzi del server (separati da virgola)" "$LAN_IP,$(hostname).local"
    HTTPS_HOSTS="$REPLY"
  fi
fi

# --- build -------------------------------------------------------------------------------------

step "Preparo IPTVISION (la prima volta servono alcuni minuti)"
BUILD_LOG="$(mktemp)"
docker build --pull -t "$IMAGE" "$SRC" >"$BUILD_LOG" 2>&1 &
build_pid=$!
printf "    "
while kill -0 "$build_pid" 2>/dev/null; do printf "."; sleep 5; done
printf "\n"
if ! wait "$build_pid"; then
  tail -n 25 "$BUILD_LOG" | sed 's/^/    /'
  fail "Build non riuscita (log completo: $BUILD_LOG)"
fi
rm -f "$BUILD_LOG"
ok "Immagine $IMAGE pronta"

# --- avvio -------------------------------------------------------------------------------------

step "Avvio IPTVISION"
mkdir -p "$APP_DIR" "$DATA_DIR"
umask 077
cat > "$ENV_FILE" <<EOF
# Configurazione di IPTVISION, scritta da installa.sh
DATA_DIR=$DATA_DIR
PORT=$PORT
HTTPS_PORT=$HTTPS_PORT
HTTPS_HOSTS=$HTTPS_HOSTS
MODE=$MODE
TZ=$TZ
INVITE_CODE=$INVITE_CODE
EOF
umask 022

https_ports=""
[ "$MODE" = local ] && https_ports="      - \"\${HTTPS_PORT}:8443\""
cat > "$APP_DIR/docker-compose.yml" <<EOF
name: $APP
services:
  $APP:
    image: $IMAGE
    container_name: $APP
    pull_policy: never
    restart: unless-stopped
    ports:
      - "\${PORT}:8080"
$https_ports
    volumes:
      - type: bind
        source: \${DATA_DIR}
        target: /data
    environment:
      TZ: \${TZ}
      HTTPS_HOSTS: \${HTTPS_HOSTS}
      INVITE_CODE: \${INVITE_CODE}
    x-casaos:
      ports:
        - container: "8080"
          description:
            en_us: Web app
            it_it: App web
      volumes:
        - container: /data
          description:
            en_us: "Accounts, favorites, positions and cached lists"
            it_it: "Account, preferiti, posizioni e liste salvate"
x-casaos:
  architectures:
    - amd64
    - arm64
  main: $APP
  author: "carellice"
  developer: "carellice"
  category: "Media"
  icon: https://raw.githubusercontent.com/$REPO/$BRANCH/PWA/web/public/icon-512.png
  # Text values stay in double quotes: a ": " or a leading "-", "[", "*"... in an app's description
  # would otherwise break the YAML ("mapping values are not allowed in this context").
  title:
    en_us: "IPTVISION"
    it_it: "IPTVISION"
  tagline:
    en_us: "IPTV player in the browser: live TV, movies and series"
    it_it: "Lettore IPTV nel browser: TV in diretta, film e serie"
  description:
    en_us: "IPTVISION as a web app for phone and PC: live TV with TV guide, movies and series from an Xtream Codes account. Each user has their own account, favorites and Continue watching. The server relays the IPTV provider and converts with ffmpeg what the browser cannot play."
    it_it: "IPTVISION come app web per telefono e PC: TV in diretta con guida TV, film e serie da un account Xtream Codes. Ogni utente ha il suo account, i suoi preferiti e Continua a guardare. Il server fa da ponte verso il fornitore IPTV e converte con ffmpeg quello che il browser non legge."
  port_map: "$PORT"
  scheme: http
  index: /
EOF

(cd "$APP_DIR" && "${COMPOSE[@]}" --env-file "$ENV_FILE" up -d --force-recreate --remove-orphans) 2>&1 | sed 's/^/    /'
# Fa comparire subito l'app nella dashboard di CasaOS.
[ "$CASAOS" = 1 ] && systemctl restart casaos-app-management.service >/dev/null 2>&1 || true

printf "    Attendo che IPTVISION risponda"
for _ in $(seq 1 60); do
  if curl -fs "http://127.0.0.1:$PORT/api/session" >/dev/null 2>&1; then printf "\n"; ok "IPTVISION è in funzione"; break; fi
  printf "."
  sleep 2
done
curl -fs "http://127.0.0.1:$PORT/api/session" >/dev/null 2>&1 || { printf "\n"; fail "IPTVISION non risponde. Guarda i log con: docker logs $APP"; }

# --- HTTPS -------------------------------------------------------------------------------------

URL_PHONE="http://$LAN_IP:$PORT"
TARGET="http://127.0.0.1:$PORT"
OWN_TARGETS="$TARGET"
[ -n "${PREV_PORT:-}" ] && OWN_TARGETS="$OWN_TARGETS http://127.0.0.1:$PREV_PORT"
sed -i '/^TS_HTTPS_PORT=/d' "$ENV_FILE"
if [ "$MODE" = tailscale ]; then
  step "Collego Tailscale"
  find_tailscale || true
  TS_PORT=""
  if [ ${#TS[@]} -gt 0 ]; then
    # Il nome Tailscale del server è uno solo: ogni app ha la sua porta HTTPS.
    TS_PORT=$(ts_port_for "${TS_HTTPS_PORT:-}")
  fi
  if [ -n "$TS_PORT" ] && "${TS[@]}" serve --bg --https="$TS_PORT" "$TARGET" >/dev/null 2>&1; then
    echo "TS_HTTPS_PORT=$TS_PORT" >> "$ENV_FILE"
    TS_NAME=$("${TS[@]}" status --json 2>/dev/null | grep -o '"DNSName": *"[^"]*"' | head -n1 | sed 's/.*"\([^"]*\)"$/\1/; s/\.$//')
    if [ -n "$TS_NAME" ]; then
      URL_PHONE="https://$TS_NAME"
      [ "$TS_PORT" = 443 ] || URL_PHONE="$URL_PHONE:$TS_PORT"
      ok "IPTVISION è su $URL_PHONE (solo per i dispositivi del tuo Tailscale)"
      [ "$TS_PORT" = 443 ] || info "La porta 443 è già usata da un'altra app: IPTVISION usa la $TS_PORT."
    else
      warn "Collegato sulla porta $TS_PORT, ma non trovo il nome del server: guarda con  ${TS[*]} serve status"
    fi
  elif [ ${#TS[@]} -gt 0 ] && [ -z "$TS_PORT" ]; then
    warn "Tutte le porte HTTPS di Tailscale previste sono già usate da altre app."
    info "  Liberane una con  ${TS[*]} serve --https=<porta> off  e rilancia questo script."
  else
    warn "tailscale serve non riuscito. Abilita HTTPS nel pannello Tailscale (DNS → HTTPS Certificates) e rilancia:"
    info "  tailscale serve --bg --https=${TS_PORT:-443} $TARGET"
  fi
else
  # Non più su Tailscale: toglie il collegamento rimasto da un'installazione precedente.
  if find_tailscale; then
    ts_served | while read -r port target; do
      for own in $OWN_TARGETS; do
        [ "$target" = "$own" ] && "${TS[@]}" serve --https="$port" off >/dev/null 2>&1 || true
      done
    done
  fi
  [ "$MODE" = local ] && URL_PHONE="https://$(echo "$HTTPS_HOSTS" | cut -d, -f1):$HTTPS_PORT"
fi

# --- aggiornamenti -----------------------------------------------------------------------------

step "Aggiornamenti"
install -m 755 "$SRC/casaos/aggiorna.sh" /usr/local/bin/iptvision-aggiorna
ok "Comando installato: sudo iptvision-aggiorna"
AUTO_UPDATE=0
if command -v systemctl >/dev/null 2>&1 && [ -d /etc/systemd/system ]; then
  if systemctl is-enabled iptvision-aggiorna.timer >/dev/null 2>&1; then
    AUTO_UPDATE=1
    ok "Aggiornamenti automatici già attivi"
  elif ask_yes "Controllo ogni notte se c'è una versione nuova e la installo da solo?" s; then
    cat > /etc/systemd/system/iptvision-aggiorna.service <<'EOF'
[Unit]
Description=Aggiorna IPTVISION all'ultima versione
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/iptvision-aggiorna
TimeoutStartSec=1h
Nice=10
EOF
    cat > /etc/systemd/system/iptvision-aggiorna.timer <<'EOF'
[Unit]
Description=Controlla ogni notte se c'è una nuova versione di IPTVISION

[Timer]
OnCalendar=*-*-* 04:00
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now iptvision-aggiorna.timer >/dev/null 2>&1 && AUTO_UPDATE=1
    [ "$AUTO_UPDATE" = 1 ] && ok "Ogni notte verso le 4 IPTVISION si aggiorna da sola" || warn "Timer non attivato: aggiorna a mano con sudo iptvision-aggiorna"
  fi
else
  warn "systemd non trovato: aggiorna a mano con sudo iptvision-aggiorna"
fi

# --- fine --------------------------------------------------------------------------------------

step "Fatto!"
echo
info "${B}Apri IPTVISION:${R}"
info "  dal computer di casa:  http://$LAN_IP:$PORT"
info "  dal telefono:          ${B}$URL_PHONE${R}"
echo
if [ "$MODE" = local ]; then
  info "${B}Una volta per ogni telefono${R} installa il certificato di IPTVISION:"
  info "  1. apri http://$LAN_IP:$PORT/certificato e segui le istruzioni"
  info "  2. poi apri $URL_PHONE"
  echo
fi
if [ "$MODE" = http ]; then
  info "Punta il tuo reverse proxy o Cloudflare Tunnel (con HTTPS) a http://$LAN_IP:$PORT"
  warn "Non renderla pubblica su Internet senza un accesso protetto: i flussi IPTV passano da questo server."
  echo
fi
info "${B}Crea il tuo account:${R} apri IPTVISION e tocca \"Prima volta qui? Crea un account\"."
if [ -n "${INVITE_CODE:-}" ]; then
  info "Codice invito: ${B}$INVITE_CODE${R} (lo trovi anche in $ENV_FILE)"
fi
info "Ogni persona della famiglia può crearne uno: accesso IPTV, preferiti e posizioni restano separati."
info "Dopo l'accesso inserisci server, utente e password del servizio IPTV, come nell'app."
echo
info "${B}Installala come app:${R}"
info "  Android (Chrome): menu ⋮ → Installa app"
info "  iPhone (Safari):  Condividi → Aggiungi alla schermata Home"
echo
if [ "$AUTO_UPDATE" = 1 ]; then
  info "IPTVISION si aggiorna da sola ogni notte. Per farlo subito: sudo iptvision-aggiorna"
  info "${D}Ultimi aggiornamenti: journalctl -u iptvision-aggiorna · Per spegnerli: systemctl disable --now iptvision-aggiorna.timer${R}"
else
  info "Per aggiornare in futuro: sudo iptvision-aggiorna"
fi
info "${D}Configurazione: $APP_DIR · Dati: $DATA_DIR · Log: docker logs $APP${R}"
echo
