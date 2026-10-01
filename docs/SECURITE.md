# Sécurité et données privées – LinkeD

Audit réalisé le 1er octobre 2026 sur l'ensemble du projet (code, dépôt GitHub, app, scripts d'installation).

## 1. Où sont tes données ?

| Donnée | Où elle est stockée | Qui peut y accéder |
|---|---|---|
| Mot de passe SoWeSoft, identifiant/PIN | `~/LinkeD/.env` et `~/LinkeD/data/settings.json` (fichiers lisibles par toi seul·e) | Toute personne qui a accès à ta session Mac |
| Lien iCal Hyperplanning (il contient une clé secrète) | Idem | Idem |
| Token du bot Telegram | `~/LinkeD/data/settings.json` | Idem |
| Session WhatsApp (si utilisée) | `~/LinkeD/data/whatsapp-session/` | Idem : elle donne accès à ton WhatsApp |
| Session SoWeSoft (~25 jours) | `~/LinkeD/data/sowesign-profile/` | Idem |
| Captures SoWeSoft (ton nom, tes cours) | `~/LinkeD/data/screenshots/`, **supprimées après 30 jours** | Idem |
| **Camarades de classe** : prénom, numéro de téléphone, identifiant Telegram | `~/LinkeD/data/members.json` (lisible par toi seul·e) | Toi, et toute personne qui a accès à ta session Mac |
| Messages du bot (rappels, codes, captures) | Serveurs **Telegram** (ou WhatsApp) | Telegram : les messages de bot ne sont pas chiffrés de bout en bout |
| Code source | GitHub, **dépôt public** | Tout le monde |

**Rien n'est envoyé ailleurs** : pas de serveur LinkeD, pas de statistiques, pas de publicité. LinkeD ne contacte que SoWeSoft, Hyperplanning, Telegram (ou WhatsApp) et GitHub (pour vérifier les mises à jour).

## 2. Le dépôt GitHub est public : est-ce un risque ?

✅ **Vérifié : aucune donnée privée n'est dans le dépôt, ni dans son historique.** Ni ton mot de passe, ni ton e-mail, ni ton lien iCal, ni ton nom, ni de token Telegram : le seul « token » du dépôt est un faux, utilisé dans les tests. `.env` et `data/` sont exclus de Git (`.gitignore`).

Ce qui est public et sans danger : le code, le code établissement OMNES (`7705`, commun à tous les élèves) et la documentation.

⚠️ À ne **jamais** faire : coller un mot de passe, un token ou ton lien iCal dans un fichier du dépôt, une *issue* ou un commentaire GitHub.

## 3. Données de tes camarades (fonction « Classe »)

- **Consentement** : n'ajoute que les personnes qui te l'ont demandé. Ce sont des données personnelles (RGPD) : tu en es responsable.
- **Minimum de données** : un prénom et un numéro, rien d'autre. Ni mot de passe ni accès SoWeSoft. LinkeD **ne signe jamais** à leur place.
- **Inscription vérifiée** : un camarade ne peut rejoindre le bot qu'en partageant **son propre** numéro (Telegram indique à qui appartient le contact partagé), ou par son lien personnel. Un inconnu qui trouve le bot ne reçoit rien.
- **Ils gardent la main** : *stop* coupe leurs rappels. Toi, tu peux les mettre en pause ou les retirer à tout moment, et la suppression efface leurs données de `members.json`.
- **Ce qu'ils voient** : uniquement leurs rappels, le planning du jour (cours et salles) et leurs propres réponses. Ils ne voient ni les autres membres, ni tes réglages, ni ton compte.
- Les numéros ne sont **jamais** envoyés à Telegram : le bot reçoit le numéro seulement quand la personne le partage elle-même.

## 4. Failles trouvées et corrigées

