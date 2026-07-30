/* ─────────────────────────────────────────────────────────────────────────────
   De quel côté sort le trait — 0.1.7

   Le geste « touche le départ, puis l'arrivée » envoyait jusqu'ici
   `sourceHandle: null, targetHandle: null`. React Flow retombe alors sur la
   PREMIÈRE poignée source et la première cible, soit `sb` → `tt` : le trait
   partait donc toujours du bas pour remonter vers le haut, même pour relier
   deux cartes côte à côte. D'où des traits qui font le tour.

   Ici on compare la position des deux boîtes et on choisit le côté qui tombe
   sous le sens. Voir `poignees.tsx` pour le jeu d'ids.
   ───────────────────────────────────────────────────────────────────────────── */

const SOURCE = { haut: 'st', gauche: 'sl', bas: 'sb', droite: 'sr' } as const
const CIBLE = { haut: 'tt', gauche: 'tl', bas: 'tb', droite: 'tr' } as const

/** Le comportement d'avant, si on ne peut pas mesurer les cartes. */
const REPLI = { sourceHandle: SOURCE.bas, targetHandle: CIBLE.haut }

export type Boite = { x: number; y: number; w: number; h: number }

export function poigneesLesPlusProches(a: Boite, b: Boite) {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2)
  const dy = b.y + b.h / 2 - (a.y + a.h / 2)

  // L'axe dominant gagne : deux cartes plus écartées horizontalement que
  // verticalement se relient flanc à flanc, et inversement.
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: SOURCE.droite, targetHandle: CIBLE.gauche }
      : { sourceHandle: SOURCE.gauche, targetHandle: CIBLE.droite }
  }
  return dy >= 0
    ? { sourceHandle: SOURCE.bas, targetHandle: CIBLE.haut }
    : { sourceHandle: SOURCE.haut, targetHandle: CIBLE.bas }
}

/* Ce que `getInternalNode()` nous rend d'utile. Typage volontairement large :
   on ne dépend que des trois champs qu'on lit. */
type NoeudInterne = {
  internals: { positionAbsolute: { x: number; y: number } }
  measured?: { width?: number | null; height?: number | null }
  style?: { width?: number | string; height?: number | string }
}

const nombre = (v: unknown): number | null => (typeof v === 'number' ? v : null)

/** ⚠️ Position ABSOLUE obligatoire : un nœud posé dans un groupe a une position
 *  relative à son parent, et comparer une position relative à une absolue
 *  enverrait le trait du mauvais côté. */
function boite(n: NoeudInterne | null | undefined, repli: { w: number; h: number }): Boite | null {
  if (!n) return null
  const p = n.internals.positionAbsolute
  return {
    x: p.x,
    y: p.y,
    w: nombre(n.measured?.width) ?? nombre(n.style?.width) ?? repli.w,
    h: nombre(n.measured?.height) ?? nombre(n.style?.height) ?? repli.h,
  }
}

/** Les deux poignées à utiliser pour relier `sourceId` à `targetId`.
 *  `repli` sert aux nœuds qui n'ont pas encore été mesurés — les nœuds concept
 *  notamment n'ont aucune taille en `style`, elle ne vient que de `measured`. */
export function poigneesEntre(
  getInternalNode: (id: string) => NoeudInterne | null | undefined,
  sourceId: string,
  targetId: string,
  repli: { w: number; h: number },
) {
  const a = boite(getInternalNode(sourceId), repli)
  const b = boite(getInternalNode(targetId), repli)
  if (!a || !b) return REPLI
  return poigneesLesPlusProches(a, b)
}
