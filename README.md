# ⚡ LinkeD

**Ne rate plus jamais une signature SoWeSoft.** LinkeD :

1. **lit ton emploi du temps** Hyperplanning (lien iCal) ;
2. **te rappelle de signer** sur Telegram (ou WhatsApp) pour les cours que tu choisis : autonomie et e-learning, tous les cours, ou une sélection de matières ;
3. **signe à ta place** quand tu lui envoies le code à 5 chiffres, et te renvoie la capture SoWeSoft comme preuve.

Tout se pilote depuis **l'app LinkeD** (tableau de bord, planning, activité, réglages), installée sur ton Mac comme une application normale, avec un bouton **« Mettre à jour »**.

```
 Hyperplanning ─┐                          ┌──────────────┐
                ├─► Planning ─► Rappels ──►│  Telegram /  │◄── toi : « 48213 »
 planning.json ─┘                          │  WhatsApp    │
                                           └──────┬───────┘
                                                  ▼
                                     Robot navigateur (Chromium)
                                                  ▼
                                       SoWeSoft (app.sowesign.com) ✅
```

| Document | Contenu |
|---|---|
| [`docs/INSTALLATION-MAC.md`](docs/INSTALLATION-MAC.md) | **Installer LinkeD sur Mac, sans Terminal** |
| [`docs/SECURITE.md`](docs/SECURITE.md) | Où sont tes données, qui peut y accéder, audit de sécurité |
| [`docs/CADRAGE.md`](docs/CADRAGE.md) | Dossier de cadrage : persona, parcours, marque, architecture, roadmap |

---

## 🚀 Installation

**Sur Mac (recommandé)** : télécharge le ZIP, puis fais un clic droit sur **« Installer LinkeD.command » → Ouvrir**. C'est tout : l'app **LinkeD** apparaît dans Applications. Le guide pas à pas est dans [`docs/INSTALLATION-MAC.md`](docs/INSTALLATION-MAC.md).

**Ailleurs (Linux, serveur, développement)** : Node.js 22.12 ou plus.

```bash
git clone https://github.com/camille116/sowesoftAUTO.git && cd sowesoftAUTO
cp .env.example .env        # au minimum : WEB_PASSWORD
npm install
npm start                   # puis http://localhost:3000
```

Avec Docker : `docker compose up -d --build`.

---

## 📱 L'app

| Écran | Ce que tu y fais |
|---|---|
| **Tableau de bord** | Session en cours (à signer / signé), indicateurs du jour et du mois, **code à 5 cases + « Signer maintenant »**, cours du jour, test de notification, pause des rappels |
| **Planning** | Tes cours notifiés sur 7 ou 30 jours, avec leur statut et leur type (AUTONOMIE, CRS, ELEARNING…) ; « Fait » ou « Ignorer » |
| **Activité** | Rappels, signatures (avec la capture SoWeSoft), erreurs |
| **Réglages** | Messagerie (bot Telegram ou WhatsApp), **cours notifiés**, moments des rappels, compte SoWeSoft, mode test, agenda, **mise à jour** |

### Choisir les cours notifiés

Réglages → **Notifications** :
- **Autonomie & e-learning** (par défaut) : les créneaux dont le type contient un mot-clé (`autonomie`, `elearning`…) ;
- **Tous les cours** ;
- **Sélection** : la liste des matières de ton Hyperplanning (60 prochains jours) s'affiche avec leurs types, et tu coches celles que tu veux.

### Mise à jour

Quand une nouvelle version est publiée, **« Mise à jour disponible »** s'affiche en bas à gauche. Réglages → Application → **Mettre à jour** : LinkeD télécharge la dernière version depuis GitHub, l'installe en gardant `data/`, `.env` et `config/planning.json`, puis redémarre (1 à 3 min). Cette fonction est disponible sur Mac, une fois LinkeD installé avec l'installeur.

### Démo

`npm run demo`, puis ouvre http://localhost:3000 (mot de passe `demo`). Faux planning, faux robot ; le code `00000` simule un échec.

---

## 💬 Messagerie : Telegram (recommandé) ou WhatsApp

