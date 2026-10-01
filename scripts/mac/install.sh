#!/bin/bash
# Installe Émile sur un Mac et le lance automatiquement à chaque démarrage.
#   bash scripts/mac/install.sh
# Relançable sans risque : met à jour le code, garde ton .env et tes sessions (dossier data/).
set -euo pipefail

APP_DIR="$HOME/Emile"
LABEL="com.emile.sowesoft"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SRC_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

bold() { printf "\n\033[1m%s\033[0m\n" "$1"; }
ok() { printf "  ✅ %s\n" "$1"; }
fail() { printf "\n  ❌ %s\n\n" "$1"; exit 1; }

bold "✍️  Installation d'Émile"

# 1. Node.js ────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  for p in /opt/homebrew/bin /usr/local/bin; do [ -x "$p/node" ] && export PATH="$p:$PATH"; done
fi
if ! command -v node >/dev/null 2>&1; then
  open "https://nodejs.org/fr/download" || true
  fail "Node.js n'est pas installé. Télécharge la version « LTS » pour macOS (la page vient de s'ouvrir), installe-la, puis relance ce script."
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js $NODE_MAJOR est trop ancien : installe la version LTS depuis https://nodejs.org puis relance."
NODE_BIN="$(command -v node)"
ok "Node.js $(node -v)"

# 2. Copie dans ~/Emile (hors Téléchargements : macOS y bloque les programmes en arrière-plan) ──
mkdir -p "$APP_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  rsync -a --delete \
    --exclude node_modules --exclude data --exclude .env --exclude .git \
    "$SRC_DIR/" "$APP_DIR/"
fi
mkdir -p "$APP_DIR/data"
ok "Fichiers copiés dans $APP_DIR"

# 3. Dépendances (télécharge aussi Chrome pour le robot, ~150 Mo la 1re fois) ──
bold "📦 Installation des dépendances (2-5 min la première fois)…"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund --loglevel=error
ok "Dépendances installées"

# 4. Configuration (.env) ───────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
  bold "⚙️  Configuration"
  echo "  (Les identifiants SoWeSoft se mettent ensuite dans l'appli, onglet Réglages.)"
  echo
  read -r -p "  Ton numéro WhatsApp (ex : 0612345678) : " PHONE
  PHONE="$(echo "$PHONE" | tr -cd '0-9')"
  case "$PHONE" in
    0*) PHONE="33${PHONE#0}" ;;
  esac
  [ ${#PHONE} -ge 10 ] || fail "Numéro invalide."
  read -r -p "  Ton lien iCal Hyperplanning (Entrée pour passer) : " ICS
  while :; do
    read -r -s -p "  Choisis un mot de passe pour l'appli Émile : " WEBPW; echo
    case "$WEBPW" in *"'"*) echo "  → sans apostrophe, s'il te plaît"; continue ;; esac
    [ ${#WEBPW} -ge 6 ] && break
    echo "  → au moins 6 caractères"
  done

  cp .env.example .env
  # remplace une ligne CLE=… du .env par CLE='valeur' (guillemets simples : #, & et espaces restent intacts)
  setenv() {
    local esc
    esc="$(printf '%s' "$2" | sed -e 's/[\\/&|]/\\&/g')"
    sed -i '' "s|^$1=.*|$1='$esc'|" .env
  }
  setenv OWNER_NUMBER "$PHONE"
  setenv ICS_URL "$ICS"
  setenv WEB_PASSWORD "$WEBPW"
  chmod 600 .env
  ok "Configuration enregistrée dans $APP_DIR/.env"
else
  ok "Configuration existante conservée (.env)"
fi

# 5. Lancement automatique (launchd) + Mac maintenu éveillé (caffeinate) ──
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
    <string>/usr/bin/caffeinate</string>
    <string>-i</string>
    <string>$NODE_BIN</string>
    <string>src/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>20</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>TZ</key><string>Europe/Paris</string>
  </dict>
  <key>StandardOutPath</key><string>$APP_DIR/data/emile.log</string>
  <key>StandardErrorPath</key><string>$APP_DIR/data/emile.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
ok "Émile tourne en arrière-plan et redémarrera tout seul avec le Mac"

# 6. Ouverture de l'appli ─────────────────────────────────────
printf "  ⏳ Démarrage"
for _ in $(seq 1 30); do
  if curl -s -o /dev/null http://localhost:3000/api/me; then break; fi
  printf "."; sleep 1
done
echo
open "http://localhost:3000/#settings" || true

bold "🎉 C'est prêt !"
cat <<TXT
  1. L'appli vient de s'ouvrir (http://localhost:3000). Entre ton mot de passe.
  2. Réglages → scanne le QR code avec WhatsApp (Appareils connectés → Connecter un appareil).
  3. Réglages → Connexion SoWeSoft : mets ton e-mail et ton mot de passe, Enregistrer, puis « Tester la connexion ».
  4. Le mode test est activé : au 1er code, vérifie la capture, puis désactive-le.

  Pour que le bot reste actif :
  • garde le Mac branché sur secteur et l'écran ouvert ;
  • Réglages Système → Batterie (ou Économiseur d'énergie) → « Empêcher la suspension automatique quand l'écran est éteint ».

  Journal : tail -f ~/Emile/data/emile.log
  Arrêter : bash ~/Emile/scripts/mac/uninstall.sh
TXT
