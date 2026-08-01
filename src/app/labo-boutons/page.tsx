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
import { ButtonGroup } from '@/components/ui/button-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const VERT = { border: '#34d399', bg: 'rgba(52,211,153,0.07)', ink: '#06281e' }
const TEINTES = ['#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#f472b6']

/* ── Les cinq habillages du cluster d'actions ────────────────────────────── */

// « Mapper » reste l'action principale, mais les trois ne forment qu'UNE barre.
// Avant, un séparateur détachait Mapper et les deux icônes étaient en `ghost`,
// donc sans contour : trois éléments, trois traitements, aucune cohérence. Ici
// les trois partagent la même forme et le même contour ; seul le remplissage de
// Mapper porte la hiérarchie.
function ClusterButtonGroup() {
  return (
    <ButtonGroup className="scale-90 origin-right">
      <Button size="xs" variant="default">
        <Maximize2 /> Mapper
      </Button>
      <Button size="icon-xs" variant="outline" title="Promouvoir en concept"><Hash /></Button>
      <Button size="icon-xs" variant="outline" title="Dissoudre le groupe"><X /></Button>
    </ButtonGroup>
  )
}

// Les trois PLEINS, dans le blanc/gris de la variante `default` de ShadCN —
// celui du « Mapper » de la 1. Aucune hiérarchie, mais le cluster existe
// franchement au lieu de s'effacer. À savoir : cette variante s'inverse d'un
// thème à l'autre (blanc sur sombre, presque noir sur clair), c'est le
// comportement normal de `primary` chez ShadCN. À regarder dans les deux.
function ClusterPlein() {
  return (
    <ButtonGroup className="scale-90 origin-right">
      <Button size="xs" variant="default"><Maximize2 /> Mapper</Button>
      <Button size="icon-xs" variant="default" title="Promouvoir en concept"><Hash /></Button>
      <Button size="icon-xs" variant="default" title="Dissoudre le groupe"><X /></Button>
    </ButtonGroup>
  )
}

/* Les trois pleins, mais avec un remplissage CALIBRÉ par thème au lieu de
   l'inversion mécanique de `primary`. Même intention des deux côtés — une
   surface solide qui se détache — sans le presque-noir écrasant sur le canvas
   clair. Les valeurs vivent dans globals.css (`--action-plein-*`,
   `--action-doux-*`), donc réutilisables si Brice retient ce parti. */
function ClusterRempli({ bg, fg }: { bg: string; fg: string }) {
  const style = { background: bg, color: fg, borderColor: 'transparent' }
  return (
    <ButtonGroup className="scale-90 origin-right">
      <Button size="xs" variant="default" style={style}><Maximize2 /> Mapper</Button>
      <Button size="icon-xs" variant="default" style={style} title="Promouvoir en concept"><Hash /></Button>
      <Button size="icon-xs" variant="default" style={style} title="Dissoudre le groupe"><X /></Button>
    </ButtonGroup>
  )
}

// Même groupe, tout en outline : plus sobre, aucune hiérarchie.
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

/* SECOND TOUR. Brice hésitait entre l'ancienne 4 et l'ancienne 5. Elles
   différaient sur DEUX axes indépendants, d'où l'hésitation : ce n'était pas un
   choix mais deux. On les croise.
     · `flottant` — les actions vivent sous le groupe, ou dans l'en-tête
     · `plein`    — « Mapper » est promu action principale, ou tout au même niveau
   Les couleurs sont en ToggleGroup partout : ses deux finalistes l'avaient. */
type Variante = 1 | 2 | 3 | 4 | 5 | 6 | 7

