# Dossier de cadrage – Projet « Émile »

_Assistant WhatsApp d'émargement Sowesoft / SoWeSign_

| | |
|---|---|
| **Client** | Camille (usage perso, extensible à la promo) |
| **Chef de projet** | Agence |
| **Équipe** | Dev · Brand manager · UX/UI · Design thinking · Créateur de projet |
| **Version** | v1.0 – MVP |

---

## 1. Brief

**Le problème.** Pendant les heures d'autonomie, personne ne rappelle de signer sur Sowesoft. On oublie, l'absence est comptée, et il faut ensuite se justifier auprès de la scolarité.

**L'objectif.** Ne plus jamais oublier de signer, sans effort :
- être **prévenu au bon moment**, là où on regarde déjà (WhatsApp) ;
- pouvoir **signer en une seconde** en envoyant juste le code.

**Hors périmètre (MVP).** Signature des cours en présentiel avec QR code projeté, multi-utilisateurs, application mobile dédiée.

---

## 2. Démarche design thinking

### 2.1 Empathie – persona

> **Léa, 21 ans, Bachelor UX en alternance.**
> 2 à 3 demi-journées d'autonomie par semaine, souvent chez elle ou en entreprise. Elle vit sur WhatsApp, n'ouvre Sowesoft que quand on lui dit de le faire.
> _« Je ne sèche pas, je suis juste en train de bosser… et j'oublie de signer. »_

**Irritants observés**
- Aucune notification de Sowesoft pour les créneaux d'autonomie.
- Le code est communiqué par le formateur (Teams, mail, oral) : il faut l'ouvrir, se connecter, chercher le bon écran.
- Les absences non justifiées pèsent sur l'alternance et les financements.

### 2.2 Définition – « Comment pourrions-nous… »

> Comment pourrions-nous **rappeler à Léa de signer au moment exact où elle doit le faire**, et **réduire la signature à un seul message** ?

### 2.3 Idéation (pistes évaluées)

| Piste | Effort | Impact | Décision |
|---|---|---|---|
| Alarme dans l'agenda du téléphone | ⭐ | ⭐ | ❌ trop facile à ignorer, pas de signature |
| Bot Telegram | ⭐⭐ | ⭐⭐ | ❌ la cible n'utilise pas Telegram |
| **Bot WhatsApp + signature par code** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ **retenu** |
| Extension navigateur | ⭐⭐ | ⭐⭐ | ❌ ne marche pas sur mobile |

### 2.4 Prototype → test

1. **Prototype papier** de la conversation (§4) testé avec 3 étudiants.
2. **Mode test** (`SIGN_DRY_RUN=true`) : le bot remplit le code sans valider et renvoie une capture. Permet de valider sur la vraie plateforme sans risque.
3. **Fausse plateforme** de test (`test/fixtures/mock-sowesign.js`) pour vérifier le robot automatiquement.

---

## 3. Parcours utilisateur

```
   AVANT                    PENDANT                         APRÈS
 ┌──────────┐   T-5 min  ┌────────────────┐  code    ┌───────────────┐
 │ Planning │──────────►│ ⏰ « Dans 5 min │────────►│ ✅ « Signé ! » │
 │ détecté  │  T0        │  autonomie »   │  « 4821 »│  + capture    │
 └──────────┘──────────►│ ✍️ « C'est      │          └───────────────┘
                         │  l'heure »     │  « fait » ┌───────────────┐
                         │ 🔔 T+15        │────────►│ 👍 « Noté »    │
                         │ 🚨 T+45 dernier│          └───────────────┘
                         └────────────────┘
```

