'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   PAGE JETABLE — 0.1.7, la GRAMMAIRE des traits.

   À ne pas confondre avec le labo du 26/07 (même route, commit `367b053`,
   supprimé depuis) : celui-là comparait six RENDUS du trait et a tranché la
   forme — courbe de Bézier + cercle animé au survol de la carte. Cette
   décision-là est acquise, elle est reprise à l'identique dans TOUTES les
   variantes ci-dessous. Ce qu'on tranche ici est autre chose : donner à chaque
   TYPE de lien une forme qui lui est propre, pour qu'on lise à l'écran ce que
   le trait veut dire.

   Les trois types viennent de la base, pas de la tête : `scripts/inventaire-
   traits-0.1.7.mjs` a compté les 22 traits existants et n'a trouvé que quatre
   paires, sans recouvrement. Le type est donc DÉDUCTIBLE de ce que le trait
   relie — aucune migration, aucun sélecteur à ajouter, rien à demander à
   l'élève :

     appartenance   note ↔ concept   « cette note porte ce concept »  (le futur backlink)
     filiation      bloc → bloc      « ceci découle de cela »          (orienté)
     association    note ↔ note      « ces deux séances se répondent » (symétrique)

   Deux faits de terrain qui contraignent le dessin :
   · le lien de concept existe DANS LES DEUX SENS en base (3 concept→note,
     1 note→concept) — le sens dépend juste de par où on a commencé le trait au
     crayon. L'appartenance ne peut donc pas porter de pointe de flèche : elle
     doit se lire pareil dans les deux sens. Le graphe ci-dessous en contient un
     de chaque sens, exprès ;
   · `@@unique([fromId, toId])` : un seul trait par couple de nœuds. Aucune
     grammaire ne pourra afficher deux liens de types différents entre les deux
     mêmes objets.

   Le graphe mélange les trois types sur un même écran. Aucune vue de l'app ne
   fait ça aujourd'hui (la filiation vit dans le canvas d'une note, les deux
   autres sur l'accueil) — mais le graphe global du second cerveau, lui, le fera,
   et c'est le pire cas : si les trois se distinguent ici, ils se distinguent
   partout.

   Route publique déclarée dans `middleware.ts` (publicPaths).
   À SUPPRIMER une fois tranché :
     rm -rf src/app/labo-traits .next/types/app/labo-traits
     puis retirer '/labo-traits' de publicPaths dans middleware.ts
   ───────────────────────────────────────────────────────────────────────────── */

import { useCallback, useMemo, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, BaseEdge, getBezierPath,
  Handle, Position, MarkerType,
  type EdgeProps, type Node, type Edge, type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTheme } from '@/contexts/ThemeContext'

const BLEU = '#3b82f6'      // la couleur du trait aujourd'hui
const AMBRE = '#f59e0b'
const VIOLET = '#a855f7'

/* ── Poignées : les quatre côtés, en départ comme en arrivée ─────────────────
   Invisibles. Elles servent uniquement à faire sortir les traits du bon côté
   pour que la démo soit lisible — la vraie mécanique des poignées est déjà
   posée dans le canvas (commit `7aad539`). */
function Poignees() {
  const c = { opacity: 0, width: 8, height: 8, border: 'none' } as const
  return (
    <>
      <Handle id="t-t" type="target" position={Position.Top} style={c} />
      <Handle id="t-l" type="target" position={Position.Left} style={c} />
      <Handle id="t-r" type="target" position={Position.Right} style={c} />
      <Handle id="t-b" type="target" position={Position.Bottom} style={c} />
      <Handle id="s-t" type="source" position={Position.Top} style={c} />
      <Handle id="s-l" type="source" position={Position.Left} style={c} />
      <Handle id="s-r" type="source" position={Position.Right} style={c} />
      <Handle id="s-b" type="source" position={Position.Bottom} style={c} />
    </>
  )
}

/* ── Les trois objets du graphe ──────────────────────────────────────────── */

function NoteDemo({ data }: NodeProps) {
  const d = data as { titre: string; apercu: string }
  return (
    <div className="note-map-card" style={{ width: 186, height: 100 }}>
      <Poignees />
      <div style={{ display: 'flex', gap: 7, padding: '10px 11px 5px' }}>
        <div style={{ width: 13, height: 13, borderRadius: 3, background: 'var(--node-border)', flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--node-title)', lineHeight: 1.3 }}>{d.titre}</span>
      </div>
      <p style={{
        padding: '0 11px', fontSize: 10, color: 'var(--node-preview)', lineHeight: 1.5, flex: 1,
        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{d.apercu}</p>
    </div>
  )
}

function ConceptDemo({ data }: NodeProps) {
  const d = data as { label: string; couleur: string }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 100,
      background: `${d.couleur}1f`, border: `1.5px solid ${d.couleur}`, boxShadow: 'var(--node-shadow)',
    }}>
      <Poignees />
      <span style={{ fontSize: 12.5, fontWeight: 700, color: d.couleur }}>#</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--node-title)', whiteSpace: 'nowrap' }}>{d.label}</span>
    </div>
  )
}

