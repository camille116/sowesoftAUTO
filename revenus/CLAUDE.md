# Revenus : consignes de travail

App web statique de suivi de revenus freelance. Pas de serveur, pas d'étape de build, JavaScript en modules natifs. Voir `README.md` pour le fonctionnement.

## Règles

- **Aucune donnée personnelle dans le dépôt** : ni clients réels, ni montants réels, ni dans le code, ni dans les tests, ni dans les messages de commit. Les tests utilisent un jeu de données inventé. L'historique de l'utilisateur vit dans une sauvegarde JSON privée, importée depuis Réglages.
- **Après chaque grosse tâche, un petit audit sécurité et utilisabilité** (demande de l'utilisateur) avant de livrer :
  - sécurité : tout ce qui vient de l'extérieur passe par `sanitizeState` (`js/store.js`) ; toute valeur insérée dans du HTML passe par `esc()` ; liens `http(s)` uniquement ; la politique `Content-Security-Policy` de `index.html` reste sans `unsafe-eval` ni nouvel hôte tiers ;
  - utilisabilité : parcours « ajouter un paiement » au téléphone (390 px, tactile) et au clavier, zones de toucher ≥ 44 px, champs ≥ 16 px, contrastes (texte ≥ 4,5:1, graphiques et bords de champ ≥ 3:1), thème clair et sombre, mouvement réduit.
- Vérifier dans un vrai navigateur, pas seulement par les tests unitaires : aucune erreur console, pas de défilement horizontal à 390, 1024 et 1440 px.
- Écrire l'interface en français, en phrases simples, sans jargon comptable.
- Ne pas ajouter de dépendance ni de bundler : l'app doit rester publiable telle quelle.

## Commandes

```bash
npm test          # tests unitaires (Node 22+)
npm start         # serveur local sur http://localhost:4173/
```

## À savoir

- Montants en centimes (entiers). Dates en `AAAA-MM-JJ`.
- Fusion entre appareils et onglets : la version la plus récente de chaque ligne gagne (`updatedAt`, horodatage monotone) ; les suppressions sont des marqueurs `deleted: true`.
- Google Drive : un jeton n'est demandé que pendant un geste de l'utilisateur ; l'identifiant client et la disposition de l'aperçu restent sur l'appareil.
- Non vérifiable hors d'un vrai compte : la connexion Google réelle et le comportement sur iPhone (clavier, zoom, fenêtre de connexion). Le dire dans le compte rendu quand une modification y touche.
