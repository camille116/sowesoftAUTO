# Installer LinkeD sur ton Mac

Environ 10 minutes, **sans Terminal**. Ensuite, LinkeD est une **vraie app Mac**, comme Spotify : sa propre fenêtre, son icône dans le Dock, ses menus. Elle s'ouvre depuis Applications, le Launchpad ou Spotlight, et se met à jour avec un bouton.

## 1. Installer Node.js (une seule fois)

Va sur https://nodejs.org/fr/download, télécharge la version **LTS** pour macOS (fichier `.pkg`, version 22 ou plus) et installe-la comme une app classique.

## 2. Télécharger LinkeD

Ouvre ce lien : il télécharge un fichier ZIP.

https://github.com/camille116/sowesoftAUTO/archive/refs/heads/claude/whatsapp-signature-bot-q8m9ha.zip

Double-clique sur le ZIP dans **Téléchargements** pour le décompresser.

## 3. Lancer l'installation

Dans le dossier décompressé, fais un **clic droit sur « Installer LinkeD.command » → Ouvrir**, puis confirme **Ouvrir**.

> Le clic droit n'est nécessaire que la première fois : macOS demande une confirmation pour les fichiers téléchargés sur internet.

Une fenêtre s'ouvre et fait tout toute seule (2 à 5 minutes) :
- elle installe LinkeD dans le dossier `~/LinkeD` (tes réglages d'Émile sont récupérés si tu l'avais installé) ;
- elle te demande, dans des petites fenêtres, **un mot de passe pour l'app** et ton **lien iCal Hyperplanning** (tu peux le mettre plus tard) ;
- elle lance LinkeD en arrière-plan, avec redémarrage automatique à chaque allumage du Mac ;
- elle crée l'app **LinkeD** dans ton dossier Applications (environ 100 Mo à télécharger la première fois) et l'ouvre.

## 4. Configurer (dans l'app)

Entre ton mot de passe, puis va dans **Réglages** :

1. **Messagerie → Telegram**
   - dans Telegram, ouvre **@BotFather** et envoie `/newbot` ;
   - nom : **LinkeD** ; identifiant : par exemple `LinkedSignature_bot` (il doit finir par « bot ») ;
   - colle le **token** reçu (`123456789:AAH…`) dans l'app, puis **Valider** ;
   - clique sur **Relier Telegram**, puis **Démarrer** dans Telegram : le bot n'obéira qu'à toi ;
   - **Envoyer une notif de test** : tu dois la recevoir sur Telegram.
2. **Notifications** : choisis **Autonomie & e-learning**, **Tous les cours**, ou **Sélection** (tu coches les matières).
3. **Compte SoWeSoft** : e-mail et mot de passe, **Enregistrer**, puis **Tester la connexion SoWeSoft**.

## Au quotidien

- Ouvre **LinkeD** depuis Applications, Launchpad ou ⌘ + Espace. Astuce : clic droit sur l'icône du Dock → Options → **Garder dans le Dock**.
- **Fermer la fenêtre ou quitter l'app (⌘Q) n'arrête pas les rappels** : le service LinkeD continue en arrière-plan tant que le Mac est allumé.
- Raccourcis : ⌘1 Tableau de bord · ⌘2 Planning · ⌘3 Classe · ⌘4 Activité · ⌘, Réglages.
- **Mettre à jour** : quand une nouvelle version existe, « Mise à jour disponible » apparaît en bas à gauche. Va dans **Réglages → Application → Mettre à jour** : LinkeD télécharge, installe et redémarre tout seul (1 à 3 min), sans toucher à tes réglages.

## La notification « Activité des apps en arrière-plan »

Juste après l'installation, macOS affiche « *LinkeD* (ou *caffeinate*) peut s'exécuter en arrière-plan ». **C'est normal** : c'est le service qui envoie les rappels et empêche la mise en veille pendant qu'il tourne (`caffeinate` est l'outil d'Apple qui garde le Mac éveillé). Ne le désactive pas dans Réglages Système → Général → **Ouverture et extensions**, sinon les rappels s'arrêtent.

## Garder le Mac éveillé

LinkeD empêche la mise en veille automatique, mais un MacBook se met quand même en veille si :
- **l'écran est fermé** : garde-le ouvert ; tu peux baisser la luminosité au minimum ;
- **il est sur batterie** : garde-le **branché**.

Va aussi dans **Réglages Système → Batterie → Options** et active **« Empêcher la mise en veille automatique lorsque l'écran est éteint »** sur adaptateur secteur.

## Depuis ton téléphone

Par sécurité, l'app n'est accessible **que depuis ton Mac**. Sur le Wi-Fi de l'école, n'importe qui pourrait sinon essayer de s'y connecter. Sur ton téléphone, utilise directement le **bot Telegram** : code, `/planning`, `/statut`…

Pour ouvrir quand même l'app sur ton téléphone, le plus sûr est [Tailscale](https://tailscale.com) (gratuit) : il crée un réseau privé entre ton Mac et ton téléphone. Ajoute ensuite `WEB_HOST=0.0.0.0` dans `~/LinkeD/.env`.

## En cas de souci

| Problème | Solution |
|---|---|
| « Il manque Node.js » | Refais l'étape 1, puis relance « Installer LinkeD » |
| macOS bloque « Installer LinkeD.command » | Clic droit → Ouvrir → Ouvrir |
| L'app affiche « LinkeD ne démarre pas » | Relance « Installer LinkeD » ; sinon envoie-moi le fichier `~/LinkeD/data/linked.log` |
| Plus de rappels | Vérifie que le Mac n'est pas en veille et que l'app affiche « Telegram relié » |
| Connexion Microsoft (SSO) pour SoWeSoft | Terminal : `cd ~/LinkeD && npm run sowesign:login` |
| Désinstaller | Terminal : `bash ~/LinkeD/scripts/mac/uninstall.sh` |
