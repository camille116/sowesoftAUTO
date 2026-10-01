# Installer Émile sur ton Mac

Durée : environ 10 minutes. Ensuite, Émile tourne en arrière-plan et redémarre tout seul à chaque allumage du Mac.

## 1. Installer Node.js (une seule fois)

Va sur https://nodejs.org/fr/download, télécharge la version **LTS** pour macOS (fichier `.pkg`) et installe-la comme une app classique.

## 2. Télécharger Émile

Connecté·e à GitHub, ouvre ce lien : il télécharge un fichier ZIP.

https://github.com/camille116/sowesoftAUTO/archive/refs/heads/claude/whatsapp-signature-bot-q8m9ha.zip

Double-clique sur le ZIP dans **Téléchargements** pour le décompresser.

## 3. Lancer l'installation

1. Ouvre le **Terminal** (⌘ + Espace, tape « Terminal », Entrée).
2. Tape `bash ` (avec un espace à la fin), **sans appuyer sur Entrée**.
3. Fais glisser le fichier `scripts/mac/install.sh` du dossier décompressé dans la fenêtre du Terminal.
4. Appuie sur **Entrée**.

Le script :
- copie Émile dans le dossier `~/Emile` ;
- installe ce qu'il faut, dont le navigateur du robot (2 à 5 minutes la première fois) ;
- te demande **ton lien iCal** et **un mot de passe pour l'appli** (ton numéro WhatsApp seulement si tu choisis WhatsApp) ;
- lance Émile en arrière-plan, avec redémarrage automatique ;
- ouvre l'appli dans ton navigateur.

> Si macOS demande « Autoriser *node* à accepter les connexions entrantes ? », réponds **Autoriser**. C'est ce qui te permet d'ouvrir l'appli depuis ton téléphone.

## 4. Relier Telegram et SoWeSoft (dans l'appli)

L'appli s'ouvre sur **http://localhost:3000**. Entre le mot de passe que tu viens de choisir, puis va dans **Réglages** :

1. **Messagerie → Telegram** : crée ton bot (2 minutes)
   - dans Telegram, ouvre **@BotFather** et envoie `/newbot` ;
   - nom : **Émile** ; identifiant : par exemple **EmileSignature_bot** (il doit finir par « bot ») ;
   - BotFather te répond avec un **token** (`123456789:AAH…`) : copie-le, colle-le dans l'appli, puis **Valider**.
2. Clique sur **Relier Telegram**. Telegram s'ouvre : appuie sur **Démarrer**. Sur ordinateur, tu peux aussi scanner le QR avec ton téléphone. Le bot n'obéira qu'à toi.
3. **🔔 Envoyer une notif de test** : tu dois recevoir le message sur Telegram.
4. **Connexion SoWeSoft** : choisis **E-mail**, remplis ton e-mail et ton mot de passe SoWeSoft, **Enregistrer**, puis **Tester la connexion SoWeSoft**.

Ensuite, parle à Émile dans Telegram : envoie le code à 5 chiffres pour signer, `/planning`, `/aide`… (le menu ☰ du bot liste les commandes).

> Tu préfères WhatsApp ? Réglages → Messagerie → **WhatsApp**, puis scanne le QR code (Appareils connectés → Connecter un appareil). C'est moins fiable que Telegram, car ce n'est pas une connexion officielle.

## 5. Garder le Mac éveillé

Émile empêche déjà la mise en veille automatique, mais macOS se met quand même en veille si :
- **l'écran du MacBook est fermé** : garde-le ouvert ; tu peux baisser la luminosité au minimum ;
- **le Mac est sur batterie** : garde-le **branché**.

Va aussi dans **Réglages Système → Batterie → Options** (ou **Économiseur d'énergie**) et active **« Empêcher la mise en veille automatique lorsque l'écran est éteint »** sur adaptateur secteur.

## Depuis ton téléphone

Sur le même Wi-Fi que le Mac, ouvre `http://<nom-du-mac>.local:3000`. Le nom du Mac se trouve dans Réglages Système → Général → Partage, en bas : par exemple `http://MacBook-de-Camille.local:3000`.
Ensuite, utilise **Partager → Sur l'écran d'accueil** dans Safari pour l'avoir comme une app.

## Commandes utiles (Terminal)

| Pour… | Tape |
|---|---|
| Voir ce que fait Émile | `tail -f ~/Emile/data/emile.log` (Ctrl + C pour quitter) |
| Redémarrer Émile | `launchctl kickstart -k gui/$(id -u)/com.emile.sowesoft` |
| Arrêter Émile | `bash ~/Emile/scripts/mac/uninstall.sh` |
| Mettre à jour | télécharge le nouveau ZIP et relance `install.sh` (ta config et tes sessions sont gardées) |
| Connexion Microsoft (SSO) | `cd ~/Emile && npm run sowesign:login` |

## Ça ne marche pas ?

- **« Node.js n'est pas installé »** : refais l'étape 1, puis ferme et rouvre le Terminal.
- **L'appli ne s'ouvre pas** : regarde le journal (`tail -n 50 ~/Emile/data/emile.log`) et envoie-le-moi.
- **Plus de rappels** : vérifie que le Mac n'est pas en veille et que l'appli affiche « Telegram relié ».
