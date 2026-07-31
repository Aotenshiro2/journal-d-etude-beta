'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   Le trait du canvas — 0.1.7

   Variante 3 du labo (`/labo-traits`), choisie par Brice : la courbe de Bézier
   partout à la place des coudes à angle droit du `smoothstep`, et le cercle qui
   parcourt le tracé UNIQUEMENT sur les traits de la carte survolée.

   Source : le composant Edge d'AI SDK Elements
   (https://elements.ai-sdk.dev/components/edge) pour la courbe et pour le cercle
   animé (2 s, en boucle). Le déclenchement au survol, lui, est à nous.

   Animer en permanence a été écarté volontairement : leur démo tourne à six
   nœuds, un canvas d'élève en porte des dizaines. Au repos rien ne bouge, donc
   rien ne coûte — `avecSurvol` renvoie la liste inchangée tant qu'aucune carte
   n'est survolée.
   ───────────────────────────────────────────────────────────────────────────── */

import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'

export type TraitData = { vif?: boolean }

export function TraitCanvas({
  id, data, style, markerEnd,
  // Le libellé d'un trait (le concept qu'on lui donne au double-clic) était rendu
  // gratuitement par le `smoothstep` intégré de React Flow. En passant à ce
  // composant, il a disparu : `BaseEdge` sait l'afficher, encore faut-il le lui
  // passer. Régression introduite avec ce fichier, réparée ici.
  label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius,
  ...p
}: EdgeProps) {
  const [chemin, labelX, labelY] = getBezierPath({
    sourceX: p.sourceX,
    sourceY: p.sourceY,
    sourcePosition: p.sourcePosition,
    targetX: p.targetX,
    targetY: p.targetY,
    targetPosition: p.targetPosition,
  })
  const vif = !!(data as TraitData | undefined)?.vif
  // Le cercle reprend la couleur du trait, mais pas son opacité : le trait est
  // en retrait (0.5), le cercle doit se voir.
  const couleur = (style?.stroke as string | undefined) ?? '#3b82f6'

  return (
    <>
      <BaseEdge
        id={id}
        path={chemin}
        markerEnd={markerEnd}
        style={style}
        label={label}
        labelX={labelX}
        labelY={labelY}
        labelStyle={labelStyle}
        labelShowBg={labelShowBg}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
      />
      {vif && (
        <circle r={3.5} fill={couleur}>
          <animateMotion dur="2s" repeatCount="indefinite" path={chemin} />
        </circle>
      )}
    </>
  )
}

export const canvasEdgeTypes = { trait: TraitCanvas }

/** Marque les traits qui touchent la carte survolée. Renvoie la liste telle
 *  quelle quand rien n'est survolé : aucune allocation au repos. */
export function avecSurvol<E extends { source: string; target: string; data?: unknown }>(
  edges: E[],
  survole: string | null,
): E[] {
  if (!survole) return edges
  return edges.map(e =>
    e.source === survole || e.target === survole
      ? { ...e, data: { ...(e.data as object | undefined), vif: true } }
      : e,
  )
}
