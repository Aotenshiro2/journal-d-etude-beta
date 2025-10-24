#!/bin/bash

# Script pour récupérer les dernières modifications depuis GitHub
# Usage: ./sync-pull.sh

echo "🔄 Récupération des changements depuis GitHub..."

# Vérifier s'il y a des changements locaux non commités
if [[ -n $(git status --porcelain) ]]; then
    echo "💾 Changements locaux détectés - stash automatique..."
    if git stash push -u -m "Auto-stash avant pull - $(date '+%Y-%m-%d %H:%M')" >/dev/null 2>&1; then
        echo "📦 Changements sauvegardés temporairement"
        has_stashed=true
    else
        echo "❌ Erreur lors du stash"
        exit 1
    fi
fi

# Pull depuis GitHub
echo "📥 Pull depuis GitHub..."
if ! git pull; then
    echo "❌ Erreur lors du pull"
    if [ "$has_stashed" = true ]; then
        echo "⚠️  Réapplication des changements stashés..."
        git stash pop
    fi
    exit 1
fi

# Réappliquer le stash si nécessaire
if [ "$has_stashed" = true ]; then
    echo "🔄 Réapplication des changements locaux..."
    if git stash pop; then
        echo "✅ Changements locaux réappliqués avec succès"
    else
        echo "⚠️  CONFLIT détecté lors de la fusion !"
        echo "📝 Résolvez les conflits manuellement, puis : git stash drop"
        exit 1
    fi
fi

echo "✅ Synchronisation terminée !"
echo "🎯 Votre environnement est maintenant à jour avec la dernière version"