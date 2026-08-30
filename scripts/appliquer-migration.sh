#!/usr/bin/env bash
#
# Applique UNE migration SQL du projet Supabase partagé.
#
#   wsl.exe -e /home/aotenshiro/Projects/Aoknowledge/apps/journal-d-etude/scripts/appliquer-migration.sh <fichier.sql>
#
# Ce point d'entrée existe pour être la SEULE écriture en base autorisée sans
# demande : c'est lui que vise la règle de permission, et non un blanc-seing sur
# wsl.exe. Il est appelé sans shell intermédiaire (`wsl.exe -e`), donc ce qu'on
# lui passe arrive en arguments et jamais en commande.
#
# Il refuse tout ce qui n'est pas un fichier .sql du dossier des migrations, et
# il charge lui-même nvm et le .env : rien à préparer autour.

set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$(cd "$RACINE/../../sites/Aoknowledgecom/supabase/migrations" && pwd)"

if [ "$#" -ne 1 ]; then
  echo "Usage : appliquer-migration.sh <fichier.sql>" >&2
  echo "Un seul fichier a la fois, pour que l'echec d'une migration ne soit jamais ambigu." >&2
  exit 2
fi

CIBLE="$1"
[ -f "$CIBLE" ] || CIBLE="$MIGRATIONS/$1"

if [ ! -f "$CIBLE" ]; then
  echo "Fichier introuvable : $1" >&2
  echo "Attendu dans : $MIGRATIONS" >&2
  exit 2
fi

CIBLE="$(cd "$(dirname "$CIBLE")" && pwd)/$(basename "$CIBLE")"

case "$CIBLE" in
  "$MIGRATIONS"/*.sql) ;;
  *)
    echo "Refuse : seules les migrations de $MIGRATIONS sont applicables." >&2
    echo "Recu : $CIBLE" >&2
    exit 2
    ;;
esac

# nvm n'est pas ecrit pour `set -u` : une variable non definie chez lui tue le
# script sans un mot, et le `|| true` ne rattrape pas ca (c'est une erreur
# fatale du shell, pas un code de retour). On relache l'option le temps de le
# charger, et on la remet juste apres.
set +u
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use --lts >/dev/null 2>&1 || true
set -u

cd "$RACINE"
set -a
# shellcheck disable=SC1091
. ./.env
set +a

node scripts/appliquer-migration.mjs "$CIBLE"
