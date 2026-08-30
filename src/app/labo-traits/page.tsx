'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   PAGE JETABLE — 0.1.7, la GRAMMAIRE des traits. SECOND TOUR.

   Premier tour (commit `ebd72e0`) : cinq grammaires, Brice élimine A et D et
   hésite entre B (chaque type sa couleur) et C (le trait d'appartenance porte
   la couleur du concept). Il demande un mix.

   CE QUE LE PREMIER TOUR CACHAIT, trouvé en vérifiant `Tag.color` avant de
   dessiner le mix (`scripts/inventaire-couleurs-concepts.mjs`) : les 126
   concepts de la base sont TOUS au même bleu `#3b82f6`, le défaut du schéma —
   rien dans l'app n'écrit jamais cette colonne, il n'existe aucun endroit pour
   choisir la couleur d'un concept. La variante C ne tenait donc qu'à une
   tricherie de la démo, où j'avais peint les deux concepts à la main. En vrai
   elle rendrait 126 traits bleus, c'est-à-dire le témoin.

   D'où la forme de ce second tour : les deux mix ne diffèrent que par UN point,
   celui qui sépare B de C — d'où vient la couleur du trait d'appartenance.
     E : d'une couleur fixe du type (B), avec la hiérarchie de poids de C.
     F : du concept lui-même, dérivée de son nom (ce que C voulait dire, rendu
         possible sans sélecteur ni migration).
   Tout le reste est identique entre les deux, exprès : c'est la seule façon de
   juger le point qui reste ouvert.

   Ce qui est acquis et repris partout : la forme du trait (Bézier + cercle
   animé au survol de la carte, tranché le 26/07), et les trois types déduits de
   la structure (inventaire des 22 traits, `scripts/inventaire-traits-0.1.7.mjs`).

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

const BLEU = '#3b82f6'      // la couleur de TOUT aujourd'hui : traits et concepts
const AMBRE = '#f59e0b'
const VIOLET = '#a855f7'
const NEUTRE = 'var(--node-meta)'

/* ── La couleur dérivée du nom du concept ────────────────────────────────────
   L'ambre est volontairement absente de la palette : elle est prise par la
   filiation, et un concept qui tirerait la même teinte qu'un type de lien
   ruinerait la grammaire. Le bleu reste, lui, parce que l'association passe au
   neutre dans les deux mix. Hash stable : `#FVG` tire la même couleur sur tous
   les écrans, à toutes les sessions, sans rien stocker. */
const PALETTE = ['#3b82f6', '#a855f7', '#10b981', '#06b6d4', '#ec4899', '#84cc16', '#6366f1', '#14b8a6']

