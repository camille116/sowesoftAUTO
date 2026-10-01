#!/bin/bash
# Fabrique LinkeD.app (dossier Applications) : un double-clic démarre LinkeD si besoin et ouvre l'appli.
#   bash scripts/mac/make-app.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="com.linked.app"
DEST="/Applications"
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"
APP="$DEST/LinkeD.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
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
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
PLIST

cat > "$APP/Contents/MacOS/LinkeD" <<LAUNCHER
#!/bin/bash
# Lanceur LinkeD : (re)démarre le service en arrière-plan si besoin, puis ouvre l'appli.
URL="http://localhost:3000"
PLIST="\$HOME/Library/LaunchAgents/$LABEL.plist"
up() { curl -s -o /dev/null --max-time 2 "\$URL/api/me"; }
if ! up; then
  launchctl bootstrap "gui/\$(id -u)" "\$PLIST" 2>/dev/null || launchctl kickstart -k "gui/\$(id -u)/$LABEL" 2>/dev/null
  for _ in \$(seq 1 40); do up && break; sleep 1; done
fi
if ! up; then
  osascript -e 'display alert "LinkeD ne démarre pas" message "Ouvre le journal : ~/LinkeD/data/linked.log, ou relance « Installer LinkeD »." as critical'
  exit 1
fi
# Fenêtre d'app sans barre d'adresse si Chrome est installé, sinon navigateur par défaut
for BROWSER in "Google Chrome" "Microsoft Edge" "Brave Browser"; do
  if [ -d "/Applications/\$BROWSER.app" ]; then
    open -na "\$BROWSER" --args --app="\$URL" && exit 0
  fi
done
open "\$URL"
LAUNCHER
chmod +x "$APP/Contents/MacOS/LinkeD"

# Icône (.icns) à partir de assets/icon-1024.png
ICON_SRC="$APP_DIR/assets/icon-1024.png"
if [ -f "$ICON_SRC" ] && command -v iconutil >/dev/null 2>&1; then
  SET="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$SET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$ICON_SRC" --out "$SET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$ICON_SRC" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns"
fi

touch "$APP"   # force le Finder à rafraîchir l'icône
echo "$APP"
