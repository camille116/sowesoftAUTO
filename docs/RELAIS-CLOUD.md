# Relais cloud : LinkeD même quand ton Mac est éteint

Par défaut, LinkeD tourne sur ton Mac : Mac éteint ou en veille, rien ne part. Le **relais cloud** est un petit programme gratuit, hébergé sur **ton** compte Cloudflare, qui prend le relais.

## Ce qu'il fait (et ne fait pas)

- ✅ Envoie **les rappels** à toi et à ta classe sur Telegram, même Mac éteint.
- ✅ Répond à **toutes tes commandes** même Mac éteint : `/demain`, `/planning`, `/statut`, `fait`, `stop`, `reprendre`, et l'inscription de la classe (partage du numéro, lien d'invitation).
- ✅ Évite les doublons avec le Mac quand il est allumé.
- ❌ **Ne signe jamais** sur SoWeSoft à distance (ça voudrait dire émarger sans être en cours). Un code envoyé **Mac allumé** est signé en quelques secondes ; **Mac éteint**, le relais te répond d'aller signer toi-même sur l'appli SoWeSoft.

Quand le relais est activé, c'est lui qui reçoit les messages Telegram (webhook) ; ton Mac continue d'envoyer les confirmations et de signer. Si tu retires le relais, ton Mac reprend la main tout seul.

## Installer (une fois, ~5 minutes)

1. Compte **Cloudflare** gratuit sur cloudflare.com (sans carte bancaire).
2. Dans le Terminal du Mac :
   ```
   cd ~/LinkeD && npm run relay:deploy
   ```
3. Autorise la connexion Cloudflare dans le navigateur.
4. La **première fois**, choisis un sous-domaine quand Cloudflare le demande (Workers & Pages).
5. À la fin, le Terminal affiche une **URL** et une **clé**.
6. Dans LinkeD → **Réglages → Relais cloud**, colle les deux, puis **Activer**.

Pour vérifier : ouvre `https://<ton-relais>.workers.dev/health`. Si tu vois `"hasSnapshot":true`, le cloud a bien ton planning. Le bouton **« Rappel test depuis le cloud »** envoie un message Telegram depuis le cloud pour confirmer.

## Coût

**Gratuit.** Cloudflare offre 100 000 requêtes/jour ; LinkeD en consomme ~3 000 (3 %). Sans carte bancaire, aucune facturation possible.

## Confidentialité

- Le relais tourne sur **ton** compte Cloudflare, pas sur un serveur tiers.
- Il stocke ton lien iCal, ton token de bot Telegram, et pour la classe les prénoms, numéros et identifiants Telegram. **Jamais** ton mot de passe SoWeSoft (il ne quitte pas ton Mac).
- La clé du relais protège l'accès : ne la partage pas. Pour tout couper : supprime le Worker « linked-relay » dans Cloudflare, ou vide les champs dans LinkeD.