// Le bloc du canvas d'étude : même recette que `StudyCanvas` (fond, bordure,
// ombre, coin arrondi), en figé.
function BlocDemo({ data }: NodeProps) {
  const d = data as { texte: string }
  return (
    <div style={{
      width: 172, height: 78, borderRadius: 12, padding: 10, overflow: 'hidden',
      background: 'var(--node-bg)', border: '1px solid var(--node-border)',
      boxShadow: 'var(--node-shadow)', color: 'var(--node-preview)', fontSize: 11, lineHeight: 1.5,
    }}>
      <Poignees />
      {d.texte}
    </div>
  )
}

const nodeTypes = { note: NoteDemo, concept: ConceptDemo, bloc: BlocDemo }

/* ── Le trait ─────────────────────────────────────────────────────────────── */

type Look = {
  couleur: string
  epaisseur: number
  tirets?: string
  opacite: number
}

/** Un seul composant pour toutes les variantes : le look arrive en `data`, donc
 *  une grammaire n'est qu'une table de correspondance — on en compare cinq sans
 *  écrire cinq composants. Le cercle animé au survol est le rendu de
 *  production (`CanvasEdge.tsx`), gardé partout : la grammaire doit tenir AVEC
 *  lui, pas dans un décor de laboratoire. */
function Trait({ id, data, markerEnd, ...p }: EdgeProps) {
  const [chemin] = getBezierPath(p as Parameters<typeof getBezierPath>[0])
  const d = data as { look: Look; vif?: boolean }
  const { couleur, epaisseur, tirets, opacite } = d.look
  return (
    <>
      <BaseEdge
        id={id}
        path={chemin}
        markerEnd={markerEnd}
        style={{ stroke: couleur, strokeWidth: epaisseur, strokeDasharray: tirets, opacity: opacite }}
      />
      {d.vif && (
        <circle r={3.5} fill={couleur}>
          <animateMotion dur="2s" repeatCount="indefinite" path={chemin} />
        </circle>
      )}
    </>
  )
}

const edgeTypes = { trait: Trait }

/* ── Le graphe de démonstration ──────────────────────────────────────────── */

const NODES: Node[] = [
  { id: 'n1', type: 'note', position: { x: 0, y: 20 }, data: { titre: 'Session 17 mars', apercu: 'TopStepX MNQM26 −0.41% · RP&L $52.40 · BAL $49 408,80' } },
  { id: 'n2', type: 'note', position: { x: 0, y: 230 }, data: { titre: 'Les macros', apercu: 'NQ1! 30 347,75 ▼ −0.58% · Cours élève · Exercice 1 : observation' } },
  { id: 'c1', type: 'concept', position: { x: 300, y: 40 }, data: { label: 'FVG', couleur: BLEU } },
  { id: 'c2', type: 'concept', position: { x: 296, y: 262 }, data: { label: 'Discipline', couleur: VIOLET } },
  { id: 'b1', type: 'bloc', position: { x: 520, y: 110 }, data: { texte: 'Le déséquilibre laissé par l\'impulsion de 10h32.' } },
  { id: 'b2', type: 'bloc', position: { x: 520, y: 240 }, data: { texte: '→ donc j\'attends son retour avant d\'entrer.' } },
]

type TypeLien = 'appartenance' | 'filiation' | 'association'

type Lien = Edge & {
  nature: TypeLien
  /** Couleur du concept touché, quand il y en a un. En vrai c'est `Tag.color`. */
  couleurConcept?: string
}

const LIENS: Lien[] = [
  // Association : deux séances qui se répondent. Symétrique.
  { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 's-b', targetHandle: 't-t', nature: 'association' },
  // Appartenance, sens note → concept.
  { id: 'e2', source: 'n1', target: 'c1', sourceHandle: 's-r', targetHandle: 't-l', nature: 'appartenance', couleurConcept: BLEU },
  // Appartenance, sens concept → note : LE MÊME LIEN, tracé dans l'autre sens.
  // Il doit se rendre exactement pareil que le précédent.
  { id: 'e3', source: 'c2', target: 'n2', sourceHandle: 's-l', targetHandle: 't-r', nature: 'appartenance', couleurConcept: VIOLET },
  // Filiation : le raisonnement à l'intérieur d'une note. Orienté.
  { id: 'e4', source: 'b1', target: 'b2', sourceHandle: 's-b', targetHandle: 't-t', nature: 'filiation' },
]

