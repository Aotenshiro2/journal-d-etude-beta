'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   Le trait du canvas — 0.1.7

   ── La FORME (tranchée le 26/07 sur `/labo-traits`, variante 3) ──────────────
   Courbe de Bézier partout à la place des coudes à angle droit du `smoothstep`,
   et le cercle qui parcourt le tracé UNIQUEMENT sur les traits de la carte
   survolée. Source : le composant Edge d'AI SDK Elements
   (https://elements.ai-sdk.dev/components/edge) pour la courbe et pour le
   cercle animé (2 s, en boucle). Le déclenchement au survol, lui, est à nous.
   Animer en permanence a été écarté volontairement : leur démo tourne à six
   nœuds, un canvas d'élève en porte des dizaines. Au repos rien ne bouge, donc
   rien ne coûte — `avecSurvol` renvoie la liste inchangée tant qu'aucune carte
   n'est survolée.

   ── La GRAMMAIRE (tranchée le 31/08, second tour du labo, variante F) ────────
   Jusqu'ici tous les traits se rendaient pareil : rien ne distinguait « cette
   note porte ce concept » de « ceci découle de cela ». C'est pourtant la
   distinction dont le second cerveau a besoin pour exister à l'écran, et le
   lien note→concept EST le futur backlink.

   Trois types, et ils ne sont pas déclarés : ils se DÉDUISENT de ce que le trait
   relie. L'inventaire des 22 traits en base (`scripts/inventaire-traits-0.1.7.mjs`)
   n'a trouvé que quatre paires, sans recouvrement — donc aucune migration,
   aucun sélecteur, rien à demander à l'élève.

     appartenance  une extrémité est un concept  couleur DU CONCEPT, tiretée, épaisse
     filiation     bloc → bloc                   ambre, pleine, avec une pointe
     association   le reste (note ↔ note)        neutre, fine, en retrait

   Trois conséquences à ne pas défaire par mégarde :
   · l'appartenance ne porte PAS de pointe. En base le lien de concept existe
     dans les deux sens (3 `concept→note`, 1 `note→concept`) : le sens ne dit
     rien, il dépend de par où le crayon est parti. Une flèche mentirait ;
   · l'association passe au NEUTRE, ce qui libère le bleu pour les concepts au
     lieu de le leur disputer ;
   · la couleur d'appartenance se calcule depuis le NOM du concept
     (`lib/couleur-concept.ts`) — les 126 `Tag.color` de la base valent tous le
     même bleu par défaut, donc lire la colonne telle quelle rendait 126 traits
     identiques.

   ── Pourquoi la grammaire vit ICI et pas aux sites de construction ───────────
   Les traits se construisent à quatre endroits (chargement + création, sur les
   deux canvas). Une grammaire recopiée quatre fois, c'est trois occasions de
   l'oublier — et le trait qu'on vient de poser au crayon serait le premier à
   sortir sans elle. D'où la lecture des nœuds dans le store plutôt qu'une
   nature passée en `data` : un trait neuf est habillé sans que personne y pense.
   ───────────────────────────────────────────────────────────────────────────── */

import { useCallback } from 'react'
import { BaseEdge, getBezierPath, useStore, type EdgeProps } from '@xyflow/react'
import { couleurConcept } from '@/lib/couleur-concept'

export type TraitData = { vif?: boolean }

const AMBRE = '#f59e0b'
const NEUTRE = 'var(--node-meta)'

type Nature = 'appartenance' | 'filiation' | 'association'

/** Ce que le trait relie, réduit au strict nécessaire pour le dessiner. */
type Contexte = { nature: Nature; nomConcept: string; couleurStockee: string | null }

function look(c: Contexte) {
  switch (c.nature) {
    case 'appartenance':
      return {
        couleur: couleurConcept(c.nomConcept, c.couleurStockee),
        epaisseur: 2.2, tirets: '5 4', opacite: 0.85, pointe: false,
      }
    case 'filiation':
      return { couleur: AMBRE, epaisseur: 1.6, tirets: undefined, opacite: 0.7, pointe: true }
    case 'association':
      return { couleur: NEUTRE, epaisseur: 1.1, tirets: undefined, opacite: 0.32, pointe: false }
  }
}

export function TraitCanvas({
  id, data, markerEnd, source, target,
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

  // Le sélecteur ne renvoie que trois valeurs simples, comparées à la main :
  // sans fonction d'égalité il rendrait un objet neuf à chaque changement du
  // store — donc à chaque déplacement d'un nœud — et re-rendrait tous les traits
  // du canvas pour rien.
  const contexte = useStore(
    useCallback((s): Contexte => {
      const a = s.nodeLookup.get(source)
      const b = s.nodeLookup.get(target)
      const concept = a?.type === 'concept' ? a : b?.type === 'concept' ? b : null
      if (concept) {
        const d = concept.data as { label?: string; color?: string | null } | undefined
        return { nature: 'appartenance', nomConcept: d?.label ?? '', couleurStockee: d?.color ?? null }
      }
      // Deux blocs = un raisonnement à l'intérieur d'une note. Tout le reste
      // (notes entre elles, et les cas de bord type groupe) reste de
      // l'association : le type par défaut est le moins affirmatif des trois.
      const nature: Nature = a?.type === 'message' && b?.type === 'message' ? 'filiation' : 'association'
      return { nature, nomConcept: '', couleurStockee: null }
    }, [source, target]),
    (x, y) => x.nature === y.nature && x.nomConcept === y.nomConcept && x.couleurStockee === y.couleurStockee,
  )

  const { couleur, epaisseur, tirets, opacite, pointe } = look(contexte)
  const vif = !!(data as TraitData | undefined)?.vif

  // La pointe est définie ici, avec un id propre au trait. React Flow ne
  // fabrique ses `<defs>` qu'à partir des `markerEnd` posés sur les edges du
  // store : un marqueur inventé dans le composant n'y figurerait pas, et la
  // référence `url(#…)` pointerait dans le vide. Un id par trait évite en plus
  // toute collision, et permet à la pointe de suivre la couleur du trait.
  const idPointe = `trait-pointe-${id}`

  return (
    <>
      {pointe && (
        <defs>
          <marker
            id={idPointe} markerWidth="10" markerHeight="10"
            refX="8.5" refY="4" orient="auto" markerUnits="strokeWidth"
          >
            <path d="M0,0.5 L0,7.5 L8.5,4 z" fill={couleur} opacity={opacite} />
          </marker>
        </defs>
      )}
      <BaseEdge
        id={id}
        path={chemin}
        markerEnd={pointe ? `url(#${idPointe})` : markerEnd}
        style={{ stroke: couleur, strokeWidth: epaisseur, strokeDasharray: tirets, opacity: opacite }}
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
        // Le cercle reprend la couleur du trait, mais pas son opacité : le trait
        // est en retrait, le cercle doit se voir.
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
