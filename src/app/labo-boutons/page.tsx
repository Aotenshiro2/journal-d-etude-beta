'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   PAGE JETABLE — 0.1.7, habillage des actions d'un groupe.

   Brice : « ils font terne et oubliable, comme s'ils n'avaient pas été
   travaillé ». Diagnostic : ce n'est pas un problème de contraste, c'est que
   ces boutons n'ont jamais été dessinés, et surtout qu'ils n'ont pas de place à
   eux — ils sont entassés dans la barre de titre avec l'onglet et les pastilles.

   Vrai React Flow : le toolbar flottant est un `NodeToolbar`, il ne peut pas
   être simulé en HTML statique.

   Sourcé : `ButtonGroup` + `ButtonGroupSeparator` et `ToggleGroup` de ShadCN
   (installés pour l'occasion, ils manquaient), et le parti « toolbar rattaché au
   nœud » d'AI SDK Elements (elements.ai-sdk.dev/components/toolbar).

   À SUPPRIMER une fois tranché :
     rm -rf src/app/labo-boutons .next/types/app/labo-boutons
     puis retirer '/labo-boutons' de publicPaths dans middleware.ts
   ───────────────────────────────────────────────────────────────────────────── */

import { ReactFlow, ReactFlowProvider, NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Maximize2, Hash, X } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const VERT = { border: '#34d399', bg: 'rgba(52,211,153,0.07)', ink: '#06281e' }
const TEINTES = ['#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#f472b6']

/* ── Les cinq habillages du cluster d'actions ────────────────────────────── */

// 1 — Témoin : exactement ce qu'il y a en prod aujourd'hui.
function ClusterTemoin() {
  return (
    <span className="flex items-center gap-1">
      {TEINTES.map(c => (
        <button key={c} className="w-2.5 h-2.5 rounded-full border border-black/20 dark:border-white/30"
          style={{ background: c, opacity: c === VERT.border ? 1 : 0.45 }} />
      ))}
      <button className="ml-1 px-1.5 rounded text-[10px] font-semibold hover:bg-black/5 dark:hover:bg-white/5"
        style={{ color: VERT.border }}>⤢ Mapper</button>
      <button className="ml-1 px-1 rounded text-[10px] font-semibold hover:bg-black/5 dark:hover:bg-white/5"
        style={{ color: VERT.border }}>#</button>
      <button className="px-1 rounded text-[10px] hover:text-red-400 hover:bg-black/5 dark:hover:bg-white/5"
        style={{ color: 'var(--node-meta)' }}>✕</button>
    </span>
  )
}

// 2 — ButtonGroup ShadCN, dans l'en-tête. « Mapper » devient l'action
// principale (bouton plein), les deux autres restent des icônes discrètes.
function ClusterButtonGroup() {
  return (
    <ButtonGroup className="scale-90 origin-right">
      <Button size="xs" variant="default">
        <Maximize2 /> Mapper
      </Button>
      <ButtonGroupSeparator />
      <Button size="icon-xs" variant="ghost" title="Promouvoir en concept"><Hash /></Button>
      <Button size="icon-xs" variant="ghost" title="Dissoudre le groupe"><X /></Button>
    </ButtonGroup>
  )
}

// 5 — Même ButtonGroup, mais tout en outline : plus sobre, aucune hiérarchie.
function ClusterOutline() {
  return (
    <ButtonGroup className="scale-90 origin-right">
      <Button size="xs" variant="outline"><Maximize2 /> Mapper</Button>
      <Button size="icon-xs" variant="outline" title="Promouvoir en concept"><Hash /></Button>
      <Button size="icon-xs" variant="outline" title="Dissoudre le groupe"><X /></Button>
    </ButtonGroup>
  )
}

// Les couleurs traitées comme un ÉTAT (ToggleGroup) et non comme des actions.
// C'est la distinction que fait la doc ShadCN, et notre erreur de catégorie.
function CouleursToggle() {
  return (
    <ToggleGroup defaultValue={[VERT.border]} size="sm" variant="outline" spacing={0}>
      {TEINTES.map(c => (
        <ToggleGroupItem key={c} value={c} aria-label={`Couleur ${c}`} className="px-1.5">
          <span className="size-3 rounded-full block" style={{ background: c }} />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/* ── Le nœud de groupe, décliné par variante ─────────────────────────────── */

type Variante = 1 | 2 | 3 | 4 | 5

function GroupeDemo({ data }: NodeProps) {
  const v = (data as { variante: Variante }).variante
  const flottant = v === 3 || v === 4

  const onglet = (
    <span style={{
      display: 'inline-block', marginLeft: 16, marginTop: -2, padding: '4px 12px 5px',
      borderRadius: '0 0 9px 9px', background: VERT.border, color: VERT.ink,
      fontSize: 11, fontWeight: 600, lineHeight: 1.35,
    }}>cours</span>
  )

  return (
    <div className="w-full h-full" style={{
      borderRadius: '2px 2px 16px 16px', borderTop: `2px solid ${VERT.border}`, background: VERT.bg,
    }}>
      {/* 3 et 4 : les actions SORTENT de l'en-tête, dans une barre rattachée au
          nœud (parti AI SDK Elements). L'en-tête ne porte plus que le nom. */}
      {flottant && (
        <NodeToolbar isVisible position={Position.Bottom} offset={12}>
          <div className="canvas-float-pill flex items-center gap-1.5" style={{ padding: '6px 8px' }}>
            {v === 4 ? <CouleursToggle /> : (
              <span className="flex items-center gap-1 mr-1">
                {TEINTES.map(c => (
                  <button key={c} className="w-3 h-3 rounded-full border border-black/20 dark:border-white/30"
                    style={{ background: c, opacity: c === VERT.border ? 1 : 0.45 }} />
                ))}
              </span>
            )}
            <ClusterButtonGroup />
          </div>
        </NodeToolbar>
      )}

      <div className="flex items-start gap-1.5 pr-2">
        {onglet}
        <span className="flex-1" />
        {!flottant && (
          <span className="flex items-center gap-1 mt-1">
            {v === 1 && <ClusterTemoin />}
            {v === 2 && <><CouleursToggle /><ClusterButtonGroup /></>}
            {v === 5 && <><CouleursToggle /><ClusterOutline /></>}
          </span>
        )}
      </div>
    </div>
  )
}

function CarteDemo({ data }: NodeProps) {
  const d = data as { titre: string }
  return (
    <div className="note-map-card" style={{ width: 200, height: 96 }}>
      <div style={{ display: 'flex', gap: 7, padding: '11px 12px 6px' }}>
        <div style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--node-border)', flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--node-title)', lineHeight: 1.3 }}>{d.titre}</span>
      </div>
      <p style={{ padding: '0 12px', fontSize: 10, color: 'var(--node-preview)', lineHeight: 1.5 }}>
        TopStepX MNQM26 −0.41% RP&amp;L: $52.40
      </p>
    </div>
  )
}

const nodeTypes = { groupe: GroupeDemo, carte: CarteDemo }

function Scene({ variante }: { variante: Variante }) {
  const nodes: Node[] = [
    { id: 'g', type: 'groupe', position: { x: 40, y: 30 }, data: { variante }, style: { width: 520, height: 250, zIndex: -1 }, selected: true },
    { id: 'c1', type: 'carte', position: { x: 80, y: 90 }, data: { titre: 'Les macros' } },
    { id: 'c2', type: 'carte', position: { x: 330, y: 150 }, data: { titre: 'Session 17 Mars' } },
  ]
  return (
    <ReactFlow
      nodes={nodes}
      edges={[]}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      nodesDraggable={false}
      panOnDrag={false}
      zoomOnScroll={false}
      zoomOnDoubleClick={false}
      preventScrolling={false}
      proOptions={{ hideAttribution: true }}
    />
  )
}

const OPTIONS: { n: Variante; titre: string; note: string; src: string }[] = [
  { n: 1, titre: 'Témoin', note: 'ce que tu as en prod aujourd\'hui', src: 'existant' },
  { n: 2, titre: 'ButtonGroup dans l\'en-tête', note: '« Mapper » devient l\'action principale, le reste en icônes', src: 'ShadCN' },
  { n: 3, titre: 'Toolbar flottant', note: 'les actions sortent de l\'en-tête et se posent sous le groupe', src: 'AI SDK Elements' },
  { n: 4, titre: 'Toolbar flottant + ToggleGroup', note: 'idem, et les couleurs deviennent un état, pas des actions', src: 'ShadCN + AI SDK' },
  { n: 5, titre: 'Tout en outline', note: 'même groupe, aucune hiérarchie : plus sobre, plus plat', src: 'ShadCN' },
]

export default function LaboBoutons() {
  const { theme, toggleTheme } = useTheme()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--canvas-bg)', padding: '28px 32px 80px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 6 }}>
          <h1 style={{ fontSize: 22, color: 'var(--node-title)' }}>Donner une place aux actions d&apos;un groupe</h1>
          <button onClick={toggleTheme} className="canvas-float-pill" style={{ padding: '8px 14px', fontSize: 13, color: 'var(--node-title)', cursor: 'pointer', flexShrink: 0 }}>
            {theme === 'dark' ? '☀ Voir en clair' : '☾ Voir en sombre'}
          </button>
        </div>

        <div style={{
          fontSize: 12.5, color: 'var(--node-meta)', lineHeight: 1.65, margin: '14px 0 30px', maxWidth: 780,
          padding: '12px 14px', borderRadius: 10, background: 'var(--node-bg)', border: '1px solid var(--node-border)',
        }}>
          <strong style={{ color: 'var(--node-title)' }}>Le vrai problème n&apos;est pas le contraste.</strong> Ces boutons sont
          entassés dans la barre de titre, où ils se battent pour la place avec l&apos;onglet et les cinq pastilles. Aucun n&apos;a
          de place à lui, d&apos;où le côté « pas travaillé ». Les options 3 et 4 les <em>sortent</em> de l&apos;en-tête ; les
          options 2 et 5 les habillent sur place. Tout ce qui suit vient de tes bases, rien n&apos;est dessiné à la main :
          <code> ButtonGroup</code> et <code>ToggleGroup</code> de ShadCN (que j&apos;ai installés, ils manquaient) et le parti
          « barre rattachée au nœud » d&apos;AI SDK Elements. À noter : « ⤢ Mapper » est le seul bouton qui <strong>ouvre un autre
          écran</strong>, il est traité comme l&apos;action principale partout sauf dans le témoin et la 5.
        </div>

        <div style={{ display: 'grid', gap: 34 }}>
          {OPTIONS.map(o => (
            <div key={o.n}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 12, fontWeight: 700, width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)',
                }}>{o.n}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--node-title)' }}>{o.titre}</span>
                <span style={{ fontSize: 12, color: 'var(--node-meta)' }}>{o.note}</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 100,
                  border: `1px solid ${o.src === 'existant' ? 'var(--node-meta)' : '#818cf8'}`,
                  color: o.src === 'existant' ? 'var(--node-meta)' : '#818cf8', opacity: 0.85,
                }}>{o.src}</span>
              </div>
              <div style={{ position: 'relative', height: 330, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--node-border)' }}>
                <div className="canvas-grid" />
                <ReactFlowProvider><Scene variante={o.n} /></ReactFlowProvider>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