/* ── Les grammaires à comparer ───────────────────────────────────────────── */

type Grammaire = {
  n: string
  titre: string
  idee: string
  /** true = le type porte une pointe de flèche (donc il est orienté). */
  pointe: (nature: TypeLien) => boolean
  look: (l: Lien) => Look
}

const GRAMMAIRES: Grammaire[] = [
  {
    n: '0',
    titre: 'Témoin — aujourd\'hui',
    idee: 'les trois types rendus à l\'identique : rien ne dit ce que le trait veut dire',
    pointe: () => false,
    look: () => ({ couleur: BLEU, epaisseur: 1.5, opacite: 0.5 }),
  },
  {
    n: 'A',
    titre: 'La forme seule',
    idee: 'un seul canal, le tracé. Pas de couleur nouvelle : l\'appartenance est tiretée, la filiation porte une pointe, l\'association reste le trait nu',
    pointe: nature => nature === 'filiation',
    look: l => ({
      appartenance: { couleur: BLEU, epaisseur: 1.5, tirets: '5 4', opacite: 0.6 },
      filiation: { couleur: BLEU, epaisseur: 1.5, opacite: 0.7 },
      association: { couleur: BLEU, epaisseur: 1.5, opacite: 0.4 },
    }[l.nature]),
  },
  {
    n: 'B',
    titre: 'Forme + couleur',
    idee: 'chaque type sa teinte, reconnaissable d\'un coup d\'œil — au prix de trois couleurs de plus dans un canvas qui a déjà celles des groupes',
    pointe: nature => nature === 'filiation',
    look: l => ({
      appartenance: { couleur: VIOLET, epaisseur: 1.6, tirets: '5 4', opacite: 0.75 },
      filiation: { couleur: AMBRE, epaisseur: 1.6, opacite: 0.75 },
      association: { couleur: BLEU, epaisseur: 1.5, opacite: 0.5 },
    }[l.nature]),
  },
  {
    n: 'C',
    titre: 'Le trait porte la couleur du concept',
    idee: 'l\'appartenance emprunte la couleur du concept qu\'elle touche (en vrai : `Tag.color`) ; les deux autres restent neutres. Dit que le backlink est l\'information forte et le reste du décor',
    pointe: nature => nature === 'filiation',
    look: l => l.nature === 'appartenance'
      ? { couleur: l.couleurConcept ?? BLEU, epaisseur: 2, opacite: 0.85 }
      : { couleur: 'var(--node-meta)', epaisseur: 1.4, opacite: l.nature === 'filiation' ? 0.6 : 0.35 },
  },
  {
    n: 'D',
    titre: 'La hiérarchie par le poids',
    idee: 'ni couleur ni tiret : l\'épaisseur et l\'opacité trient. L\'appartenance pèse, la filiation existe, l\'association s\'efface',
    pointe: nature => nature === 'filiation',
    look: l => ({
      appartenance: { couleur: BLEU, epaisseur: 2.6, opacite: 0.8 },
      filiation: { couleur: BLEU, epaisseur: 1.6, opacite: 0.55 },
      association: { couleur: BLEU, epaisseur: 1, opacite: 0.3 },
    }[l.nature]),
  },
]

function Demo({ g }: { g: Grammaire }) {
  const [survole, setSurvole] = useState<string | null>(null)
  const edges = useMemo(
    () => LIENS.map(l => {
      const look = g.look(l)
      return {
        ...l,
        type: 'trait',
        data: { look, vif: !!survole && (l.source === survole || l.target === survole) },
        markerEnd: g.pointe(l.nature)
          ? { type: MarkerType.ArrowClosed, color: look.couleur, width: 16, height: 16 }
          : undefined,
      }
    }),
    [g, survole],
  )
  const enter = useCallback((_: React.MouseEvent, n: Node) => setSurvole(n.id), [])
  const leave = useCallback(() => setSurvole(null), [])

  return (
    <ReactFlow
      nodes={NODES}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeMouseEnter={enter}
      onNodeMouseLeave={leave}
      fitView
      fitViewOptions={{ padding: 0.1 }}
      nodesDraggable={false}
      nodesConnectable={false}
      panOnDrag={false}
      zoomOnScroll={false}
      zoomOnDoubleClick={false}
      preventScrolling={false}
      proOptions={{ hideAttribution: true }}
    />
  )
}

