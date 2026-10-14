# Signature automatique dans le cloud (GitHub Actions) — gratuit, sans Mac

Signe tout seul les cours **sans code** (autonomie, projet…), **sans aucun appareil allumé chez toi**
et **sans carte bancaire** : ça tourne sur les serveurs gratuits de GitHub (GitHub Actions).

> Pour les cours **à code**, ça reste géré par ton Mac (rappels + envoi du code / scan WhatsApp).
> Ici on ne fait que les cours **sans code**.

## Ce qu'il faut faire une seule fois

1. **Activer les Actions** : sur GitHub → ton dépôt `sowesoftAUTO` → onglet **Actions** → si c'est désactivé,
   clique pour activer les workflows.

2. **Ajouter tes identifiants SoWeSoft** (ils restent chiffrés, personne ne peut les lire) :
   dépôt → **Settings → Secrets and variables → Actions → New repository secret**, et crée :
   - `SOWESIGN_EMAIL` = ton e-mail SoWeSoft
   - `SOWESIGN_PASSWORD` = ton mot de passe SoWeSoft
   - *(optionnel)* `SOWESIGN_INSTITUTION` = `7705` (déjà la valeur par défaut)

3. *(Optionnel) Recevoir une notif Telegram quand ça signe* — ajoute 2 secrets :
   - `TELEGRAM_BOT_TOKEN` = le token de ton bot (celui déjà dans LinkeD)
   - `TELEGRAM_CHAT_ID` = ton identifiant de chat Telegram (donné par `@userinfobot` sur Telegram)

4. *(Optionnel) Choisir la signature* — onglet **Variables** (à côté de Secrets) :
   - `SIGNATURE_STYLE` = `claude`, `name` ou `psg`
   - `SIGN_DRY_RUN` = `true` pour **tester sans valider** (par défaut `false` = signe pour de vrai)

## Tester tout de suite

Onglet **Actions → « Auto-signature SoWeSoft » → Run workflow**.
Regarde les logs : « aucun cours » (normal hors cours), « Signé automatiquement », ou « ce cours demande un code ».

## Comment ça marche / limites

- Ça se déclenche **toutes les 20 min, en semaine, 6h–18h UTC** (≈ 7h/8h–19h/20h en France).
- **Le timing n'est pas à la minute** : GitHub peut lancer la tâche avec **5–20 min de retard**. Pour une
  signature d'autonomie c'est OK (la fenêtre dure tout le cours), mais ce n'est pas instantané.
- La session SoWeSoft est **gardée entre les passages** (cache GitHub) : pas de reconnexion à chaque fois.
- C'est **gratuit** (bien dans les minutes offertes), **aucune carte**.
- Si tu changes ton mot de passe SoWeSoft, **mets à jour le secret** `SOWESIGN_PASSWORD`.

## Couper

Onglet **Actions → « Auto-signature SoWeSoft » → … → Disable workflow**.