function GroupeDemo({ data }: NodeProps) {
  const v = (data as { variante: Variante }).variante
  const flottant = v !== 3 && v !== 4
  const cluster =
    v === 1 || v === 3 ? <ClusterButtonGroup />
    : v === 5 ? <ClusterPlein />
    : v === 6 ? <ClusterRempli bg="var(--action-plein-bg)" fg="var(--action-plein-fg)" />
    : v === 7 ? <ClusterRempli bg="var(--action-doux-bg)" fg="var(--action-doux-fg)" />
    : <ClusterOutline />

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
            <CouleursToggle />
            {cluster}
          </div>
        </NodeToolbar>
      )}

      <div className="flex items-start gap-1.5 pr-2">
        {onglet}
        <span className="flex-1" />
        {!flottant && (
          <span className="flex items-center gap-1 mt-1">
            <CouleursToggle />
            {cluster}
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
    { id: 'g', type: 'groupe', position: { x: 40, y: 30 }, data: { variante }, style: { width: 480, height: 190, zIndex: -1 }, selected: true },
    { id: 'c1', type: 'carte', position: { x: 76, y: 70 }, data: { titre: 'Les macros' } },
    { id: 'c2', type: 'carte', position: { x: 306, y: 112 }, data: { titre: 'Session 17 Mars' } },
  ]
  return (
    <ReactFlow
      nodes={nodes}
      edges={[]}
      nodeTypes={nodeTypes}
      fitView
      // `maxZoom: 1` est indispensable : sans lui fitView agrandit la scène pour
      // remplir la tuile, et le toolbar flottant — qui vit SOUS le groupe et
      // n'entre pas dans le cadrage — se retrouve pousse hors du champ.
      fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
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
  { n: 1, titre: 'Flottant · Mapper promu', note: 'l\'ancienne 4, telle quelle', src: 'ShadCN + AI SDK' },
  { n: 2, titre: 'Flottant · tout au même niveau', note: 'la place de la 4, la sobriété de la 5', src: 'ShadCN + AI SDK' },
  { n: 3, titre: 'En-tête · Mapper promu', note: 'la place de la 5, la hiérarchie de la 4', src: 'ShadCN' },
  { n: 4, titre: 'En-tête · tout au même niveau', note: 'l\'ancienne 5, telle quelle', src: 'ShadCN' },
  { n: 5, titre: 'Flottant · les trois pleins', note: 'validée en sombre, trop lourde en clair', src: 'ShadCN' },
  { n: 6, titre: 'Flottant · plein calibré', note: 'le blanc de la 5 en sombre, de l\'ardoise en clair au lieu du noir', src: 'ShadCN + maison' },
  { n: 7, titre: 'Flottant · plein doux', note: 'même idée, un cran plus discret dans les deux thèmes', src: 'ShadCN + maison' },
]

export default function LaboBoutons() {
  const { theme, toggleTheme } = useTheme()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--canvas-bg)', padding: '28px 32px 80px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 6 }}>
          <h1 style={{ fontSize: 22, color: 'var(--node-title)' }}>Second tour : où vivent les actions, et laquelle domine</h1>
          <button onClick={toggleTheme} className="canvas-float-pill" style={{ padding: '8px 14px', fontSize: 13, color: 'var(--node-title)', cursor: 'pointer', flexShrink: 0 }}>
            {theme === 'dark' ? '☀ Voir en clair' : '☾ Voir en sombre'}
          </button>
        </div>

        <div style={{
          fontSize: 12.5, color: 'var(--node-meta)', lineHeight: 1.65, margin: '14px 0 30px', maxWidth: 780,
          padding: '12px 14px', borderRadius: 10, background: 'var(--node-bg)', border: '1px solid var(--node-border)',
        }}>
          <strong style={{ color: 'var(--node-title)' }}>Second tour : deux axes, pas un.</strong> Tes deux finalistes
          différaient sur <em>deux</em> choses à la fois, d&apos;où l&apos;hésitation. <strong>Où vivent les actions</strong> :
          flottantes sous le groupe (1 et 2) ou dans l&apos;en-tête (3 et 4). Et <strong>la hiérarchie</strong> : « Mapper » promu
          en bouton plein (1 et 3) ou tout au même niveau (2 et 4). Rien n&apos;oblige à les prendre ensemble : les 2 et 3 sont les
          croisements que tu n&apos;avais pas vus. Les couleurs sont en <code>ToggleGroup</code> partout, tes deux finalistes
          l&apos;avaient. Tout vient de tes bases : <code>ButtonGroup</code> et <code>ToggleGroup</code> de ShadCN, et le parti
          « barre rattachée au nœud » d&apos;AI SDK Elements.
          <br /><br />
          <strong style={{ color: 'var(--node-title)' }}>Ce que la page ne montre pas.</strong> Dans la vraie app ce cluster
          n&apos;apparaît qu&apos;au survol au bureau, et à la sélection au téléphone. Le flottant gère ça nativement et offre des
          cibles bien plus grandes au doigt ; l&apos;en-tête reste serré entre l&apos;onglet et les pastilles. Si tu hésites encore
          après avoir regardé, c&apos;est l&apos;argument qui départage.
          <br /><br />
          <strong style={{ color: 'var(--node-title)' }}>Le remplissage, en 5, 6 et 7.</strong> La 5 utilise la variante
          <code> primary</code> de ShadCN telle quelle : elle s&apos;<em>inverse</em> mécaniquement, d&apos;où le presque-noir
          écrasant sur le canvas clair. Les 6 et 7 ne copient pas la formule mais l&apos;intention — une surface solide qui se
          détache — en calibrant chaque thème séparément. La 6 garde exactement le blanc que tu as validé en sombre et passe à
          de l&apos;ardoise en clair ; la 7 fait pareil un cran plus bas. <strong>Regarde-les dans les deux thèmes</strong> :
          c&apos;est tout l&apos;intérêt.
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
              <div style={{ position: 'relative', height: 420, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--node-border)' }}>
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
