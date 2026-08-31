/* ─────────────────────────────────────────────────────────────────────────────
   La couleur d'un concept — 0.1.7

   `Tag.color` existe depuis toujours et vaut `#3b82f6` pour les 126 concepts de
   la base : c'est le défaut du schéma, et rien dans l'app n'écrit jamais cette
   colonne — il n'y a aucun endroit pour choisir la couleur d'un concept.
   Résultat, faire porter au trait « la couleur du concept » donnait 126 traits
   du même bleu, soit exactement le rendu qu'on cherchait à quitter.

   D'où cette dérivation : la couleur se CALCULE depuis le nom. `#FVG` tire la
   même teinte sur tous les écrans, à toutes les sessions, sans rien stocker,
   sans migration, sans sélecteur à construire et sans 126 concepts à peindre à
   la main. Variante F du labo `/labo-traits`, choisie par Brice le 31/08/2026.

   La couleur stockée reste prioritaire si elle a été VOULUE (différente du
   défaut) : le jour où un sélecteur existera, il gagnera sans qu'on retouche ce
   fichier.
   ───────────────────────────────────────────────────────────────────────────── */

/** Le bleu par défaut du schéma Prisma. Une valeur égale à celle-ci ne veut pas
 *  dire « bleu choisi », elle veut dire « personne n'a jamais choisi ». */
export const BLEU_DEFAUT = '#3b82f6'

/** L'ambre est volontairement absente : elle est prise par le trait de
 *  filiation dans la grammaire (`CanvasEdge.tsx`), et un concept qui tirerait
 *  la teinte d'un type de lien ruinerait la lecture. Le bleu, lui, reste
 *  disponible : l'association est passée au neutre. */
const PALETTE = [
  '#3b82f6', // bleu
  '#a855f7', // violet
  '#10b981', // émeraude
  '#06b6d4', // cyan
  '#ec4899', // rose
  '#84cc16', // lime
  '#6366f1', // indigo
  '#14b8a6', // teal
] as const

/** Hash stable et sans dépendance. Le nom est normalisé (minuscules, espaces
 *  rognés) pour que « TP » et « tp » — les deux existent en base — ne se
 *  retrouvent pas de deux couleurs différentes. */
export function couleurConcept(nom: string, couleurStockee?: string | null): string {
  if (couleurStockee && couleurStockee !== BLEU_DEFAUT) return couleurStockee
  const cle = nom.trim().toLowerCase()
  if (!cle) return BLEU_DEFAUT
  let h = 0
  for (let i = 0; i < cle.length; i++) h = (h * 31 + cle.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}
