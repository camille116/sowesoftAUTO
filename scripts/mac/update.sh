#!/bin/bash
# Met LinkeD à jour vers un commit précis (appelé par le bouton « Mettre à jour » de l'appli).
#   bash scripts/mac/update.sh <propriétaire/dépôt> <sha>
# Garde data/ (sessions, réglages, historique), .env et config/planning.json.
set -euo pipefail

REPO="$1"
SHA="$2"
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "dépôt invalide"; exit 2; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "version invalide"; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "[$(date '+%F %T')] Mise à jour vers $SHA"

curl -fsSL --retry 3 "https://codeload.github.com/$REPO/zip/$SHA" -o "$TMP/linked.zip"
unzip -q "$TMP/linked.zip" -d "$TMP/src"
SRC="$(find "$TMP/src" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -f "$SRC/package.json" ] && [ -f "$SRC/src/index.js" ] || { echo "archive inattendue"; exit 3; }

rsync -a --delete \
  --exclude node_modules --exclude data --exclude .env --exclude .git --exclude VERSION \
  --exclude config/planning.json \
  "$SRC/" "$APP_DIR/"

cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund --loglevel=error
echo "$SHA" > VERSION
bash scripts/mac/make-app.sh >/dev/null 2>&1 || true
echo "[$(date '+%F %T')] OK"
