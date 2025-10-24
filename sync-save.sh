#!/bin/bash

# Script pour sauvegarder et synchroniser sur GitHub
# Usage: ./sync-save.sh "message de commit optionnel"

echo "🔄 Synchronisation en cours..."

# Ajouter tous les fichiers
git add .

# Commit avec message personnalisé ou par défaut
if [ "$1" ]; then
    git commit -m "$1"
else
    git commit -m "💾 Session de travail sauvegardée - $(date '+%Y-%m-%d %H:%M')"
fi

# Push vers GitHub
echo "📤 Push vers GitHub..."
git push

echo "✅ Synchronisation terminée !"
echo "📍 Vous pouvez maintenant récupérer ces changements sur votre autre machine avec ./sync-pull.sh"