function couleurDerivee(nom: string): string {
  let h = 0
  for (let i = 0; i < nom.length; i++) h = (h * 31 + nom.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/* ── Poignées : les quatre côtés, en départ comme en arrivée ─────────────── */

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

type Look = { couleur: string; epaisseur: number; tirets?: string; opacite: number }

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

const CONCEPTS = ['FVG', 'Discipline'] as const

/** Les nœuds dépendent de la grammaire : la couleur des pastilles de concept
 *  fait partie de ce qu'on juge, elle ne peut pas être figée dans une constante. */
function noeuds(couleurConcept: (nom: string) => string): Node[] {
  return [
    { id: 'n1', type: 'note', position: { x: 0, y: 20 }, data: { titre: 'Session 17 mars', apercu: 'TopStepX MNQM26 −0.41% · RP&L $52.40 · BAL $49 408,80' } },
    { id: 'n2', type: 'note', position: { x: 0, y: 230 }, data: { titre: 'Les macros', apercu: 'NQ1! 30 347,75 ▼ −0.58% · Cours élève · Exercice 1 : observation' } },
    { id: 'c1', type: 'concept', position: { x: 300, y: 40 }, data: { label: 'FVG', couleur: couleurConcept('FVG') } },
    { id: 'c2', type: 'concept', position: { x: 288, y: 262 }, data: { label: 'Discipline', couleur: couleurConcept('Discipline') } },
    { id: 'b1', type: 'bloc', position: { x: 520, y: 110 }, data: { texte: 'Le déséquilibre laissé par l\'impulsion de 10h32.' } },
    { id: 'b2', type: 'bloc', position: { x: 520, y: 240 }, data: { texte: '→ donc j\'attends son retour avant d\'entrer.' } },
  ]
}

type TypeLien = 'appartenance' | 'filiation' | 'association'

type Lien = Edge & {
  nature: TypeLien
  /** Nom du concept touché, quand il y en a un — la couleur en est dérivée. */
  concept?: string
}

const LIENS: Lien[] = [
  { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 's-b', targetHandle: 't-t', nature: 'association' },
  // Appartenance, sens note → concept.
  { id: 'e2', source: 'n1', target: 'c1', sourceHandle: 's-r', targetHandle: 't-l', nature: 'appartenance', concept: 'FVG' },
  // Appartenance, sens concept → note : LE MÊME LIEN, tracé dans l'autre sens.
  { id: 'e3', source: 'c2', target: 'n2', sourceHandle: 's-l', targetHandle: 't-r', nature: 'appartenance', concept: 'Discipline' },
  // Filiation : le raisonnement à l'intérieur d'une note. Orienté.
  { id: 'e4', source: 'b1', target: 'b2', sourceHandle: 's-b', targetHandle: 't-t', nature: 'filiation' },
]

/* ── Les grammaires ──────────────────────────────────────────────────────── */

type Grammaire = {
  n: string
  titre: string
  idee: string
  /** Étiquette d'état affichée à côté du titre. */
  statut?: { texte: string; ton: 'mix' | 'alerte' }
  couleurConcept: (nom: string) => string
  pointe: (nature: TypeLien) => boolean
  look: (l: Lien) => Look
}

const GRAMMAIRES: Grammaire[] = [
  {
    n: '0',
    titre: 'Témoin — aujourd\'hui',
    idee: 'les trois types rendus à l\'identique, et les concepts tous au même bleu : c\'est l\'état réel de la base',
    couleurConcept: () => BLEU,
    pointe: () => false,
    look: () => ({ couleur: BLEU, epaisseur: 1.5, opacite: 0.5 }),
  },
  {
    n: 'B',
    titre: 'Forme + couleur',
    idee: 'chaque type sa teinte fixe. Ce que tu avais retenu au premier tour',
    couleurConcept: () => BLEU,
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
    idee: 'l\'autre moitié de ton hésitation — mais les couleurs ci-dessous sont peintes à la main : en base les 126 concepts sont au même bleu, donc en vrai cette variante rend le témoin',
    statut: { texte: 'ne tient pas en l\'état', ton: 'alerte' },
    couleurConcept: nom => (nom === 'FVG' ? BLEU : VIOLET),
    pointe: nature => nature === 'filiation',
    look: l => l.nature === 'appartenance'
      ? { couleur: l.concept === 'FVG' ? BLEU : VIOLET, epaisseur: 2, opacite: 0.85 }
      : { couleur: NEUTRE, epaisseur: 1.4, opacite: l.nature === 'filiation' ? 0.6 : 0.35 },
  },
  {
    n: 'E',
    titre: 'Mix — la couleur du TYPE, le poids de C',
    idee: 'B pour les teintes (appartenance violette, filiation ambre), C pour la hiérarchie : l\'appartenance pèse, l\'association s\'efface en neutre au lieu de disputer le bleu. Aucune condition préalable, implémentable ce soir',
    statut: { texte: 'mix', ton: 'mix' },
    couleurConcept: () => BLEU,
    pointe: nature => nature === 'filiation',
    look: l => ({
      appartenance: { couleur: VIOLET, epaisseur: 2.2, tirets: '5 4', opacite: 0.85 },
      filiation: { couleur: AMBRE, epaisseur: 1.6, opacite: 0.7 },
      association: { couleur: NEUTRE, epaisseur: 1.1, opacite: 0.32 },
    }[l.nature]),
  },
  {
    n: 'F',
    titre: 'Mix — la couleur du CONCEPT, dérivée de son nom',
    idee: 'identique à E sur tout, sauf un point : l\'appartenance prend la couleur du concept, calculée depuis son nom (donc stable et gratuite, sans sélecteur ni migration). Corollaire visible : les pastilles de concept se colorent aussi',
    statut: { texte: 'mix', ton: 'mix' },
    couleurConcept: couleurDerivee,
    pointe: nature => nature === 'filiation',
    look: l => l.nature === 'appartenance'
      ? { couleur: couleurDerivee(l.concept ?? ''), epaisseur: 2.2, tirets: '5 4', opacite: 0.85 }
      : l.nature === 'filiation'
        ? { couleur: AMBRE, epaisseur: 1.6, opacite: 0.7 }
        : { couleur: NEUTRE, epaisseur: 1.1, opacite: 0.32 },
  },
]

function Demo({ g }: { g: Grammaire }) {
  const [survole, setSurvole] = useState<string | null>(null)
  const nodes = useMemo(() => noeuds(g.couleurConcept), [g])
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
      nodes={nodes}
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
          <h1 style={{ fontSize: 22, color: 'var(--node-title)' }}>La grammaire des traits — second tour</h1>
          <button onClick={toggleTheme} className="canvas-float-pill" style={{ padding: '8px 14px', fontSize: 13, color: 'var(--node-title)', cursor: 'pointer', flexShrink: 0 }}>
            {theme === 'dark' ? '☀ Voir en clair' : '☾ Voir en sombre'}
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--node-meta)', marginBottom: 14, maxWidth: 790, lineHeight: 1.6 }}>
          Tu as éliminé A et D, et tu hésites entre <strong style={{ color: 'var(--node-title)' }}>B</strong> et <strong style={{ color: 'var(--node-title)' }}>C</strong>.
          Les deux mix, <strong style={{ color: 'var(--node-title)' }}>E</strong> et <strong style={{ color: 'var(--node-title)' }}>F</strong>, sont
          identiques en tout sauf sur le point exact qui les sépare : <em>d&apos;où vient la couleur du trait d&apos;appartenance</em>.
          Du type, ou du concept. Tout le reste est verrouillé pareil, pour que ce soit ça — et rien d&apos;autre — que tu juges.
        </p>

        <div style={{
          fontSize: 12, color: 'var(--node-meta)', lineHeight: 1.65, marginBottom: 14, maxWidth: 790,
          padding: '12px 14px', borderRadius: 10, border: `1px solid ${AMBRE}66`, background: `${AMBRE}0f`,
        }}>
          <strong style={{ color: 'var(--node-title)' }}>Ce que le premier tour cachait.</strong> En vérifiant <code>Tag.color</code> avant
          de dessiner le mix : <strong style={{ color: 'var(--node-title)' }}>les 126 concepts de la base sont tous au même bleu</strong>,
          le défaut du schéma — rien dans l&apos;app n&apos;écrit jamais cette colonne, il n&apos;existe aucun endroit pour choisir la
          couleur d&apos;un concept. La variante C ne tenait donc qu&apos;à une tricherie de ma démo, où j&apos;avais peint les deux
          concepts à la main. Telle quelle, elle rendrait 126 traits bleus, c&apos;est-à-dire le témoin. F est ce que C voulait
          dire, rendu possible : la couleur se <em>calcule</em> depuis le nom du concept, donc elle est stable partout et ne coûte
          ni sélecteur, ni migration, ni 126 concepts à peindre à la main.
        </div>

        <div style={{
          fontSize: 12, color: 'var(--node-meta)', lineHeight: 1.65, marginBottom: 14, maxWidth: 790,
          padding: '12px 14px', borderRadius: 10, background: 'var(--node-bg)', border: '1px solid var(--node-border)',
        }}>
          <strong style={{ color: 'var(--node-title)' }}>Les trois types, rappel.</strong> Déduits de ce que le trait relie
          (<code>scripts/inventaire-traits-0.1.7.mjs</code>) : ni migration, ni sélecteur, rien à demander à l&apos;élève.
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
          <strong style={{ color: 'var(--node-title)' }}>Le test qui élimine.</strong> Les deux traits d&apos;appartenance du graphe
          sont le même lien tracé <strong>dans les deux sens</strong> (<code>note → #FVG</code> et <code>#Discipline → note</code>) :
          en base il y en a 3 dans un sens et 1 dans l&apos;autre, selon par où le crayon est parti. Ils doivent se rendre
          identiques. Et le cercle animé au survol d&apos;une carte est celui de la production : la grammaire doit rester lisible
          pendant qu&apos;il passe.
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
                {g.statut && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 100, whiteSpace: 'nowrap',
                    border: `1px solid ${g.statut.ton === 'mix' ? '#10b981' : AMBRE}`,
                    color: g.statut.ton === 'mix' ? '#10b981' : AMBRE,
                  }}>{g.statut.texte}</span>
                )}
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