| | Telegram | WhatsApp |
|---|---|---|
| Type | **Bot officiel**, contact « LinkeD » séparé | Ton WhatsApp relié comme « appareil connecté » (non officiel) |
| Mise en place | Créer le bot avec @BotFather (2 min), coller le token, « Relier Telegram » | Saisir ton numéro, scanner un QR code |
| Fiabilité | ✅ API stable | ⚠️ Peut casser quand WhatsApp change son site |

Le bot Telegram ne répond qu'au compte relié avec le code de l'app : les autres reçoivent « Ce bot est privé ».

| Tu envoies | LinkeD fait |
|---|---|
| `48213` · `code 48213` | Signe avec ce code et renvoie la capture ✅ |
| `fait` | Note que tu as signé toi-même, arrête les rappels |
| `ignore` | Ignore le créneau en cours |
| `planning` · `demain` · `semaine` | Liste tes créneaux (✅ / ⬜) |
| `statut` · `pause` · `reprendre` · `test` · `aide` | Statut, couper ou relancer les rappels, tester SoWeSoft, aide |

---

## ⚙️ Fonctionnement

**Planning.** Le lien iCal Hyperplanning est relu toutes les 30 minutes. Pour chaque cours, LinkeD lit la matière (`Matière : …`) et le type (`Type : AUTONOMIE / CRS / ELEARNING…`). `config/planning.json` permet d'ajouter des créneaux à la main (vide par défaut ; exemple dans `config/planning.example.json`).

**Rappels.** Par défaut à -5, 0, +15 et +45 minutes par rapport au début du cours, tant que ce n'est pas signé. Après une coupure, seul le dernier rappel dû est envoyé.

**Signature SoWeSoft** (robot Chromium invisible, parcours relevé sur la vraie appli OMNES) :
1. connexion à `app.sowesign.com` (code établissement 7705, puis e-mail + mot de passe, identifiant + PIN, ou session Microsoft enregistrée via `npm run sowesign:login`) ;
2. fermeture de la fenêtre « Informations légales » ;
3. saisie du code à 5 chiffres ;
4. dessin de la signature si l'école l'exige ;
5. attente de « Votre présence a bien été enregistrée », puis capture.

- **Session gardée** environ 25 jours : LinkeD ne se reconnecte que lorsqu'elle expire.
- **Anti-blocage** : SoWeSoft bloque le compte après 3 échecs de connexion. Après un échec, LinkeD ne réessaie plus seul, jusqu'à ce que tu cliques sur « Tester la connexion ».
- **Mode test** : LinkeD tape 4 chiffres sur 5. Le 5e n'étant pas saisi, rien n'est envoyé à SoWeSoft.

---

## 🧪 Développement

```bash
npm test     # 55 tests : planning, rappels, bot, Telegram, WhatsApp, API, sécurité, mises à jour, parcours SoWeSoft dans Chromium
npm run demo
```

```
src/
├── index.js            point d'entrée
├── app.js              assemblage + réglages appliqués à chaud
├── bot.js              logique du bot (indépendante de la messagerie)
├── settings.js         réglages modifiables depuis l'app (data/settings.json)
├── telegram.js         canal Telegram (API officielle, long polling)
├── whatsapp.js         canal WhatsApp (whatsapp-web.js)
├── updater.js          vérification et installation des mises à jour
├── planning/           agenda ICS (matières, types, sélection) + planning manuel
├── sowesign/           robot de signature SoWeSoft + connexion manuelle
└── web/                serveur + API (server.js), interface (public/), démo
scripts/mac/            install.sh · update.sh · make-app.sh (LinkeD.app) · uninstall.sh
```

---

## ⚠️ À lire

- **Utilise la signature automatique uniquement quand tu es vraiment en cours.** L'émargement atteste ta présence et compte pour l'assiduité, les financements et l'alternance. Vérifie aussi le règlement de ton école.
- Tes identifiants restent **sur ta machine** (`.env`, `data/`, jamais commités). Le dépôt GitHub est public : n'y colle jamais de mot de passe, de token ou ton lien iCal. Les détails sont dans [`docs/SECURITE.md`](docs/SECURITE.md).
