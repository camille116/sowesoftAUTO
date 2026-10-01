#!/bin/bash
# Installe LinkeD sur un Mac : service en arrière-plan (redémarre avec le Mac) + app « LinkeD » dans Applications.
# Lancé par un double-clic sur « Installer LinkeD.command » (ou : bash scripts/mac/install.sh).
# Relançable sans risque : met à jour le code, garde ta config (.env) et tes sessions (data/).
set -euo pipefail

APP_DIR="$HOME/LinkeD"
LABEL="com.linked.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SRC_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
REPO="camille116/sowesoftAUTO"
BRANCH="claude/whatsapp-signature-bot-q8m9ha"

bold() { printf "\n\033[1m%s\033[0m\n" "$1"; }
ok() { printf "  ✅ %s\n" "$1"; }
alert() { osascript -e "display alert \"LinkeD\" message \"$1\" as critical" >/dev/null 2>&1 || true; }
fail() { printf "\n  ❌ %s\n\n" "$1"; alert "$1"; exit 1; }
# Fenêtre de saisie macOS (pas besoin de taper dans le Terminal). $1 = question, $2 = "hidden" pour un mot de passe
ask() {
  local hidden=""; [ "${2:-}" = "hidden" ] && hidden="with hidden answer"
  osascript -e "text returned of (display dialog \"$1\" default answer \"\" $hidden buttons {\"Passer\", \"OK\"} default button \"OK\" with title \"Installation de LinkeD\")" 2>/dev/null || true
}

bold "⚡ Installation de LinkeD"

# 1. Node.js ────────────────────────────────────────────────
for p in /opt/homebrew/bin /usr/local/bin; do [ -x "$p/node" ] && export PATH="$p:$PATH"; done
if ! command -v node >/dev/null 2>&1; then
  open "https://nodejs.org/fr/download" || true
  fail "Il manque Node.js. La page de téléchargement vient de s'ouvrir : installe la version LTS (fichier .pkg), puis relance « Installer LinkeD »."
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js $NODE_MAJOR est trop ancien : installe la version LTS depuis nodejs.org puis relance."
NODE_BIN="$(command -v node)"
ok "Node.js $(node -v)"

# 2. Ancienne version « Émile » → LinkeD ────────────────────
if [ -f "$HOME/Library/LaunchAgents/com.emile.sowesoft.plist" ]; then
  launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.emile.sowesoft.plist" >/dev/null 2>&1 || true
  rm -f "$HOME/Library/LaunchAgents/com.emile.sowesoft.plist"
fi
if [ -d "$HOME/Emile" ] && [ ! -d "$APP_DIR" ]; then
  mv "$HOME/Emile" "$APP_DIR"
  ok "Ancienne installation Émile récupérée (réglages et sessions conservés)"
fi

# 3. Copie dans ~/LinkeD (hors Téléchargements : macOS y bloque les programmes en arrière-plan) ──
mkdir -p "$APP_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  rsync -a --delete \
    --exclude node_modules --exclude data --exclude .env --exclude .git --exclude VERSION \
    "$SRC_DIR/" "$APP_DIR/"
fi
mkdir -p "$APP_DIR/data"
ok "Fichiers copiés dans $APP_DIR"

# 4. Dépendances ────────────────────────────────────────────
bold "📦 Installation des dépendances (2-5 min la première fois)…"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund --loglevel=error
ok "Dépendances installées"
bold "🖥️  Installation de l'app Mac (≈ 100 Mo la première fois)…"
if (cd desktop && npm install --no-audit --no-fund --loglevel=error); then
  ok "App Mac prête"
else
  echo "  ⚠️  App Mac indisponible (pas de réseau ?) : LinkeD s'ouvrira dans une fenêtre de navigateur."
fi

# 5. Configuration (.env) ───────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
  bold "⚙️  Configuration"
  WEBPW=""
  while [ ${#WEBPW} -lt 6 ] || [[ "$WEBPW" == *"'"* ]]; do
    WEBPW="$(ask "Choisis un mot de passe pour ouvrir LinkeD (6 caractères minimum, sans apostrophe). « Passer » = mot de passe généré." hidden)"
    if [ -z "$WEBPW" ]; then
      WEBPW="$(LC_ALL=C tr -dc 'A-HJ-NP-Za-km-z2-9' </dev/urandom | head -c 12)"
      osascript -e "display dialog \"Mot de passe de LinkeD (note-le) :\n\n$WEBPW\" buttons {\"Noté\"} default button 1 with title \"LinkeD\"" >/dev/null 2>&1 \
        || echo "  Mot de passe de LinkeD : $WEBPW (note-le)"
    fi
  done
  ICS="$(ask "Colle ton lien iCal Hyperplanning (tu pourras le mettre plus tard dans l'app) :")"

  cp .env.example .env
  setenv() {  # CLE='valeur' (guillemets simples : #, & et espaces restent intacts)
    local esc
    esc="$(printf '%s' "$2" | sed -e 's/[\/&|]/\\&/g')"
    sed -i '' "s|^$1=.*|$1='$esc'|" .env
  }
  setenv WEB_PASSWORD "$WEBPW"
  setenv ICS_URL "$ICS"
  chmod 600 .env
  ok "Configuration enregistrée"
else
  ok "Configuration existante conservée (.env)"
fi
chmod 700 "$APP_DIR/data"

# 6. Service en arrière-plan (launchd) + Mac maintenu éveillé (caffeinate) ──
bold "🚀 Démarrage automatique"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$APP_DIR/scripts/mac/LinkeD</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>TZ</key><string>Europe/Paris</string>
    <key>LINKED_MANAGED</key><string>1</string>
    <key>LINKED_NODE</key><string>$NODE_BIN</string>
    <key>UPDATE_REPO</key><string>$REPO</string>
    <key>UPDATE_BRANCH</key><string>$BRANCH</string>
  </dict>
  <key>StandardOutPath</key><string>$APP_DIR/data/linked.log</string>
  <key>StandardErrorPath</key><string>$APP_DIR/data/linked.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
ok "LinkeD tourne en arrière-plan et redémarrera avec le Mac"

# 7. App « LinkeD » dans Applications ────────────────────────
APP_PATH="$(bash "$APP_DIR/scripts/mac/make-app.sh")"
ok "App créée : $APP_PATH (ajoute-la au Dock si tu veux)"

printf "  ⏳ Démarrage"
for _ in $(seq 1 30); do
  curl -s -o /dev/null --max-time 1 http://localhost:3000/api/me && break
  printf "."; sleep 1
done
echo
open "$APP_PATH"

bold "🎉 C'est prêt !"
cat <<TXT
  • Désormais, ouvre simplement « LinkeD » depuis Applications, Launchpad ou Spotlight (⌘ + Espace).
  • Dans l'app → Réglages : relie Telegram, mets ton compte SoWeSoft, choisis les cours à notifier.
  • Les mises à jour se font depuis l'app : Réglages → Application → « Mettre à jour ».
  • Garde le Mac branché et l'écran ouvert pendant tes cours.

  Tu peux fermer cette fenêtre.
TXT
osascript -e 'display notification "Ouvre LinkeD depuis tes Applications." with title "LinkeD est installé ✅"' >/dev/null 2>&1 || true
