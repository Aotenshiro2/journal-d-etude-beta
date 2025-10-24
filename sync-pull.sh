#!/bin/bash

# Script pour récupérer les dernières modifications depuis GitHub
# Usage: ./sync-pull.sh

echo "🔄 Récupération des changements depuis GitHub..."

# Vérifier s'il y a des changements locaux non commitée
if [[ -n $(git status --porcelain) ]]; then
    echo "⚠️  Il y a des changements non sauvegardés localement."
    echo "Voulez-vous les sauvegarder avant de récupérer ? (y/n)"
    read -r response
    if [[ $response =~ ^[Yy]$ ]]; then
        echo "💾 Sauvegarde automatique..."
        git add .
        git commit -m "🔄 Auto-save avant pull - $(date '+%Y-%m-%d %H:%M')"
    fi
fi

# Pull depuis GitHub
git pull

echo "✅ Synchronisation terminée !"
echo "🎯 Votre environnement est maintenant à jour avec la dernière version"