| Gravité | Problème | Correction |
|---|---|---|
| 🔴 Haute | **App ouverte à tout le réseau** : avec un mot de passe défini, l'app écoutait sur le Wi-Fi. Sur le réseau de l'école, n'importe qui pouvait la trouver et tenter de deviner le mot de passe, qui passait en clair (HTTP). | L'app n'écoute plus **que sur ton Mac** (`127.0.0.1`). L'ouverture au réseau devient un choix explicite (`WEB_HOST`), refusé sans mot de passe. |
| 🔴 Haute | **Attaque depuis un site web piégé (CSRF / DNS rebinding)** : une page visitée dans ton navigateur pouvait envoyer des ordres à l'app en arrière-plan (signer, changer le bot Telegram, lancer une mise à jour). | Requêtes refusées si elles viennent d'un autre site (vérification de l'origine), si elles ne sont pas en JSON, ou si le nom d'hôte n'est pas local. Testé automatiquement. |
| 🟠 Moyenne | **Mots de passe essayés en rafale** possibles sur l'écran de connexion. | Blocage de 15 min après 5 essais ratés, plus 1 s d'attente par essai. |
| 🟠 Moyenne | **Sessions de l'app sans expiration** côté serveur. | Jetons aléatoires de 256 bits, expirant après 30 jours. |
| 🟡 Faible | Pas d'en-têtes de sécurité (l'app pouvait être affichée dans une iframe, c'est-à-dire intégrée dans une autre page). | Ajout de CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, etc. |
| 🟡 Faible | Captures SoWeSoft (nom, cours) conservées indéfiniment. | Suppression automatique après 30 jours. |
| 🟡 Faible | Bibliothèque `extract-zip` vulnérable, utilisée par Puppeteer pour décompresser Chromium à l'installation. | Puppeteer mis à jour en v25 pour le robot SoWeSoft. Il reste une copie dans `whatsapp-web.js` (WhatsApp, optionnel) : exploitable seulement avec une archive piégée, alors que Chromium est téléchargé depuis les serveurs de Google. |

Déjà en place avant l'audit : bot Telegram **privé** (il ne répond qu'au compte relié avec le code de l'app), mot de passe comparé en temps constant, cookie `HttpOnly` + `SameSite=Strict`, fichiers de configuration en `600` et dossier `data/` en `700`, captures servies sans traversée de dossier, **aucune nouvelle tentative de connexion SoWeSoft après un échec** (le compte serait bloqué au bout de 3).

## 5. Risques qui restent (et comment les limiter)

1. **Quelqu'un qui utilise ta session Mac** peut lire tes identifiants : les fichiers sont protégés par les droits macOS, mais pas chiffrés par LinkeD.
   → Active **FileVault** (Réglages Système → Confidentialité et sécurité), mets un **mot de passe de session** et verrouille ton Mac quand tu t'absentes.
2. **Mises à jour** : le bouton « Mettre à jour » installe le code de la branche GitHub du projet. Quelqu'un qui prendrait le contrôle de ton compte GitHub pourrait donc pousser du code qui s'exécuterait sur ton Mac.
   → Active la **double authentification (2FA)** sur ton compte GitHub.
3. **Messages Telegram** : les rappels et les captures passent par les serveurs de Telegram, comme tout message de bot.
   → Pas d'information sensible dedans à part ton nom et tes cours. Ne partage jamais le token du bot (si c'est arrivé : @BotFather → `/revoke`).
4. **WhatsApp (optionnel)** : la session relie ton compte comme un « appareil connecté ». Si quelqu'un copie le dossier `whatsapp-session`, il accède à ton WhatsApp.
   → Préfère Telegram. Sinon, vérifie de temps en temps WhatsApp → Appareils connectés.
5. **Usage de l'émargement** : signer en étant absent·e reste une fausse déclaration, bot ou pas. Vérifie aussi que le règlement de ton école autorise ce type d'outil.

## 6. À faire de ton côté

- [ ] **Change ton mot de passe SoWeSoft** : il a été écrit dans une conversation, donc il ne doit plus être considéré comme secret. Mets ensuite le nouveau dans l'app.
- [ ] Choisis un **mot de passe d'app** différent de tes autres mots de passe.
- [ ] Active **FileVault** et le verrouillage automatique du Mac.
- [ ] Active la **2FA sur GitHub**.
- [ ] Ne partage ni le token Telegram ni ton lien iCal.
