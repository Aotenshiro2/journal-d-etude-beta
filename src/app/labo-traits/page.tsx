'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   PAGE JETABLE — 0.1.7, choix du rendu des traits entre notes.
   Vrai React Flow (pas une maquette) : une animation ne se juge qu'en marche.

   Source : le composant Edge d'AI SDK Elements
   (https://elements.ai-sdk.dev/components/edge) — deux variantes, « Animated »
   (trait plein + cercle qui parcourt le tracé, 2 s, en boucle) et « Temporary »
   (pointillé pour une connexion en cours). Les deux en courbe de Bézier, là où
   nos traits sont aujourd'hui en `smoothstep` (coudes à angle droit).

   Route publique déclarée dans `middleware.ts` (publicPaths).
   À SUPPRIMER une fois tranché :
     rm -rf src/app/labo-traits .next/types/app/labo-traits
     puis retirer '/labo-traits' de publicPaths dans middleware.ts
   ───────────────────────────────────────────────────────────────────────────── */

import { useCallback, useMemo, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, BaseEdge, getBezierPath, getSmoothStepPath,
  Handle, Position, type EdgeProps, type Node, type Edge, type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTheme } from '@/contexts/ThemeContext'

const BLEU = '#3b82f6'

/* ── Nœuds de démonstration ──────────────────────────────────────────────── */

function NoteDemo({ data }: NodeProps) {
  const d = data as { titre: string; apercu: string }
  return (
    <div className="note-map-card" style={{ width: 190, height: 106 }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 8, height: 8, border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 8, height: 8, border: 'none' }} />
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
  const d = data as { label: string }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 100,
      background: `${BLEU}1f`, border: `1.5px solid ${BLEU}`, boxShadow: 'var(--node-shadow)',
    }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 8, height: 8, border: 'none' }} />
      <span style={{ fontSize: 12.5, fontWeight: 700, color: BLEU }}>#</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--node-title)', whiteSpace: 'nowrap' }}>{d.label}</span>
    </div>
  )
}

const nodeTypes = { note: NoteDemo, concept: ConceptDemo }

/* ── Les traits ───────────────────────────────────────────────────────────── */

// Le trait d'aujourd'hui : smoothstep, coudes à angle droit.
function TraitActuel({ id, ...p }: EdgeProps) {
  const [d] = getSmoothStepPath(p as Parameters<typeof getSmoothStepPath>[0])
  return <BaseEdge id={id} path={d} style={{ stroke: BLEU, strokeWidth: 1.5, opacity: 0.5 }} />
}

// Bézier calme : la courbe, sans rien qui bouge.
function TraitCalme({ id, ...p }: EdgeProps) {
  const [d] = getBezierPath(p as Parameters<typeof getBezierPath>[0])
  return <BaseEdge id={id} path={d} style={{ stroke: BLEU, strokeWidth: 1.5, opacity: 0.5 }} />
}

// Bézier animé : le cercle parcourt le tracé, 2 s, en boucle (source AI SDK Elements).
function TraitAnime({ id, ...p }: EdgeProps) {
  const [d] = getBezierPath(p as Parameters<typeof getBezierPath>[0])
  return (
    <>
      <BaseEdge id={id} path={d} style={{ stroke: BLEU, strokeWidth: 1.5, opacity: 0.5 }} />
      <circle r={3.5} fill={BLEU}>
        <animateMotion dur="2s" repeatCount="indefinite" path={d} />
      </circle>
    </>
  )
}

// Bézier pointillé animé : la connexion en cours de tracé (leur « Temporary »).
function TraitEnCours({ id, ...p }: EdgeProps) {
  const [d] = getBezierPath(p as Parameters<typeof getBezierPath>[0])
  return (
    <BaseEdge id={id} path={d} style={{ stroke: BLEU, strokeWidth: 1.5, strokeDasharray: '6 5', opacity: 0.9 }}>
      <animate attributeName="stroke-dashoffset" from="22" to="0" dur="0.9s" repeatCount="indefinite" />
    </BaseEdge>
  )
}

const edgeTypes = { actuel: TraitActuel, calme: TraitCalme, anime: TraitAnime, encours: TraitEnCours }

/* ── Le graphe de démonstration ──────────────────────────────────────────── */

const NODES: Node[] = [
  { id: 'n1', type: 'note', position: { x: 20, y: 30 }, data: { titre: 'Les macros', apercu: 'NQ1! 30 347,75 ▼ −0.58% Cours élève · Exercice 1 : Observation' } },
  { id: 'n2', type: 'note', position: { x: 300, y: 150 }, data: { titre: 'Session 17 Mars', apercu: 'TopStepX MNQM26 -0.41% RP&L: $52.40 · BAL: $49,408.80 · MLL: $48,000.00' } },
  { id: 'n3', type: 'note', position: { x: 20, y: 250 }, data: { titre: 'NQ1! 1M @ 24 485,75', apercu: 'TF: 1M · Prix: 24 485,75 · Var: +1.12% · Exchange: NASDAQ' } },
  { id: 'n4', type: 'note', position: { x: 580, y: 40 }, data: { titre: 'Je suis enragé d\'avoir raté le trade', apercu: '08/07/2026 10:34:25 · SimpleFX Webtrader' } },
  { id: 'c1', type: 'concept', position: { x: 610, y: 290 }, data: { label: 'FVG' } },
]

