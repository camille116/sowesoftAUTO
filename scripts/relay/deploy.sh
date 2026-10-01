#!/bin/bash
# Déploie le relais LinkeD sur TON compte Cloudflare (gratuit). Connexion par navigateur : aucune clé à coller.
#   npm run relay:deploy
# À la fin, l'URL et la clé à coller dans l'app (Réglages → Relais cloud) s'affichent.
set -uo pipefail
cd "$(dirname "$0")/../../relay" || exit 1

bold() { printf "\n\033[1m%s\033[0m\n" "$1"; }
die() { printf "\n❌ %s\n" "$1"; exit 1; }
WRANGLER="npx --yes wrangler@4"
CFG="--config wrangler.generated.toml"

bold "☁️  Déploiement du relais LinkeD sur Cloudflare"
echo "Une page Cloudflare va s'ouvrir pour la connexion (compte gratuit à créer si besoin)."
$WRANGLER login || die "Connexion à Cloudflare annulée. Relance : npm run relay:deploy"

# 1. Base de données D1 (ignore l'erreur si elle existe déjà)
bold "📦 Base de données…"
CREATE_OUT="$($WRANGLER d1 create linked-relay 2>&1)"
echo "$CREATE_OUT"
UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
DB_ID="$(printf '%s' "$CREATE_OUT" | grep -oiE "$UUID" | head -1)"
# base déjà créée (ton cas) : on récupère son id autrement
[ -n "$DB_ID" ] || DB_ID="$($WRANGLER d1 info linked-relay 2>/dev/null | grep -oiE "$UUID" | head -1)"
[ -n "$DB_ID" ] || DB_ID="$($WRANGLER d1 list --json 2>/dev/null | grep -oiE "$UUID" | head -1)"
[ -n "$DB_ID" ] || die "Impossible de récupérer l'identifiant de la base. Relance la commande."
# On écrit l'id dans une copie locale (wrangler.toml reste intact dans Git)
sed "s/database_id = \"PLACEHOLDER\"/database_id = \"$DB_ID\"/" wrangler.toml > wrangler.generated.toml
echo "   base : $DB_ID"

# 2. Schéma
$WRANGLER d1 execute linked-relay --remote --file schema.sql $CFG -y >/dev/null 2>&1 \
  || die "Création des tables impossible. Relance la commande dans 1 min (la base vient d'être créée)."
echo "   tables créées"

# 3. Mise en ligne du Worker (DOIT précéder la clé : on ne pose pas de clé sur un Worker inexistant)
bold "🚀 Mise en ligne du relais…"
DEPLOY_OUT="$($WRANGLER deploy $CFG 2>&1)"
echo "$DEPLOY_OUT"
if printf '%s' "$DEPLOY_OUT" | grep -qi 'workers.dev subdomain'; then
  ONBOARD="$(printf '%s' "$DEPLOY_OUT" | grep -oiE 'https://dash\.cloudflare\.com/[^ ]+/workers/onboarding' | head -1)"
  die "Étape à faire une seule fois : choisis ton sous-domaine workers.dev ici, puis relance la commande :
     ${ONBOARD:-https://dash.cloudflare.com/ → Workers & Pages → choisir un sous-domaine}"
fi
printf '%s' "$DEPLOY_OUT" | grep -qiE 'success|deployed|uploaded|workers\.dev' || die "La mise en ligne a échoué (voir ci-dessus)."
URL="$(printf '%s' "$DEPLOY_OUT" | grep -oiE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)"

# 4. Clé secrète, partagée entre le Mac et le relais.
# Si une clé existe déjà (redéploiement), on la GARDE : ta configuration dans LinkeD reste valable.
bold "🔑 Clé de sécurité…"
if $WRANGLER secret list $CFG 2>/dev/null | grep -q RELAY_SECRET; then
  echo "   clé existante conservée"
  bold "✅ Relais à jour !"
  cat <<TXT

  Ton relais est à jour. Rien à recoller : garde l'URL et la clé déjà dans LinkeD.
    URL : ${URL:-'(voir « Uploaded » ci-dessus, se termine par .workers.dev)'}
TXT
else
  SECRET="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40)"
  printf '%s' "$SECRET" | $WRANGLER secret put RELAY_SECRET $CFG >/dev/null 2>&1 \
    || die "Impossible d'enregistrer la clé. Relance la commande."
  echo "   clé enregistrée"
  bold "✅ Relais en ligne !"
  cat <<TXT

  Dans LinkeD → Réglages → Relais cloud, colle :

    URL  : ${URL:-'(se termine par .workers.dev — voir « Uploaded » ci-dessus)'}
    Clé  : $SECRET

  Puis clique sur « Activer ». Le relais enverra les rappels quand ton Mac est éteint.
  (Note bien la clé : elle ne sera plus affichée.)
TXT
fi