**Moments clés**
- **Avant** : le bot connaît les créneaux (agenda ICS de l'école ou planning manuel).
- **Pendant** : rappels progressifs, qui s'arrêtent dès que c'est signé.
- **Après** : une preuve (capture d'écran) en cas de litige avec la scolarité.

---

## 4. UX conversationnelle

### Principes
1. **Une action par message.** Chaque rappel finit par une seule consigne claire : « envoie le code ».
2. **Zéro syntaxe à apprendre.** `4821`, `code 4821`, `signe 4821`, `48 21` marchent tous.
3. **Toujours une porte de sortie.** En cas d'échec : la raison + quoi faire (« signe à la main puis réponds *fait* »).
4. **Pas de spam.** Après une coupure, le bot n'envoie que le dernier rappel dû, pas tous ceux qu'il a ratés.
5. **Preuve visuelle.** Chaque signature est accompagnée d'une capture.

### Arbre de conversation

```
message reçu
├── code (3–8 caractères)   → signature → ✅ signé + capture
│                                       └→ ❌ raison + plan B
├── fait / signé            → créneau marqué signé
├── ignore                  → créneau ignoré
├── planning/demain/semaine → liste ✅ / ⬜
├── statut                  → rappels, créneau en cours, prochain
├── pause / reprendre       → coupe / relance les rappels
├── test                    → test de connexion + capture
└── autre                   → « Je n'ai pas compris, envoie un code ou tape aide »
```

---

## 5. Plateforme de marque

| | |
|---|---|
| **Nom** | **Émile**, clin d'œil à *émargement* : un prénom, pour en faire un camarade plutôt qu'un outil |
| **Promesse** | « Tu bosses, Émile veille sur ta signature. » |
| **Personnalité** | Bienveillant, fiable, discret, un peu complice |
| **Ton** | Tutoiement, phrases courtes, pas de jargon, emoji comme repère visuel (pas de déco) |
| **Signature visuelle** | Chaque message commence par 🤖 ; ✍️ = signer, ✅ = fait, 🚨 = urgent |

**À faire / à éviter**

| ✅ On dit | ❌ On évite |
|---|---|
| « C'est l'heure de signer ! » | « Veuillez procéder à votre émargement. » |
| « Je n'ai pas réussi : code expiré. Signe à la main puis réponds *fait*. » | « Erreur 500. » |
| « Aucune autonomie aujourd'hui. Profite ! 🌿 » | Messages non sollicités, blagues à chaque rappel |

Tous les textes sont centralisés dans `src/messages.js` : le brand manager peut les modifier sans toucher à la logique.

---

## 6. Architecture technique

| Brique | Choix | Pourquoi |
|---|---|---|
| Runtime | Node.js 20+ | Un seul langage, léger, tourne sur un Raspberry Pi |
| WhatsApp | `whatsapp-web.js` (QR code) | Gratuit, pas de validation Meta, idéal pour un usage perso |
| Planning | ICS (`node-ical`) + JSON manuel | Les outils d'emploi du temps des écoles exportent presque tous en ICS |
| Signature | Puppeteer (Chromium headless) | Sowesoft n'a pas d'API publique : on pilote l'interface web |
| Paramétrage plateforme | `config/sowesign.json` | Si l'interface change, on adapte les sélecteurs sans redéployer de code |
| État | `data/state.json` | Rien à installer, suffisant pour un utilisateur |
| Déploiement | Docker Compose | `docker compose up -d` et c'est en ligne |

Le **cerveau** (`src/bot.js`) ne dépend pas de WhatsApp : on pourra brancher Telegram, SMS ou l'API WhatsApp Business sans réécrire la logique.

---

## 7. Sécurité, éthique, données

- **Accès** : le bot n'obéit qu'à `OWNER_NUMBER`.
- **Secrets** : identifiants dans `.env`, sessions dans `data/`, tous deux exclus de Git.
- **Données personnelles** : tout reste sur la machine de l'utilisateur. Aucun serveur tiers, aucun suivi.
- **Éthique** : l'outil est fait pour **ne pas oublier** de signer, pas pour signer à la place de quelqu'un d'absent. Ce point est écrit noir sur blanc dans le README et dans le discours de marque. Avant de proposer l'outil à toute la promo, il faudra l'accord de l'école.

---

## 8. Roadmap

| Phase | Contenu | Statut |
|---|---|---|
| **S1 – MVP** | Planning ICS + manuel, rappels progressifs, signature par code, mode test, captures, Docker | ✅ livré |
| **S2 – Calibrage** | Sélecteurs réels de l'école via `sowesign:inspect`, test en mode test sur 1 semaine, passage en réel | ⏳ à faire avec Camille |
| **S3 – Confort** | Récap du soir (« 2/2 signés aujourd'hui »), alerte si la session Sowesoft expire, code reçu par mail lu automatiquement (connecteur Gmail) | 💡 |
| **S4 – Promo** | Multi-utilisateurs, API WhatsApp Business officielle, mini-dashboard d'assiduité | 💡 (avec accord de l'école) |

---

## 9. Organisation de l'équipe (RACI simplifié)

| Livrable | Dev | Brand | UX/UI | Design thinking | Créateur de projet | Chef de projet |
|---|---|---|---|---|---|---|
| Recherche utilisateur, persona | I | C | C | **R** | C | A |
| Parcours & arbre de conversation | C | C | **R** | C | I | A |
| Nom, ton, textes du bot | I | **R** | C | I | C | A |
| Code, tests, déploiement | **R** | I | I | I | I | A |
| Roadmap, pitch à l'école | I | C | I | C | **R** | A |

_R = réalise · A = valide · C = consulté · I = informé_

---

## 10. Indicateurs de succès

- **0 oubli de signature** sur les créneaux d'autonomie après 1 mois.
- **< 10 secondes** entre l'envoi du code et la confirmation « Signé ».
- **≥ 95 %** de signatures automatiques réussies (sinon : recalibrer les sélecteurs).
- Moins de **3 rappels** en moyenne par créneau.

## 11. Risques

| Risque | Probabilité | Parade |
|---|---|---|
| Sowesoft change son interface | Moyenne | Sélecteurs en config + capture d'erreur envoyée sur WhatsApp |
| Connexion SSO / double authentification | Moyenne | Session mémorisée via `sowesign:inspect` |
| WhatsApp déconnecte la session Web | Faible | Reconnexion auto ; sinon re-scanner le QR |
| Règlement de l'école défavorable | À vérifier | Garder le mode rappel seul (`SIGN_DRY_RUN=true`) |
| Machine éteinte | Moyenne | Raspberry Pi / VPS + `restart: unless-stopped` |
