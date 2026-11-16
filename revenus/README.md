# Revenus

Suivi des revenus freelance (motion design, montage vidéo, commissions, autres sources).
App web statique, sans serveur ni étape de build : les données vivent dans le navigateur et, si Drive est connecté, dans ton Google Drive.

## Lancer en local

```bash
npx serve revenus        # ou : python3 -m http.server 4173 --directory revenus
```

Ouvre ensuite l'adresse affichée. Pour une mise en ligne, publie le dossier `revenus/` tel quel (Netlify, GitHub Pages, etc.).

## Ce que fait l'app

- **Aperçu** : encaissé du mois et de l'année (comparés à la même durée de la période précédente), cotisations estimées du trimestre, paiements à encaisser, graphique mensuel, répartition par client et par prestation.
- **Paiements** : une ligne par encaissement, regroupée par mois, avec recherche et filtres (payés, en attente, impayés, à vérifier).
- **Saisie** : montant, client, date, prestation, projet, statut ; en option client final, tranche (1/2, 2/2), montant déclaré, lien de facture, notes. Le champ « Solde restant à encaisser » crée d'un coup la ligne en attente du solde.
- **Exports** : CSV (séparateur `;`, décimales à virgule), Excel (`Paiements` + totaux par `Mois`) et sauvegarde JSON réimportable.
- **Google Drive** : à chaque modification, `Revenus.xlsx` est remplacé dans le Drive, avec `revenus-donnees.json` pour synchroniser plusieurs appareils.

## Règles de calcul

- Le chiffre d'affaires d'un mois est la somme des lignes **payées** dont la date tombe dans ce mois.
- Cotisations estimées = montant déclaré × taux de l'année (Réglages). Le montant déclaré vaut le montant encaissé sauf saisie contraire.
- Taux par défaut : 24,8 % (2025) et 25,8 % (2026), soit cotisations BNC + 0,2 % de formation. À vérifier sur ton espace URSSAF.
- Un paiement « En attente » dont la date est passée apparaît « En retard ».

## Connexion Google Drive

1. Sur [console.cloud.google.com](https://console.cloud.google.com/), crée un projet et active « Google Drive API ».
2. Écran de consentement OAuth : type « Externe », puis publie l'app (« En production »). En mode test, l'autorisation expire au bout de 7 jours.
3. Identifiants → « ID client OAuth » → « Application Web ». Dans « Origines JavaScript autorisées », mets l'adresse exacte du site (affichée dans Réglages).
4. Colle l'ID client dans Réglages → Google Drive, puis « Connecter Google Drive ».

L'app demande la portée `drive.file` : elle ne voit que les fichiers qu'elle a créés.
Sans serveur, la session Google dure une heure ; l'app tente de la renouveler seule, sinon la pastille « Reconnecter Drive » demande un clic. Entre-temps, rien n'est perdu : les données restent dans le navigateur.

## Sauvegarde et import

Réglages → Données : « Exporter une sauvegarde » produit un fichier JSON, « Importer une sauvegarde » le fusionne avec l'existant (la version la plus récente de chaque ligne gagne). C'est aussi le moyen de charger un historique : aucune donnée personnelle n'est stockée dans ce dépôt.

## Tests

```bash
node --test "revenus/test/*.test.js"
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `js/calc.js` | Totaux, cotisations, retards, formats |
| `js/store.js` | Stockage local, validation, fusion entre appareils |
| `js/export.js` | CSV et classeur Excel |
| `js/drive.js` | Connexion Google et envoi des fichiers |
| `js/app.js` | Interface |
| `vendor/exceljs.min.js` | ExcelJS 4.4.0 (licence MIT) |