/* ── La page ──────────────────────────────────────────────────────────────── */

const LEGENDE: { nature: TypeLien; relie: string; dit: string; sens: string }[] = [
  { nature: 'appartenance', relie: 'note ↔ concept', dit: 'cette note porte ce concept', sens: 'non orienté — c\'est le futur backlink' },
  { nature: 'filiation', relie: 'bloc → bloc', dit: 'ceci découle de cela', sens: 'orienté' },
  { nature: 'association', relie: 'note ↔ note', dit: 'ces deux séances se répondent', sens: 'non orienté' },
]

export default function LaboTraits() {
  const { theme, toggleTheme } = useTheme()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--canvas-bg)', padding: '28px 32px 80px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 6 }}>
          <h1 style={{ fontSize: 22, color: 'var(--node-title)' }}>La grammaire des traits</h1>
          <button onClick={toggleTheme} className="canvas-float-pill" style={{ padding: '8px 14px', fontSize: 13, color: 'var(--node-title)', cursor: 'pointer', flexShrink: 0 }}>
            {theme === 'dark' ? '☀ Voir en clair' : '☾ Voir en sombre'}
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--node-meta)', marginBottom: 14, maxWidth: 790, lineHeight: 1.6 }}>
          La forme du trait est déjà tranchée (26/07) : <strong style={{ color: 'var(--node-title)' }}>Bézier, et le cercle
          s&apos;anime au survol d&apos;une carte</strong>. C&apos;est repris tel quel dans les cinq — <strong style={{ color: 'var(--node-title)' }}>survole
          une carte</strong> pour le vérifier. Ce qu&apos;on tranche ici, c&apos;est autre chose : donner à chaque <em>type</em> de
          lien une forme qui lui est propre, pour qu&apos;on lise à l&apos;écran ce que le trait veut dire.
        </p>

        <div style={{
          fontSize: 12, color: 'var(--node-meta)', lineHeight: 1.65, marginBottom: 14, maxWidth: 790,
          padding: '12px 14px', borderRadius: 10, background: 'var(--node-bg)', border: '1px solid var(--node-border)',
        }}>
          <strong style={{ color: 'var(--node-title)' }}>Les trois types viennent de la base, pas de la tête.</strong> L&apos;inventaire
          des 22 traits existants (<code>scripts/inventaire-traits-0.1.7.mjs</code>) n&apos;a trouvé que quatre paires, sans
          recouvrement — donc le type se <em>déduit</em> de ce que le trait relie : aucune migration, aucun sélecteur, rien à
          demander à l&apos;élève.
          <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
            {LEGENDE.map(l => (
              <div key={l.nature} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span style={{ fontWeight: 700, color: 'var(--node-title)', minWidth: 104 }}>{l.nature}</span>
                <code style={{ fontSize: 11, opacity: 0.9 }}>{l.relie}</code>
                <span>« {l.dit} »</span>
                <span style={{ opacity: 0.7 }}>· {l.sens}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{
          fontSize: 12, color: 'var(--node-meta)', lineHeight: 1.65, marginBottom: 30, maxWidth: 790,
          padding: '12px 14px', borderRadius: 10, border: '1px dashed var(--node-border)',
        }}>
          <strong style={{ color: 'var(--node-title)' }}>Deux pièges que le dessin doit encaisser.</strong> ① Le lien de concept
          existe <strong>dans les deux sens</strong> en base (3 <code>concept→note</code>, 1 <code>note→concept</code>) : le sens
          dépend juste de par où tu as commencé le trait au crayon. Le graphe en contient un de chaque — <em>ils doivent se
          rendre pareil</em>, sinon le backlink pointera au hasard. ② Le graphe mélange les trois types, ce qu&apos;aucun écran
          ne fait aujourd&apos;hui : c&apos;est le pire cas, et c&apos;est exactement ce que sera le graphe global du second cerveau.
        </div>

        <div style={{ display: 'grid', gap: 34 }}>
          {GRAMMAIRES.map(g => (
            <div key={g.n}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 12, fontWeight: 700, width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)',
                }}>{g.n}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--node-title)' }}>{g.titre}</span>
                <span style={{ fontSize: 12, color: 'var(--node-meta)', flex: 1, minWidth: 240 }}>{g.idee}</span>
              </div>
              <div style={{ position: 'relative', height: 380, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--node-border)' }}>
                <div className="canvas-grid" />
                <ReactFlowProvider><Demo g={g} /></ReactFlowProvider>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
