# Revenus

Suivi des revenus freelance (motion design, montage vidéo, commissions, autres sources).
App web statique, sans serveur ni étape de build : les données vivent dans le navigateur et, si Drive est connecté, dans ton Google Drive.

Aucune donnée personnelle n'est stockée dans ce dépôt : l'app démarre vide et l'historique se charge par import d'une sauvegarde.

## Lancer sur son ordinateur

Ouvrir `index.html` d'un double-clic ne marche pas : les navigateurs refusent de charger l'app depuis un simple fichier. Il faut passer par le petit serveur fourni (Node.js 22 ou plus récent, rien d'autre à installer) :

- **Mac** : double-clic sur `Lancer Revenus.command`. La première fois, macOS peut le bloquer : clic droit → Ouvrir.
- **Partout** : dans ce dossier, `node serveur-local.mjs` (ou `npm start`).

L'app s'ouvre sur `http://localhost:4173/`. Le serveur ne répond qu'à cet ordinateur et ne sert que ce dossier. Garde toujours cette adresse : les données du navigateur y sont attachées.

Pour une mise en ligne (téléphone, autres appareils), publie ce dossier tel quel sur GitHub Pages ou tout hébergement de fichiers statiques.

## Ce que fait l'app

- **Aperçu** : encaissé du mois et de l'année (comparés à la même durée de la période précédente), cotisations estimées du trimestre, paiements à encaisser, graphique mensuel, répartition par client et par prestation.
- **Disposition libre** : les trois cartes et les quatre panneaux de l'aperçu se réordonnent par glisser-déposer (poignée à six points, ou en-tête à la souris). Au clavier : flèches, Début et Fin sur la poignée. L'ordre est propre à chaque appareil.
- **Paiements** : une ligne par encaissement, regroupée par mois, avec recherche et filtres (payés, en attente, impayés, à vérifier).
- **Saisie** : montant, client, date, prestation, projet, statut ; en option client final, acompte ou solde (1/2, 2/2), montant déclaré, lien de facture, vidéo du projet, notes. Le champ « Solde restant à encaisser » crée d'un coup la ligne en attente du solde. Une saisie fermée sans enregistrer est reprise à la prochaine ouverture.
- **Vidéo du projet** : un lien collé (Drive, Frame.io, YouTube…) ou un fichier envoyé dans le Drive depuis le formulaire. L'envoi reprend après une coupure réseau et continue en arrière-plan si on enregistre avant la fin.
- **Exports** : CSV (séparateur `;`, décimales à virgule), Excel (`Paiements` + totaux par `Mois`) et sauvegarde JSON réimportable.
- **Google Drive** : à chaque modification, `Revenus.xlsx` est remplacé dans le dossier « Revenus » du Drive, avec `revenus-donnees.json` pour synchroniser plusieurs appareils.

## Règles de calcul

- Le chiffre d'affaires d'un mois est la somme des lignes **payées** dont la date tombe dans ce mois.
- Cotisations estimées = montant déclaré × taux de l'année (Réglages). Le montant déclaré vaut le montant encaissé sauf saisie contraire.
- Taux par défaut : 24,8 % (2025) et 25,8 % (2026), soit cotisations BNC + 0,2 % de formation. À vérifier sur ton espace URSSAF.
- Un paiement « En attente » dont la date prévue est passée apparaît « En retard ». Un « Impayé » ne sera jamais payé et ne compte pas.

## Sauvegarde et import

Réglages → Données : « Exporter une sauvegarde » produit un fichier JSON, « Importer une sauvegarde » le fusionne avec l'existant (pour chaque ligne, la version la plus récente gagne ; rien n'est écrasé par plus ancien). C'est aussi le moyen de charger un historique ou de passer d'un appareil à l'autre sans Drive.

## Connexion Google Drive

1. Sur [console.cloud.google.com](https://console.cloud.google.com/), crée un projet et active « Google Drive API ».
2. Écran de consentement OAuth : type « Externe », puis publie l'app (« En production »). En mode test, l'autorisation expire au bout de 7 jours.
3. Identifiants → « ID client OAuth » → « Application Web ». Dans « Origines JavaScript autorisées », mets l'adresse exacte du site (affichée dans Réglages).
4. Colle l'ID client dans Réglages → Google Drive, puis « Connecter Google Drive ».

L'app demande la portée `drive.file` : elle ne voit que les fichiers qu'elle a créés.

**Limite à connaître.** Sans serveur, une session Google dure une heure et ne se renouvelle que pendant un geste de l'utilisateur. L'app s'en sert au mieux : quand la session a expiré, le clic qui enregistre une modification rouvre la session (une fenêtre Google peut apparaître brièvement). Si le navigateur bloque cette fenêtre, la pastille « Drive : reconnecter » demande un clic. Entre-temps rien n'est perdu : les données restent dans le navigateur et partent au prochain envoi.

## Sécurité et données

- Tout ce qui vient de l'extérieur (stockage du navigateur, fichier lu sur Drive, sauvegarde importée) est validé avant usage : types, dates réelles, montants bornés, statuts connus, liens `http(s)` uniquement.
- Une politique de sécurité du contenu (`Content-Security-Policy` dans `index.html`) n'autorise que le code de ce site et celui de Google (connexion, Drive). La police est hébergée ici : aucune requête à un tiers tant que Drive n'est pas configuré.
- L'identifiant client Google et la disposition de l'aperçu restent sur l'appareil ; ils ne partent ni sur Drive ni dans les sauvegardes.
- Deux onglets ouverts ne s'écrasent pas : chaque enregistrement fusionne avec ce qui est déjà sur l'appareil.
- Si le navigateur refuse d'enregistrer (stockage plein ou bloqué), un bandeau le dit et propose d'exporter une sauvegarde.

## Tests

```bash
npm test        # dans ce dossier
```

Les tests utilisent un jeu de données inventé.

## Fichiers

| Fichier | Rôle |
|---|---|
| `js/calc.js` | Totaux, cotisations, retards, lecture des montants, formats |
| `js/store.js` | Stockage local, validation, fusion entre appareils et onglets |
| `js/export.js` | CSV et classeur Excel (ExcelJS chargé à la demande) |
| `js/drive.js` | Connexion Google, envoi des fichiers, envoi reprenable des vidéos |
| `js/dnd.js` | Glisser-déposer (souris, doigt, clavier) |
| `js/app.js` | Interface |
| `serveur-local.mjs`, `Lancer Revenus.command` | Lancement sur son ordinateur |
| `fonts/` | Instrument Sans (licence OFL 1.1) |
| `vendor/exceljs.min.js` | ExcelJS 4.4.0 (licence MIT) |
