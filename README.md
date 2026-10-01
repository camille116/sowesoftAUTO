# ✍️ Émile – ton assistant d'émargement WhatsApp

Émile est un bot WhatsApp qui :

1. **lit ton planning** (agenda ICS de l'école et/ou planning manuel) et repère tes **heures d'autonomie** ;
2. **t'envoie un message quand tu dois signer** sur Sowesoft / SoWeSign, et te relance tant que ce n'est pas fait ;
3. **signe à ta place** quand tu lui envoies le code de signature (`4821`), puis te renvoie une capture d'écran comme preuve.

> Le dossier de cadrage du projet (persona, parcours, ton de marque, architecture, roadmap) est dans [`docs/CADRAGE.md`](docs/CADRAGE.md).

```
 Agenda ICS ─┐                       ┌──────────────┐
             ├─► Planning ─► Rappels ─►│  WhatsApp    │◄── toi : « 4821 »
 planning.json┘                       └──────┬───────┘
                                             ▼
                                  Robot navigateur (Chromium)
                                             ▼
                                   Sowesoft / SoWeSign ✅
```

---

## 🚀 Installation

Il faut une machine allumée en continu (Raspberry Pi, petit VPS, vieux PC…) avec **Node.js 20+** ou **Docker**.

```bash
git clone https://github.com/camille116/sowesoftAUTO.git
cd sowesoftAUTO
cp .env.example .env        # puis remplis le fichier (voir ci-dessous)
npm install
npm start                   # un QR code s'affiche
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

## ⚙️ Configuration

### 1. Le planning (`.env` + `config/planning.json`)

**Option A – agenda de l'école (recommandé).** La plupart des outils d'emploi du temps (Hyperplanning, Ypareo, Aurion, Google Agenda, Outlook…) proposent un lien d'export **ICS / iCal**. Colle-le dans `ICS_URL`.
Les créneaux sont retenus si leur titre, description ou lieu contient un des `AUTONOMY_KEYWORDS` (`autonomie,autonome,travail personnel…`).

**Option B – planning manuel.** Édite `config/planning.json` :

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

### 3. La signature automatique (`config/sowesign.json`)

Le robot ouvre la plateforme dans un Chromium invisible, se connecte avec `SOWESIGN_LOGIN` / `SOWESIGN_PASSWORD`, tape le code (il gère aussi les codes en cases séparées) et valide.

Chaque école a une interface un peu différente, donc **les sélecteurs sont à vérifier une fois** :

```bash
HEADLESS=false npm run sowesign:inspect
```

1. Un navigateur s'ouvre : connecte-toi et va jusqu'à l'écran où tu tapes le code.
2. Appuie sur **Entrée** dans le terminal : le script liste les champs/boutons avec leur sélecteur CSS.
3. Reporte-les dans `config/sowesign.json` :

| Clé | Rôle |
|---|---|
| `url` | Page d'accueil / de connexion |
| `signUrl` | (optionnel) URL directe de la page de signature |
| `selectors.username` / `password` / `loginSubmit` | Formulaire de connexion |
| `selectors.openSignature` | (optionnel) bouton à cliquer pour faire apparaître le champ code |
| `selectors.codeInput` / `codeSubmit` | Champ(s) du code et bouton de validation |
| `selectors.loggedIn` | (optionnel) élément visible seulement une fois connecté |
| `successTexts` / `errorTexts` | Textes qui confirment ou refusent la signature |

> 🔐 Si ton école se connecte via un SSO (Microsoft, Google…), le plus simple est de te connecter une fois avec `sowesign:inspect` : le bot réutilise ensuite la session enregistrée dans `data/sowesign-profile/`.

**Mode test** : laisse `SIGN_DRY_RUN=true` au début. Le bot remplit le code **sans valider** et t'envoie la capture. Quand la capture est bonne, passe à `false`.

---

## 💬 Utilisation

| Tu envoies | Émile fait |
|---|---|
| `4821` · `code 4821` · `signe 4821` | Signe avec ce code et renvoie une capture ✅ |
| `fait` · `signé` | Note que tu as signé toi-même, arrête les rappels |
| `ignore` | Ignore le créneau en cours (cours annulé…) |
| `planning` · `demain` · `semaine` | Liste tes créneaux d'autonomie (✅ / ⬜) |
| `statut` | Rappels actifs ?, créneau en cours, prochain créneau |
| `pause` · `reprendre` | Coupe / relance les rappels (vacances) |
| `test` | Vérifie la connexion à Sowesoft (capture) |
| `aide` | Rappelle les commandes |

Exemple :

```
🤖 ✍️ C'est l'heure de signer !
13:30–17:00 · Autonomie – projet
👉 Envoie-moi le code et je signe, ou réponds fait si c'est déjà fait.

toi : 4821

🤖 Je signe avec le code 4821… ⏳
🤖 ✅ Signé !  [capture d'écran]
```

---

## 🧪 Développement

```bash
npm test     # 22 tests : commandes, planning ICS/manuel, rappels, bot, et signature réelle dans Chromium
```

Le test de signature lance un vrai Chromium contre une fausse plateforme (`test/fixtures/mock-sowesign.js`). Définis `CHROME_PATH` si Chromium n'est pas trouvé ; sinon ce test est ignoré.

```
src/
├── index.js            point d'entrée
├── bot.js              logique du bot (indépendante de WhatsApp)
├── whatsapp.js         canal WhatsApp (whatsapp-web.js)
├── commands.js         compréhension des messages
├── messages.js         textes du bot (ton de marque)
├── reminders.js        calcul des rappels
├── store.js            état persistant (data/state.json)
├── planning/           agenda ICS + planning manuel
└── sowesign/           robot de signature + outil de repérage
```

---

## ⚠️ À lire

- **Utilise la signature automatique uniquement quand tu es vraiment en autonomie.** L'émargement atteste ta présence et compte pour l'assiduité, les financements et l'alternance. Signer en étant absent·e reste une fausse déclaration, bot ou pas. Vérifie aussi le règlement de ton école sur les outils d'automatisation.
- `whatsapp-web.js` n'est pas une API officielle de WhatsApp. Pour un usage perso et modéré (quelques messages par jour vers toi-même), ça marche bien. Si tu préfères une solution officielle, il faut passer par l'API WhatsApp Business (Meta) : voir la roadmap dans le cadrage.
- `.env` et `data/` contiennent tes identifiants et sessions : ils ne sont **jamais** commités (`.gitignore`). Ne les partage pas.
