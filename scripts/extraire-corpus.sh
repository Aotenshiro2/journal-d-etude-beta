#!/usr/bin/env bash
#
# Extrait le CORPUS PÉDAGOGIQUE en texte, pour alimenter les fiches de concept
# du 0.2 (SPEC-second-cerveau.md §11).
#
#   wsl.exe -e /home/aotenshiro/Projects/Aoknowledge/apps/journal-d-etude/scripts/extraire-corpus.sh
#   (depuis Git Bash sous Windows, préfixer MSYS_NO_PATHCONV=1)
#
# ── POURQUOI CE SCRIPT EXISTE ────────────────────────────────────────────────
# Mesuré le 31/08 : le corpus TEXTE déjà accessible ne couvre presque pas les
# concepts que les membres taguent. Le `Glossaire V3` de la formation est un
# glossaire DÉBUTANT (zéro occurrence de macro breaker, ffvg, nro, ote, hrlr,
# quadrants, modèle 2022…) et les chroniques n'en portent que quelques-uns.
# La matière avancée est dans les 147 PDF de la formation et les ~20 PDF ICT.
# Tant qu'ils ne sont pas en texte, la couche corpus des fiches ne peut pas
# dépasser deux ou trois concepts.
#
# ── LA SEULE DÉPENDANCE ──────────────────────────────────────────────────────
# `pdftotext`, fourni par poppler-utils. Il n'était pas installé le 31/08, et
# installer un paquet sur la machine de Brice sans lui demander n'était pas mon
# rôle. Une seule commande :
#
#     sudo apt install poppler-utils
#
# ── CE QUI N'EST PAS TRAITÉ, ET POURQUOI ─────────────────────────────────────
# · Les 419 .mp4 et les 46 .pptx de la formation. Les vidéos demandent une
#   transcription (chantier à part, coût réel) ; les pptx demandent un autre
#   outil. Le script les COMPTE et le dit, pour que leur absence soit visible
#   plutôt que silencieuse.
# · Rien n'est écrit dans le dépôt : la sortie va dans un dossier à part sur D:.
#   Ce corpus est la matière pédagogique de Brice — elle n'a rien à faire dans
#   un dépôt git, ni sur un serveur.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SOURCE="/mnt/d/3_Pedagogie"
SORTIE="/mnt/d/3_Pedagogie/_corpus-texte"

if ! command -v pdftotext >/dev/null 2>&1; then
  echo "pdftotext est absent — c'est la seule chose qui manque."
  echo
  echo "    sudo apt install poppler-utils"
  echo
  echo "Puis relancer ce script. Rien d'autre à préparer."
  exit 3
fi

if [ ! -d "$SOURCE" ]; then
  echo "Corpus introuvable : $SOURCE" >&2
  exit 2
fi

mkdir -p "$SORTIE"

extraits=0
echecs=0
deja=0

while IFS= read -r -d '' pdf; do
  relatif="${pdf#"$SOURCE"/}"
  cible="$SORTIE/${relatif%.pdf}.txt"
  mkdir -p "$(dirname "$cible")"

  if [ -f "$cible" ] && [ "$cible" -nt "$pdf" ]; then
    deja=$((deja + 1))
    continue
  fi

  # -layout preserve les colonnes : sans lui, un tableau de niveaux devient une
  # bouillie de chiffres sans lien avec leur libellé.
  if pdftotext -layout -enc UTF-8 "$pdf" "$cible" 2>/dev/null; then
    extraits=$((extraits + 1))
  else
    echecs=$((echecs + 1))
    echo "  échec : $relatif" >&2
  fi
done < <(find "$SOURCE" -type f -iname '*.pdf' -not -path "$SORTIE/*" -print0)

echo
echo "PDF extraits    : $extraits"
echo "Déjà à jour     : $deja"
echo "Échecs          : $echecs   (souvent des PDF scannés — ils demanderaient de l'OCR)"
echo "Sortie          : $SORTIE"
echo
echo "NON TRAITÉ, et c'est volontaire :"
echo "  $(find "$SOURCE" -type f -iname '*.mp4' | wc -l) vidéos    — transcription, chantier à part"
echo "  $(find "$SOURCE" -type f -iname '*.pptx' | wc -l) pptx      — autre outil"
echo
echo "Ensuite : les fiches se rédigent depuis ce texte, avec leur repérage, dans"
echo "scripts/fiches-concepts-corpus.mjs. Un tip sans source ne s'écrit pas."
