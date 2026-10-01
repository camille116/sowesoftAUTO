# ✍️ Émile – ton assistant d'émargement WhatsApp

Émile est un bot WhatsApp qui :

1. **lit ton planning** (agenda ICS de l'école et/ou planning manuel) et repère tes **heures d'autonomie** ;
2. **t'envoie un message quand tu dois signer** sur Sowesoft / SoWeSign, et te relance tant que ce n'est pas fait ;
3. **signe à ta place** quand tu lui envoies le code de cours à 5 chiffres (`48213`), puis te renvoie une capture d'écran comme preuve.

Le tout se pilote depuis **l'appli Émile** : une interface web installable sur ton téléphone.

> Le dossier de cadrage du projet (persona, parcours, ton de marque, architecture, roadmap) est dans [`docs/CADRAGE.md`](docs/CADRAGE.md).

```
 Agenda ICS ─┐                       ┌──────────────┐
             ├─► Planning ─► Rappels ─►│  WhatsApp    │◄── toi : « 48213 »
 planning.json┘                       └──────┬───────┘
                                             ▼
                                  Robot navigateur (Chromium)
                                             ▼
                                   Sowesoft / SoWeSign ✅
```

---

## 🚀 Installation

> 🍎 **Sur Mac : suis le guide pas à pas [`docs/INSTALLATION-MAC.md`](docs/INSTALLATION-MAC.md)** (script automatique, démarrage avec le Mac).

Il faut une machine allumée en continu (Raspberry Pi, petit VPS, vieux PC…) avec **Node.js 20+** ou **Docker**.

```bash
git clone https://github.com/camille116/sowesoftAUTO.git
cd sowesoftAUTO
cp .env.example .env        # puis remplis le fichier (voir ci-dessous)
npm install
npm start                   # un QR code s'affiche (aussi dans l'appli → Réglages)
```

Scanne le QR code depuis WhatsApp → **Appareils connectés → Connecter un appareil**. La session est mémorisée dans `data/`, tu ne le fais qu'une fois.

### Avec Docker

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f      # pour scanner le QR code la 1re fois
```

### Quel numéro pour le bot ?

| Option | Comment | Où tu parles au bot |
|---|---|---|
| **Ton propre numéro** (simple) | Tu scannes le QR avec ton téléphone | Discussion **« Moi (Vous) »** (message à toi-même) |
| **Un 2e numéro** (plus propre) | SIM/eSIM dédiée ou WhatsApp Business | Une discussion normale avec « Émile » |

Dans les deux cas, renseigne **ton** numéro dans `OWNER_NUMBER` : le bot ignore tous les autres.

---

## 📱 L'appli Émile

Dès que le bot tourne, ouvre **http://localhost:3000** sur la machine du bot. Depuis ton téléphone, sur le même Wi-Fi, ouvre `http://<ip-de-la-machine>:3000`.

| Écran | Ce que tu y fais |
|---|---|
| **Accueil** | Voir le créneau en cours (rouge = à signer, vert = signé), **taper le code et signer** en un bouton, couper/relancer les rappels |
| **Planning** | Tes autonomies et e-learnings sur 7 jours ou un mois, avec leur statut ; marquer « signé moi-même » ou « ignorer » |
| **Historique** | Rappels envoyés, signatures (avec la capture SoWeSoft en grand), erreurs |
| **Réglages** | **QR code WhatsApp** à scanner, identifiants SoWeSoft, mode test, horaires des rappels, mots-clés, lien iCal, bouton « Tester la connexion » |

- **Mot de passe** : définis `WEB_PASSWORD` dans `.env` pour ouvrir l'appli aux autres appareils de ton réseau. Sans mot de passe, elle n'est accessible que depuis la machine du bot.
- **Installer sur le téléphone** : ouvre l'appli dans Safari ou Chrome, puis « Ajouter à l'écran d'accueil ».
- Ce que tu modifies dans **Réglages** est enregistré dans `data/settings.json`, jamais commité, et prend le dessus sur `.env`.
- **Démo sans rien configurer** : `npm run demo`, puis ouvre http://localhost:3000 (mot de passe `demo` ; le code `00000` simule un échec).

> Pour y accéder depuis l'extérieur (4G), ne mets pas l'appli directement sur Internet : passe par un tunnel privé comme [Tailscale](https://tailscale.com) (gratuit), qui relie ton téléphone et la machine du bot.

---

## ⚙️ Configuration

### 1. Le planning (`.env` + `config/planning.json`)

**Option A – agenda de l'école (recommandé).** La plupart des outils d'emploi du temps (Hyperplanning, Ypareo, Aurion, Google Agenda, Outlook…) proposent un lien d'export **ICS / iCal**. Colle-le dans `ICS_URL`.
Les créneaux sont retenus si leur titre, description ou lieu contient un des `AUTONOMY_KEYWORDS` (`autonomie,autonome,travail personnel,elearning…`).

**Option B – planning manuel.** Édite `config/planning.json` (vide par défaut ; exemple dans `config/planning.example.json`) :

```json
{
  "weekly":     [{ "day": "mardi", "start": "13:30", "end": "17:00", "title": "Autonomie – projet" }],
  "dates":      [{ "date": "2026-10-14", "start": "09:00", "end": "12:00", "title": "Rattrapage" }],
  "exceptions": ["2026-10-27"]
}
```

Les deux sources sont fusionnées. Vérifie ce que le bot a compris :

```bash
npm run planning
```

### 2. Les rappels

`REMINDER_OFFSETS=-5,0,15,45` → un message 5 min avant, au début, puis 15 et 45 min après si tu n'as toujours pas signé. Les rappels s'arrêtent dès que c'est signé (par le bot ou toi avec « fait »).

### 3. La signature automatique (SoWeSoft – app.sowesign.com)

Le robot reproduit exactement ce que tu fais sur ton téléphone, dans un Chromium invisible :

1. **Connexion** sur `app.sowesign.com/login` : code établissement **7705** (OMNES), puis ta méthode de connexion ;
2. **Espace étudiant** : il ferme la fenêtre « Informations légales » si elle s'affiche ;
3. **Code à 5 chiffres** tapé dans les cases du cours en cours ;
4. **Pad de signature** (si ton école l'exige) : il dessine une signature qui occupe le cadre et valide ;
5. **Vérification** : il attend « Votre présence a bien été enregistrée » et t'envoie la capture.

Choisis ta méthode de connexion dans `.env` :

| `SOWESIGN_LOGIN_METHOD` | À remplir | Automatique ? |
|---|---|---|
| `password` (par défaut) | `SOWESIGN_EMAIL`, `SOWESIGN_PASSWORD` | ✅ oui |
| `code` | `SOWESIGN_ID` (8 chiffres), `SOWESIGN_PIN` (4 chiffres) | ✅ oui |
| `sso` (Microsoft OMNES) | rien : lance `npm run sowesign:login` et connecte-toi à la main | ⚠️ à refaire quand la session expire (~25 jours) |

La session SoWeSoft est gardée dans `data/sowesign-profile/` (~25 jours) : le bot ne se reconnecte que lorsqu'elle a expiré.

> 🔒 **Anti-blocage** : SoWeSoft bloque le compte après 3 connexions ratées. Si une connexion échoue, le bot **ne réessaie plus tout seul** et te prévient. Corrige `.env`, puis envoie *test* pour le débloquer.

**Mode test** : laisse `SIGN_DRY_RUN=true` au début. Le bot fait tout le parcours mais tape seulement les **4 premiers chiffres** (rien n'est envoyé à SoWeSoft tant que le 5e n'est pas saisi) et t'envoie la capture. Quand c'est bon, passe à `false`.

Les sélecteurs de l'interface sont dans `config/sowesign.json` : à toucher seulement si SoWeSoft change son application.

---

## 💬 Utilisation

| Tu envoies | Émile fait |
|---|---|
| `48213` · `code 48213` · `signe 48213` | Signe avec ce code et renvoie une capture ✅ |
| `fait` · `signé` | Note que tu as signé toi-même, arrête les rappels |
| `ignore` | Ignore le créneau en cours (cours annulé…) |
| `planning` · `demain` · `semaine` | Liste tes créneaux d'autonomie (✅ / ⬜) |
| `statut` | Rappels actifs ?, créneau en cours, prochain créneau |
| `pause` · `reprendre` | Coupe / relance les rappels (vacances) |
| `test` | Vérifie la connexion à SoWeSoft (capture) et la débloque après une erreur |
| `aide` | Rappelle les commandes |

Exemple :

```
🤖 ✍️ C'est l'heure de signer !
13:30–17:00 · Autonomie – projet
👉 Envoie-moi le code et je signe, ou réponds fait si c'est déjà fait.

toi : 48213

🤖 Je signe avec le code 48213… ⏳
🤖 ✅ Signé !  [capture d'écran]
```

---

## 🧪 Développement

```bash
npm test     # 34 tests : commandes, planning, rappels, bot, API de l'appli, et parcours SoWeSoft complet dans Chromium
```

Le test de signature lance un vrai Chromium contre une fausse appli SoWeSoft qui reproduit la structure de la vraie (`test/fixtures/mock-sowesign.js`). Définis `CHROME_PATH` si Chromium n'est pas trouvé ; sinon ce test est ignoré.

```
src/
├── index.js            point d'entrée
├── bot.js              logique du bot (indépendante de WhatsApp)
├── app.js              assemblage + réglages appliqués à chaud
├── settings.js         réglages modifiables depuis l'appli
├── whatsapp.js         canal WhatsApp (whatsapp-web.js)
├── web/                appli : serveur + API (server.js), interface (public/), démo
├── commands.js         compréhension des messages
├── messages.js         textes du bot (ton de marque)
├── reminders.js        calcul des rappels
├── store.js            état persistant (data/state.json)
├── planning/           agenda ICS + planning manuel
└── sowesign/           robot de signature SoWeSoft + connexion manuelle
```

---

## ⚠️ À lire

- **Utilise la signature automatique uniquement quand tu es vraiment en autonomie.** L'émargement atteste ta présence et compte pour l'assiduité, les financements et l'alternance. Signer en étant absent·e reste une fausse déclaration, bot ou pas. Vérifie aussi le règlement de ton école sur les outils d'automatisation.
- `whatsapp-web.js` n'est pas une API officielle de WhatsApp. Pour un usage perso et modéré (quelques messages par jour vers toi-même), ça marche bien. Si tu préfères une solution officielle, il faut passer par l'API WhatsApp Business (Meta) : voir la roadmap dans le cadrage.
- `.env` et `data/` contiennent tes identifiants et sessions : ils ne sont **jamais** commités (`.gitignore`). Ne les partage pas.
