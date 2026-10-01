#!/bin/bash
# Déploie le relais LinkeD sur TON compte Cloudflare (gratuit). Connexion par navigateur : aucune clé à coller.
#   npm run relay:deploy
# À la fin, l'URL et la clé à coller dans l'app (Réglages → Relais cloud) s'affichent.
set -euo pipefail
cd "$(dirname "$0")/../../relay"

bold() { printf "\n\033[1m%s\033[0m\n" "$1"; }
WRANGLER="npx --yes wrangler@4"

bold "☁️  Déploiement du relais LinkeD sur Cloudflare"
echo "Une page Cloudflare va s'ouvrir pour la connexion (compte gratuit à créer si besoin)."
$WRANGLER login

# 1. Base de données D1 (ignore l'erreur si elle existe déjà)
bold "📦 Base de données…"
CREATE_OUT="$($WRANGLER d1 create linked-relay 2>&1 || true)"
echo "$CREATE_OUT"
DB_ID="$(printf '%s' "$CREATE_OUT" | grep -oE '[0-9a-f-]{36}' | head -1)"
if [ -z "$DB_ID" ]; then
  DB_ID="$($WRANGLER d1 list --json 2>/dev/null | grep -B2 '"name": "linked-relay"' | grep -oE '[0-9a-f-]{36}' | head -1 || true)"
fi
[ -n "$DB_ID" ] || { echo "❌ Impossible de récupérer l'identifiant de la base. Relance la commande."; exit 1; }
# On écrit l'id dans une copie locale (wrangler.toml reste intact dans Git)
sed "s/database_id = \"PLACEHOLDER\"/database_id = \"$DB_ID\"/" wrangler.toml > wrangler.generated.toml
echo "   base : $DB_ID"

# 2. Schéma
$WRANGLER d1 execute linked-relay --remote --file schema.sql --config wrangler.generated.toml -y >/dev/null
echo "   tables créées"

# 3. Clé secrète (générée, partagée entre le Mac et le relais)
SECRET="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40)"
printf '%s' "$SECRET" | $WRANGLER secret put RELAY_SECRET --config wrangler.generated.toml >/dev/null
echo "   clé enregistrée"

# 4. Déploiement
bold "🚀 Mise en ligne…"
DEPLOY_OUT="$($WRANGLER deploy --config wrangler.generated.toml 2>&1)"
echo "$DEPLOY_OUT"
URL="$(printf '%s' "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)"

bold "✅ Relais en ligne !"
cat <<TXT

  Dans LinkeD → Réglages → Relais cloud, colle :

    URL  : ${URL:-'(voir ci-dessus, se termine par .workers.dev)'}
    Clé  : $SECRET

  Puis clique sur « Activer ». Le relais enverra les rappels quand ton Mac est éteint.
TXT
