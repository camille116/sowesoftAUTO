#!/bin/bash
# Double-clic sur Mac : démarre Revenus sur cet ordinateur et l'ouvre dans le navigateur.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js est nécessaire pour lancer Revenus sur cet ordinateur."
  echo "Installe-le depuis https://nodejs.org puis relance ce fichier."
  read -r -p "Appuie sur Entrée pour fermer."
  exit 1
fi
exec node serveur-local.mjs