// `nature` dit à quoi sert le trait — c'est ce qui permet aux variantes 4 et 5
// de n'animer qu'une partie du graphe au lieu de tout faire clignoter.
const LIENS: (Edge & { nature: 'note' | 'concept' | 'encours' })[] = [
  { id: 'e1', source: 'n1', target: 'n2', nature: 'note' },
  { id: 'e2', source: 'n2', target: 'c1', nature: 'concept' },
  { id: 'e3', source: 'n3', target: 'c1', nature: 'concept' },
  { id: 'e4', source: 'n1', target: 'n4', nature: 'encours' },
]

type Choix = (l: (typeof LIENS)[number], survole: string | null) => string

const VARIANTES: { n: number; titre: string; note: string; src: string; choix: Choix }[] = [
  { n: 0, titre: 'Témoin', note: 'ce que tu as aujourd\'hui : smoothstep, coudes à angle droit', src: 'existant', choix: () => 'actuel' },
  { n: 1, titre: 'Bézier calme', note: 'la courbe remplace les coudes, rien ne bouge', src: 'AI SDK Elements', choix: () => 'calme' },
  { n: 2, titre: 'Animé partout', note: 'le cercle sur tous les traits, en permanence', src: 'AI SDK Elements', choix: () => 'anime' },
  { n: 3, titre: 'Animé au survol', note: 'survole une carte : seuls ses traits s\'animent', src: 'AI SDK Elements + maison', choix: (l, s) => (s && (l.source === s || l.target === s) ? 'anime' : 'calme') },
  { n: 4, titre: 'Animé vers les concepts', note: 'seuls les liens vers un concept vivent, le note à note reste calme', src: 'AI SDK Elements + maison', choix: l => (l.nature === 'concept' ? 'anime' : 'calme') },
  { n: 5, titre: 'Animé en cours de tracé', note: 'pointillé qui file sur le lien qu\'on est en train de poser, reste statique', src: 'AI SDK Elements', choix: l => (l.nature === 'encours' ? 'encours' : 'calme') },
]

function Demo({ choix }: { choix: Choix }) {
  const [survole, setSurvole] = useState<string | null>(null)
  const edges = useMemo(
    () => LIENS.map(l => ({ ...l, type: choix(l, survole) })),
    [choix, survole]
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
      fitViewOptions={{ padding: 0.12 }}
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

export default function LaboTraits() {
  const { theme, toggleTheme } = useTheme()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--canvas-bg)', padding: '28px 32px 80px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 6 }}>
          <h1 style={{ fontSize: 22, color: 'var(--node-title)' }}>Rendre les traits vivants, mais jusqu&apos;où</h1>
          <button onClick={toggleTheme} className="canvas-float-pill" style={{ padding: '8px 14px', fontSize: 13, color: 'var(--node-title)', cursor: 'pointer', flexShrink: 0 }}>
            {theme === 'dark' ? '☀ Voir en clair' : '☾ Voir en sombre'}
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--node-meta)', marginBottom: 14, maxWidth: 780, lineHeight: 1.6 }}>
          Vrai React Flow, vraies courbes, animations réellement en marche. <strong style={{ color: 'var(--node-title)' }}>Survole
          les cartes</strong>, la 3 ne réagit que comme ça. La vraie question n&apos;est pas « animé ou pas » mais <em>quand</em> :
          leur démo tourne à six nœuds, ton canvas en a 95.
        </p>
        <div style={{
          fontSize: 12, color: 'var(--node-meta)', lineHeight: 1.65, marginBottom: 30, maxWidth: 780,
          padding: '12px 14px', borderRadius: 10, background: 'var(--node-bg)', border: '1px solid var(--node-border)',
        }}>
          <strong style={{ color: 'var(--node-title)' }}>Ce qui est sourcé ici, pour une fois.</strong> Le cercle qui parcourt le
          tracé (2 s, en boucle), le pointillé du lien en cours, et surtout le passage en <strong>courbe de Bézier</strong> viennent
          du composant <a href="https://elements.ai-sdk.dev/components/edge" target="_blank" rel="noreferrer" style={{ color: BLEU }}>Edge
          d&apos;AI SDK Elements</a>. Ce qui est de moi, c&apos;est uniquement le <em>déclenchement</em> : au survol (3) et sur les
          seuls liens de concept (4). Le témoin 0 est ton rendu actuel, gardé pour comparaison.
        </div>

        <div style={{ display: 'grid', gap: 34 }}>
          {VARIANTES.map(v => (
            <div key={v.n}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 12, fontWeight: 700, width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)',
                }}>{v.n}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--node-title)' }}>{v.titre}</span>
                <span style={{ fontSize: 12, color: 'var(--node-meta)' }}>{v.note}</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 100,
                  border: `1px solid ${v.src === 'existant' ? 'var(--node-meta)' : '#818cf8'}`,
                  color: v.src === 'existant' ? 'var(--node-meta)' : '#818cf8', opacity: 0.85,
                }}>{v.src}</span>
              </div>
              <div style={{ position: 'relative', height: 360, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--node-border)' }}>
                <div className="canvas-grid" />
                <ReactFlowProvider><Demo choix={v.choix} /></ReactFlowProvider>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
