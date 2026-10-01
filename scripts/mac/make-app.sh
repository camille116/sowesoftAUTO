#!/bin/bash
# Fabrique l'app « LinkeD » (dossier Applications) : une vraie app Mac (fenêtre, Dock, menus),
# construite avec Electron (comme Spotify, Discord, Slack). Elle affiche le service LinkeD qui tourne en arrière-plan.
#   bash scripts/mac/make-app.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DESKTOP="$APP_DIR/desktop"
ELECTRON_APP="$DESKTOP/node_modules/electron/dist/Electron.app"
DEST="/Applications"
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"
APP="$DEST/LinkeD.app"
ICON_SRC="$APP_DIR/assets/icon-1024.png"

make_icns() {  # $1 = fichier .icns de sortie
  [ -f "$ICON_SRC" ] && command -v iconutil >/dev/null 2>&1 || return 0
  local set; set="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$set"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$ICON_SRC" --out "$set/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$ICON_SRC" --out "$set/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$set" -o "$1"
}

# L'app native a besoin d'Electron (≈ 100 Mo) : on l'installe ici si besoin,
# pour que l'installeur ET le bouton « Mettre à jour » donnent toujours la vraie app.
if [ ! -d "$ELECTRON_APP" ] && [ -f "$DESKTOP/package.json" ] && command -v npm >/dev/null 2>&1; then
  echo "Téléchargement de l'app Mac (Electron, ≈ 100 Mo)…" >&2
  (cd "$DESKTOP" && npm install --no-audit --no-fund --loglevel=error) >&2 || true
  # si un premier téléchargement a échoué, npm croit Electron installé : on relance son téléchargement
  if [ ! -d "$ELECTRON_APP" ] && [ -f "$DESKTOP/node_modules/electron/install.js" ]; then
    (cd "$DESKTOP/node_modules/electron" && node install.js) >&2 || true
  fi
  [ -d "$ELECTRON_APP" ] || echo "⚠️  Electron n'a pas pu être téléchargé : l'app s'ouvrira dans une fenêtre de navigateur." >&2
fi

rm -rf "$APP"

if [ -d "$ELECTRON_APP" ]; then
  # ── Vraie app : Electron renommé en LinkeD ──
  ditto "$ELECTRON_APP" "$APP"
  RES="$APP/Contents/Resources"
  rm -f "$RES/default_app.asar"
  mkdir -p "$RES/app"
  cp "$DESKTOP/package.json" "$DESKTOP/main.js" "$DESKTOP/preload.js" "$DESKTOP/loading.html" "$RES/app/"
  make_icns "$RES/electron.icns"
  PL="$APP/Contents/Info.plist"
  plutil -replace CFBundleName -string "LinkeD" "$PL"
  plutil -replace CFBundleDisplayName -string "LinkeD" "$PL"
  plutil -replace CFBundleIdentifier -string "com.linked.desktop" "$PL"
  plutil -replace NSHumanReadableCopyright -string "LinkeD" "$PL" 2>/dev/null || true
  # Service d'arrière-plan rangé DANS l'app : macOS l'affiche « LinkeD » (avec l'icône) dans
  # Ouverture et extensions, et Spotlight ne le propose pas comme un fichier à ouvrir.
  cp "$APP_DIR/scripts/mac/linked-service" "$APP/Contents/MacOS/linked-service"
  chmod +x "$APP/Contents/MacOS/linked-service"
  # signature locale : obligatoire sur les Mac Apple Silicon après modification de l'app
  codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
else
  # ── Secours (Electron absent) : petit lanceur qui ouvre l'app dans une fenêtre de navigateur ──
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
  cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>LinkeD</string>
  <key>CFBundleDisplayName</key><string>LinkeD</string>
  <key>CFBundleIdentifier</key><string>com.linked.launcher</string>
  <key>CFBundleExecutable</key><string>LinkeD</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
PLIST
  cat > "$APP/Contents/MacOS/LinkeD" <<'LAUNCHER'
#!/bin/bash
URL="http://localhost:3000"
up() { curl -s -o /dev/null --max-time 2 "$URL/api/me"; }
up || { launchctl kickstart -k "gui/$(id -u)/com.linked.app" 2>/dev/null; for _ in $(seq 1 40); do up && break; sleep 1; done; }
for B in "Google Chrome" "Microsoft Edge" "Brave Browser"; do
  [ -d "/Applications/$B.app" ] && open -na "$B" --args --app="$URL" && exit 0
done
open "$URL"
LAUNCHER
  chmod +x "$APP/Contents/MacOS/LinkeD"
  cp "$APP_DIR/scripts/mac/linked-service" "$APP/Contents/MacOS/linked-service"
  chmod +x "$APP/Contents/MacOS/linked-service"
  make_icns "$APP/Contents/Resources/AppIcon.icns"
fi

touch "$APP"   # force le Finder à rafraîchir l'icône
echo "$APP"
