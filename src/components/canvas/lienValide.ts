/* ─────────────────────────────────────────────────────────────────────────────
   Ce qu'on refuse de relier — 0.1.7

   Sans ces gardes, le POST part quand même, se prend le 409 de la contrainte
   `@@unique([fromId, toId])`, et selon le canvas :
   - à l'accueil, `if (!res.ok) return` → il ne se passe absolument rien, aucun
     message, l'élève croit avoir raté son geste ;
   - sur une note, le trait était ajouté AVANT le fetch et n'était jamais retiré
     → un trait fantôme restait à l'écran jusqu'au rechargement.
   ───────────────────────────────────────────────────────────────────────────── */

import { ConnectionLineType, type Connection, type Edge } from '@xyflow/react'

/** Props d'assistance à la visée, communes aux deux canvas.
 *  - `connectionRadius` : 20 px par défaut, ce qui oblige à viser juste. À 45 la
 *    poignée devient franchement aimantée.
 *  - la ligne de connexion était un trait gris par défaut, qui ne ressemblait pas
 *    du tout au trait final (Bézier bleu, cf. `CanvasEdge.tsx`). On la fait
 *    ressembler à ce qu'elle va devenir, en pointillé pour dire « pas encore
 *    posé ». */
export const ASSISTANCE_CONNEXION = {
  connectionRadius: 45,
  connectionLineType: ConnectionLineType.Bezier,
  connectionLineStyle: { stroke: '#3b82f6', strokeWidth: 1.5, strokeDasharray: '4 3' },
} as const

/** La contrainte en base est ORIENTÉE : A→B et B→A sont deux lignes distinctes,
 *  et c'est voulu — « ceci découle de cela » a un sens. On ne refuse donc que le
 *  doublon exact, pas le lien retour. */
export function lienDejaPresent(
  edges: Edge[],
  source?: string | null,
  target?: string | null,
): boolean {
  if (!source || !target) return false
  return edges.some(e => e.source === source && e.target === target)
}

/** À passer à `isValidConnection` : refuse une carte reliée à elle-même et le
 *  doublon. React Flow refuse alors le lâcher, sans aller-retour serveur. */
export function connexionValide(edges: Edge[]) {
  return (c: Connection | Edge): boolean => {
    if (!c.source || !c.target || c.source === c.target) return false
    return !lienDejaPresent(edges, c.source, c.target)
  }
}
