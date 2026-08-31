'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Node,
  Edge,
  Connection,
  addEdge,
  useNodesState,
  useEdgesState,
  NodeProps,
  NodeResizer,
  NodeToolbar,
  Position,
  Panel,
  useReactFlow,
  useViewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { FolderPlus, Type, Combine, Pencil, Hash, Maximize2, X, Check } from 'lucide-react'
import { MessageData, CanvasNodeData, CanvasEdgeData } from '@/types'
import { htmlToText, truncateText, parseBlockContent } from '@/lib/utils'
import ImageLightbox from './ImageLightbox'
import { canvasEdgeTypes, avecSurvol } from './CanvasEdge'
import { PoigneesCardinales } from './canvas/poignees'
import { poigneesEntre } from './canvas/lienProche'
import { ASSISTANCE_CONNEXION, connexionValide, lienDejaPresent } from './canvas/lienValide'
import { CanvasToolbar, type ActionBarre } from './canvas/CanvasToolbar'
import { ConceptNode } from './canvas/ConceptNode'
import { ConceptPicker } from './canvas/ConceptPicker'
import { Button } from './ui/button'
import { ButtonGroup } from './ui/button-group'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { useIsMobile } from '@/hooks/useIsMobile'

// `connect` = le crayon. Il manquait ici alors qu'il existe sur la carte
// d'accueil : relier deux blocs demandait de tirer une poignée de 9 px, ce que
// le doigt ne sait pas faire. Le geste est le même des deux côtés : tap → tap.
type CanvasTool = 'select' | 'pan' | 'connect'

interface StudyCanvasProps {
  canvasId: string
  nodes: CanvasNodeData[]
  edges: CanvasEdgeData[]
  messages: MessageData[]
  onDropMessage: (messageId: string, x: number, y: number) => void
  onMoveNode: (nodeId: string, x: number, y: number) => void
  onRemoveNode: (nodeId: string) => void
  /** Rend `false` si le serveur a refusé : le canvas retire alors le trait
   *  affiché en optimiste. Tout autre retour est traité comme un succès. */
  onConnect: (fromId: string, toId: string, fromHandle?: string, toHandle?: string) => void | Promise<boolean>|Promise<void>
  onDeleteEdge: (edgeId: string) => void
  /** Changer le côté d'accroche d'un trait, sans toucher à ses extrémités. */
  onReconnectEdge?: (edgeId: string, fromHandle: string | null, toHandle: string | null) => void
  /** Poser un nœud-concept. Passe par le layout : ce canvas resynchronise ses
   *  nœuds depuis ses props, un ajout purement local serait effacé au prochain
   *  recalcul. */
  onCreateConcept?: (c: { tagId: string; label: string; color: string; x: number; y: number }) => Promise<CanvasNodeData | null>
  onCreateGroup: (group: { label: string; color: string; x: number; y: number; width?: number; height?: number }) => Promise<CanvasNodeData | null>
  onCreateText: (pos: { x: number; y: number }) => Promise<CanvasNodeData | null>
  onUpdateNode: (nodeId: string, patch: Partial<Pick<CanvasNodeData, 'x' | 'y' | 'width' | 'height' | 'label' | 'color' | 'parentId' | 'orderInParent' | 'content'>>) => Promise<void> | void
  onPromoteGroupTag: (label: string, groupId: string) => Promise<boolean>
  tradeMeta?: Record<string, TradeMeta>
  /** Bloc armé dans le tiroir du bas : le prochain tap sur le canvas le pose. */
  armedMessageId?: string | null
  onArmedPlaced?: () => void
}

// Palette sobre des groupes — « ça va avec ça »
// `ink` (0.1.7) : encre sombre posée SUR l'onglet, qui est rempli de `border`.
// Les cinq teintes sont pastel, donc une encre sombre reste lisible sur le
// canvas clair comme sur le sombre — ce que le nom coloré sur fond translucide
// ne permettait pas (il tombait à ~2,3:1 de contraste en clair).
// `text` n'est utilisé nulle part, gardé pour ne rien casser en aval.
export const GROUP_COLORS: Record<string, { border: string; bg: string; text: string; ink: string }> = {
  blue: { border: '#60a5fa', bg: 'rgba(96,165,250,0.07)', text: '#93c5fd', ink: '#0a1f3d' },
  green: { border: '#34d399', bg: 'rgba(52,211,153,0.07)', text: '#6ee7b7', ink: '#06281e' },
  amber: { border: '#fbbf24', bg: 'rgba(251,191,36,0.07)', text: '#fcd34d', ink: '#3b2a02' },
  purple: { border: '#a78bfa', bg: 'rgba(167,139,250,0.07)', text: '#c4b5fd', ink: '#231045' },
  pink: { border: '#f472b6', bg: 'rgba(244,114,182,0.07)', text: '#f9a8d4', ink: '#3f0c25' },
}
const COLOR_KEYS = Object.keys(GROUP_COLORS)

// Métadonnées du trade rattaché à un bloc — pour signaler « ceci est un trade » partout
// (sur le canvas ET dans le panneau des blocs disponibles).
export type TradeMeta = { index: number; outcome: string | null; startedAt: number | null; grade: string | null }
export const OUTCOME_META: Record<string, { label: string; color: string }> = {
  gain: { label: 'Gain', color: '#22c55e' },
  perte: { label: 'Perte', color: '#ef4444' },
  be: { label: 'BE', color: 'var(--node-meta)' },
}
export function TradeBadge({ meta }: { meta: TradeMeta }) {
  const oc = meta.outcome ? OUTCOME_META[meta.outcome] : null
  const time = meta.startedAt ? new Date(meta.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null
  const full = [`Trade ${meta.index}`, time, oc?.label, meta.grade ? `Note ${meta.grade}` : null].filter(Boolean).join(' · ')
  return (
    <span
      title={full}
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: 'var(--node-bg)', border: `1px solid ${oc?.color ?? 'var(--node-border)'}`, color: oc?.color ?? 'var(--node-meta)' }}
    >
      ⌖ Trade {meta.index}{oc ? ` · ${oc.label}` : ''}{meta.grade ? ` · ${meta.grade}` : ''}
    </span>
  )
}

export interface GroupHandlers {
  rename: (id: string, label: string) => void
  recolor: (id: string, color: string) => void
  // groupId : la promotion tague aussi le CONTENU du groupe (0.1.3, « le nom sert »)
  promote: (label: string, groupId: string) => Promise<boolean>
  dissolve: (id: string) => void
  resize: (id: string, p: { width: number; height: number; x: number; y: number }) => void
  // 0.1.5 : ouvrir la collection (groupe de NOTES de l'accueil) dans un canvas
  // de mapping commun. Absent dans l'exploration (groupes de blocs) → pas de bouton.
  openCollection?: (groupId: string) => void
}

/* Remplissage des actions d'un nœud, calibré par thème dans globals.css.
   Surtout PAS la variante `primary` de ShadCN telle quelle : elle s'inverse
   mécaniquement, donc le blanc franc qui marche sur le canvas sombre devient un
   presque-noir écrasant sur le canvas clair (constat de Brice sur /labo-boutons). */
const ACTION_PLEIN: React.CSSProperties = {
  background: 'var(--action-plein-bg)',
  color: 'var(--action-plein-fg)',
  borderColor: 'transparent',
}

// `parseBlockContent` et `IMAGE_TYPES` sont remontés dans `@/lib/utils` au 0.2 :
// fonction pure dont la page concept a besoin pour sa galerie, et l'importer
// depuis ici aurait traîné React Flow dans une page qui ne l'affiche pas.
// Un bloc peut être : une image typée (URL nue ou <img>), du texte, OU du texte
// contenant une <img> inline (réalité des données synquées — base64 inclus).

function MessageNode({ data, selected }: NodeProps) {
  const d = data as {
    content: string
    type: string
    kind: string // 'message' | 'text'
    edited: boolean // une surcharge locale existe (copie de travail)
    autoEdit?: boolean
    onRemove: () => void
    onResizeEnd: (p: { width: number; height: number; x: number; y: number }) => void
    onSaveContent: (content: string) => void
    onResetContent: () => void
    onZoom: (src: string) => void
    trade?: TradeMeta
  }
  const isMobile = useIsMobile()
  const { imgSrc, text } = useMemo(() => parseBlockContent(d.content, d.type), [d.content, d.type])
  const isImageOnly = !!imgSrc && !text
  const [editing, setEditing] = useState(!!d.autoEdit)
  const [draft, setDraft] = useState(text)

  const startEdit = () => { setDraft(text); setEditing(true) }
  const save = () => {
    setEditing(false)
    const v = draft.trim()
    if (v === text) return
    // On préserve l'image du bloc ; le texte édité devient la copie de travail
    const html = (imgSrc ? `<img src="${imgSrc}"/>` : '') + v.split('\n').filter(Boolean).map(l => `<p>${l}</p>`).join('')
    d.onSaveContent(html)
  }

  return (
    <div
      onDoubleClick={(e) => { e.stopPropagation(); if (!editing) startEdit() }}
      className="relative rounded-xl w-full h-full text-xs group"
      style={isImageOnly && !editing
        ? { border: '1px solid var(--node-border)', overflow: 'hidden', background: 'transparent' }
        : { background: 'var(--node-bg)', border: `1px solid ${editing ? 'rgba(59,130,246,0.6)' : 'var(--node-border)'}`, boxShadow: 'var(--node-shadow)', color: 'var(--node-preview)', padding: imgSrc && !editing ? 8 : 10, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }
      }
    >
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={70}
        lineStyle={{ borderColor: 'rgba(59,130,246,0.6)' }}
        handleStyle={{ background: '#3b82f6', border: 'none', width: 8, height: 8, borderRadius: 2 }}
        onResizeEnd={(_, p) => d.onResizeEnd({ width: p.width, height: p.height, x: p.x, y: p.y })}
      />
      {/* Mindmap : connexions sur les 4 côtés, départ ET arrivée sur chacun.
          Ces poignées étaient de 6 px (taille par défaut de React Flow, aucune
          taille n'était posée) et VISIBLES en permanence, soit quatre points
          bleus sur chaque bloc. Elles suivent maintenant la même recette que les
          cartes de l'accueil : 9 px, révélées au survol. */}
      <PoigneesCardinales couleur="#3b82f6" />
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); setDraft(text); setEditing(false) }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save() }
          }}
          placeholder="Écris ta pensée…"
          className="nodrag nowheel w-full flex-1 bg-transparent resize-none outline-none leading-relaxed"
          style={{ color: 'var(--node-title)', minHeight: 40 }}
        />
      ) : imgSrc ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgSrc}
            alt=""
            className={isImageOnly ? 'w-full h-full object-contain' : 'w-full object-contain rounded-lg'}
            style={isImageOnly ? undefined : { flex: 1, minHeight: 0 }}
            draggable={false}
          />
          {text && (
            <p className="leading-snug overflow-hidden flex-shrink-0" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', whiteSpace: 'pre-line' }}>
              {truncateText(text, 90)}
            </p>
          )}
        </>
      ) : text ? (
        <p className="leading-relaxed overflow-hidden" style={{ display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical', whiteSpace: 'pre-line' }}>
          {truncateText(text, 220)}
        </p>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-sm" style={{ color: 'var(--node-meta)' }}>
          {d.kind === 'text' ? (isMobile ? 'Touche le crayon pour écrire' : 'Double-clic pour écrire') : '(bloc vide)'}
        </div>
      )}
      {/* Le double-clic ne parvient pas au doigt : au téléphone, l'édition du
          bloc a son propre bouton, comme le renommage des groupes. */}
      {isMobile && !editing && (
        <button
          onClick={(e) => { e.stopPropagation(); startEdit() }}
          aria-label="Modifier ce bloc"
          className="nodrag nopan absolute bottom-1.5 left-1.5 w-8 h-8 rounded-full flex items-center justify-center z-10"
          style={{ background: 'var(--canvas-bg)', border: '1px solid var(--node-border)', color: 'var(--node-meta)' }}
        >
          <Pencil size={13} />
        </button>
      )}
      {d.trade && !editing && (
        <div className="absolute bottom-1 left-1.5 z-10">
          <TradeBadge meta={d.trade} />
        </div>
      )}
      {d.edited && !editing && (
        <>
          <span
            className="absolute bottom-1 right-1.5 text-[9px] font-medium z-10"
            style={{ color: '#3b82f6', opacity: 0.75 }}
            title="Copie de travail — la note d'origine est intacte"
          >
            ✎
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); d.onResetContent() }}
            title="Rétablir l'original (annule l'édition/fusion de ce bloc)"
            className={`nodrag absolute top-1.5 rounded-full bg-blue-500/80 text-white transition-opacity flex items-center justify-center z-10 ${isMobile ? `right-11 w-8 h-8 text-sm ${selected ? 'opacity-100' : 'opacity-0 pointer-events-none'}` : 'right-8 w-5 h-5 text-[11px] opacity-0 group-hover:opacity-100'}`}
          >
            ↺
          </button>
        </>
      )}
      {imgSrc && !editing && (
        <button
          onClick={(e) => { e.stopPropagation(); d.onZoom(imgSrc) }}
          title="Agrandir l'image"
          className={`nodrag absolute top-1.5 left-1.5 rounded-full bg-black/55 text-white transition-opacity flex items-center justify-center z-10 ${isMobile ? `w-8 h-8 text-sm ${selected ? 'opacity-100' : 'opacity-0 pointer-events-none'}` : 'w-5 h-5 text-[11px] opacity-0 group-hover:opacity-100'}`}
        >
          ⤢
        </button>
      )}
      {/* Ces trois actions n'existaient qu'au survol : au doigt, inatteignables.
          Sur mobile elles apparaissent quand le bloc est SÉLECTIONNÉ — visibles
          en permanence, elles encombreraient chaque bloc du canvas. */}
      <button
        onClick={d.onRemove}
        title={d.kind === 'text' ? 'Supprimer ce bloc' : 'Retirer du canvas (le bloc revient dans la liste du bas)'}
        className={`nodrag absolute top-1.5 right-1.5 rounded-full bg-red-500/85 text-white transition-opacity flex items-center justify-center z-10 ${isMobile ? `w-8 h-8 text-sm ${selected ? 'opacity-100' : 'opacity-0 pointer-events-none'}` : 'w-5 h-5 text-xs opacity-0 group-hover:opacity-100'}`}
      >
        ✕
      </button>
    </div>
  )
}

// Zone englobante nommée — le geste « ça va avec ça »
export function GroupNode({ id, data, selected }: NodeProps) {
  const d = data as { label: string; color: string; tagId?: string | null; autoEdit?: boolean; handlers: React.MutableRefObject<GroupHandlers> }
  const isMobile = useIsMobile()
  const [editing, setEditing] = useState(!!d.autoEdit)
  const [draft, setDraft] = useState(d.label)
  // Un groupe déjà relié à un concept (tagId persisté) arrive « promu »
  const [promoted, setPromoted] = useState(!!d.tagId)
  const [survole, setSurvole] = useState(false)
  const isLive = promoted || !!d.tagId
  const palette = GROUP_COLORS[d.color] ?? GROUP_COLORS.blue

  const save = () => {
    const v = draft.trim()
    setEditing(false)
    if (v && v !== d.label) d.handlers.current.rename(id, v)
  }

  // 0.1.7 — « filet + onglet », variante choisie par Brice sur /labo-groupes.
  // Le groupe n'a plus de contour : un filet de 2 px en haut suffit à dire où il
  // commence, et son nom vit dans un onglet plein posé dessus, façon dossier
  // suspendu. Le pointillé d'avant lisait « zone provisoire » alors qu'un groupe
  // est l'objet le plus durable du canvas, et deux groupes voisins étaient
  // difficiles à séparer du regard.
  const onglet: React.CSSProperties = {
    display: 'inline-block', maxWidth: '60%', marginLeft: 16, marginTop: -2,
    padding: '4px 12px 5px', borderRadius: '0 0 9px 9px',
    background: palette.border, color: palette.ink,
    fontSize: 11, fontWeight: 600, lineHeight: 1.35,
  }

  // 0.1.7 — variante 6 de /labo-boutons. Les actions SORTENT de l'en-tête pour
  // vivre dans une barre rattachée au nœud (parti AI SDK Elements) : dans le
  // titre, elles se battaient pour la place avec l'onglet et les cinq pastilles,
  // et aucune n'avait de place à elle. Au doigt, la barre offre en plus des
  // cibles utilisables, ce que l'en-tête ne permettait pas.
  const outilsVisibles = (isMobile ? !!selected : survole || !!selected) && !editing

  return (
    <div
      className="w-full h-full group/gz"
      onMouseEnter={() => setSurvole(true)}
      onMouseLeave={() => setSurvole(false)}
      style={{
        borderRadius: '2px 2px 16px 16px',
        borderTop: `2px solid ${palette.border}`,
        background: palette.bg,
      }}
    >
      <NodeToolbar isVisible={outilsVisibles} position={Position.Bottom} offset={10}>
        <div className="canvas-float-pill nodrag nopan flex items-center gap-1.5" style={{ padding: '6px 8px' }}>
          {/* Les couleurs sont un ÉTAT (quelle teinte est active), pas cinq
              actions : d'où ToggleGroup et non cinq boutons, comme le distingue
              la doc ShadCN. */}
          <ToggleGroup
            value={[d.color]}
            onValueChange={(v: string[]) => { const k = v[0]; if (k && k !== d.color) d.handlers.current.recolor(id, k) }}
            size="sm"
            variant="outline"
            spacing={0}
          >
            {COLOR_KEYS.map(k => (
              <ToggleGroupItem key={k} value={k} aria-label={`Couleur ${k}`} className="px-1.5">
                <span className="size-3 rounded-full block" style={{ background: GROUP_COLORS[k].border }} />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {/* Les trois actions ne forment qu'UNE barre, remplissage calibré par
              thème (`--action-plein-*`) et non l'inversion de `primary`, qui
              donnait du presque-noir écrasant sur le canvas clair. */}
          <ButtonGroup>
            {d.handlers.current.openCollection && (
              <Button size="xs" variant="default" style={ACTION_PLEIN}
                onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
                onClick={() => d.handlers.current.openCollection!(id)}
                title="Mapper ensemble : ouvrir ces notes dans un canvas de travail commun">
                <Maximize2 /> Mapper
              </Button>
            )}
            <Button size="icon-xs" variant="default" style={ACTION_PLEIN}
              onClick={async () => { if (await d.handlers.current.promote(d.label, id)) setPromoted(true) }}
              title={promoted ? 'Concept créé, contenu du groupe tagué ✓' : 'Promouvoir en concept : crée le tag ET tague tout le contenu du groupe'}>
              {promoted ? <Check /> : <Hash />}
            </Button>
            <Button size="icon-xs" variant="default" style={ACTION_PLEIN}
              onClick={() => d.handlers.current.dissolve(id)}
              title="Dissoudre le groupe (les blocs restent sur le canvas)">
              <X />
            </Button>
          </ButtonGroup>
        </div>
      </NodeToolbar>

      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={150}
        lineStyle={{ borderColor: palette.border }}
        handleStyle={{ background: palette.border, border: 'none', width: 9, height: 9, borderRadius: 2 }}
        onResizeEnd={(_, p) => d.handlers.current.resize(id, { width: p.width, height: p.height, x: p.x, y: p.y })}
      />
      {/* 0.1.7 — un groupe n'avait AUCUNE poignée. Conséquence : relier un
          concept à un groupe créait bien la ligne en base, mais React Flow ne
          trouvait pas de `handleBounds`, sortait l'erreur 008 en console et
          n'affichait rien. Il y a donc peut-être déjà des traits fantômes en
          base. Ces poignées restent invisibles (le groupe est en `zIndex: -1`,
          elles sont derrière les cartes) : elles ne servent que d'ancrage
          géométrique au trait, le geste passe par « touche le départ puis
          l'arrivée ». */}
      <PoigneesCardinales couleur={palette.border} classeSurvol="" />
      <div className="flex items-start gap-1.5 pr-2">
        {/* L'onglet garde exactement la même forme en lecture et en saisie : on
            renomme dans l'objet, la boîte ne saute pas sous le curseur. */}
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); save() }
              if (e.key === 'Escape') { setDraft(d.label); setEditing(false) }
            }}
            className="nodrag min-w-0 outline-none placeholder:text-black/40"
            style={{ ...onglet, width: 150, maxWidth: '60%', border: 'none' }}
            placeholder="Nom du groupe…"
          />
        ) : (
          <>
            <span
              className="truncate cursor-text"
              style={onglet}
              onDoubleClick={() => { setDraft(d.label); setEditing(true) }}
              title="Double-clic pour renommer"
            >
              {d.label || 'Groupe'}
            </span>
            {/* Le double-clic ne parvient pas au doigt (le navigateur en fait un
                zoom) : au téléphone, le renommage a son propre bouton. */}
            {isMobile && (
              <button
                onClick={(e) => { e.stopPropagation(); setDraft(d.label); setEditing(true) }}
                className="nodrag nopan flex-shrink-0 p-1.5 rounded-md"
                aria-label="Renommer le groupe"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: palette.border }}
              >
                <Pencil size={13} />
              </button>
            )}
          </>
        )}
        {/* Pousse les outils (couleurs, Mapper, promotion, dissoudre) à droite :
            l'onglet ne prend plus toute la largeur, il se dimensionne à son texte. */}
        <span className="flex-1" />
        {/* Groupe VIVANT : relié à un concept — déposer dedans tague, sortir détague */}
        {isLive && !editing && (
          <span
            className="flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded mt-1.5"
            /* Même recette que l'onglet : pavé plein dans la couleur du groupe,
               encre sombre. Le fond était en `rgba(255,255,255,0.08)`, invisible
               sur le canvas clair, et le texte en `palette.border` y tombait
               vers 2,4:1. Les teintes sont pastel, l'encre sombre passe dans les
               deux thèmes. */
            style={{ background: palette.border, color: palette.ink }}
            title="Groupe vivant — relié au concept : y déposer tague automatiquement, en sortir détague"
          >
            ◆ concept
          </span>
        )}
      </div>
    </div>
  )
}

const nodeTypes = { message: MessageNode, group: GroupNode, concept: ConceptNode }

// React Flow exige les parents AVANT leurs enfants dans le tableau
export function sortParentsFirst(nds: Node[]): Node[] {
  return [...nds.filter(n => n.type === 'group'), ...nds.filter(n => n.type !== 'group')]
}

// La barre partagée (canvas/CanvasToolbar) + le Panel « Grouper / Fusionner »,
// qui doit rester enfant de <ReactFlow> et ne peut donc pas vivre dans la barre.
function BarreOutilsNote({ activeTool, setActiveTool, onAddConcept, selectedCount, mergeableCount, onGroupSelection, onMergeSelection, onNewGroup, onNewText }: {
  activeTool: CanvasTool
  setActiveTool: (t: CanvasTool) => void
  onAddConcept?: () => void
  selectedCount: number
  mergeableCount: number
  onGroupSelection: () => void
  onMergeSelection: () => void
  onNewGroup: (pos: { x: number; y: number }) => void
  onNewText: (pos: { x: number; y: number }) => void
}) {
  const { screenToFlowPosition } = useReactFlow()

  return (
    <>
      {(selectedCount >= 2 || mergeableCount === 2) && (
        <Panel position="top-center" className="flex items-center gap-2">
          {selectedCount >= 2 && (
            <button
              onClick={onGroupSelection}
              className="canvas-float-pill"
              style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, color: '#3b82f6', cursor: 'pointer' }}
            >
              Grouper la sélection ({selectedCount})
            </button>
          )}
          {mergeableCount === 2 && (
            <button
              onClick={onMergeSelection}
              className="canvas-float-pill"
              title="Fusionner les deux blocs en un seul (copie de travail — les originaux restent intacts)"
              style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, color: '#a78bfa', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Combine size={13} /> Fusionner
            </button>
          )}
        </Panel>
      )}
      <CanvasToolbar
        outil={activeTool}
        setOutil={setActiveTool}
        outils={[
          { id: 'select', label: 'Sélectionner — glisse sur le vide pour en prendre plusieurs (V)' },
          { id: 'connect', label: 'Relier deux blocs — touche le départ, puis l\'arrivée (E)' },
          { id: 'pan', label: 'Déplacer le canvas (H)' },
        ]}
        actions={([
          ...(onAddConcept ? [{
            id: 'concept',
            Icon: Hash,
            label: 'Poser un concept sur le canvas — relie-lui des blocs avec le crayon (E)',
            onClick: onAddConcept,
          }] : []),
          {
            id: 'groupe',
            Icon: FolderPlus,
            label: 'Nouveau groupe — une zone nommée, puis glisse des blocs dedans',
            // Le décalage écran reste ici : il dépend de la largeur du panneau
            // latéral de CE canvas, la barre partagée n'a pas à le connaître.
            onClick: (e) => onNewGroup(screenToFlowPosition({ x: e.clientX - 460, y: e.clientY })),
          },
          {
            id: 'texte',
            Icon: Type,
            label: 'Bloc de texte libre — une pensée à toi sur le canvas',
            onClick: (e) => onNewText(screenToFlowPosition({ x: e.clientX - 380, y: e.clientY })),
          },
        ] as ActionBarre[])}
      />
    </>
  )
}

// Provider nécessaire pour useReactFlow/useViewport au niveau racine (même modèle que le home)
export default function StudyCanvas(props: StudyCanvasProps) {
  return (
    <ReactFlowProvider>
      <StudyCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function StudyCanvasInner({
  // ⚠️ `canvasId` était déclaré dans les props mais JAMAIS déstructuré : il
  // était donc accepté et ignoré. Le nœud-concept en a besoin (il s'auto-retire
  // via l'API), d'où son ajout ici au 0.1.7.
  canvasId,
  nodes: initialNodes,
  edges: initialEdges,
  messages,
  onDropMessage,
  onMoveNode,
  onRemoveNode,
  onConnect: onConnectCallback,
  onDeleteEdge,
  onReconnectEdge,
  onCreateGroup,
  onCreateText,
  onCreateConcept,
  onUpdateNode,
  onPromoteGroupTag,
  tradeMeta,
  armedMessageId,
  onArmedPlaced,
}: StudyCanvasProps) {
  const [activeTool, setActiveTool] = useState<CanvasTool>('select')
  const [conceptPickerOpen, setConceptPickerOpen] = useState(false)
  // Bloc de départ d'un lien en cours (outil crayon).
  const [linkSourceId, setLinkSourceId] = useState<string | null>(null)
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)
  const messageMap = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages]
  )

  // ── Grille + spotlight — EXACTEMENT les couches du canvas home ──
  const isMobile = useIsMobile()

  // 0.1.7 — ce canvas n'avait AUCUN raccourci d'outil, contrairement à
  // l'accueil : les quatre outils y étaient exclusivement à la souris.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement | null
      const saisie = cible?.tagName === 'INPUT' || cible?.tagName === 'TEXTAREA' || cible?.isContentEditable
      if (saisie || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'v' || e.key === 'V') setActiveTool('select')
      if (e.key === 'e' || e.key === 'E') setActiveTool('connect')
      if (e.key === 'h' || e.key === 'H') setActiveTool('pan')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ⚠️ Au doigt, le premier geste attendu est de déplacer la vue. Depuis que
  // `select` trace un rectangle de sélection au glisser (0.1.7), démarrer sur
  // `select` rendrait le canvas inerte au téléphone. L'accueil avait déjà cette
  // bascule (retour Brice du 25/07), elle manquait ici.
  const outilMobilePoseRef = useRef(false)
  useEffect(() => {
    if (isMobile && !outilMobilePoseRef.current) {
      outilMobilePoseRef.current = true
      setActiveTool('pan')
    }
  }, [isMobile])
  const { screenToFlowPosition, getInternalNode } = useReactFlow()
  const { x: vpX, y: vpY, zoom } = useViewport()
  const rootRef = useRef<HTMLDivElement>(null)
  const spotlightRef = useRef<HTMLDivElement>(null)

  const dotSize = 22 * zoom
  const dotPosX = ((vpX % dotSize) + dotSize) % dotSize
  const dotPosY = ((vpY % dotSize) + dotSize) % dotSize
  const dotBgStyle = {
    backgroundSize: `${dotSize}px ${dotSize}px`,
    backgroundPosition: `${dotPosX}px ${dotPosY}px`,
  }

  useEffect(() => {
    // Rien à suivre au doigt — cf. le même court-circuit sur le canvas home.
    if (isMobile) return
    const el = rootRef.current
    const spotlight = spotlightRef.current
    if (!el || !spotlight) return
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      spotlight.style.setProperty('--mx', `${e.clientX - rect.left}px`)
      spotlight.style.setProperty('--my', `${e.clientY - rect.top}px`)
      spotlight.style.opacity = '1'
    }
    const onLeave = () => { spotlight.style.opacity = '0' }
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [isMobile])

  // Handlers de groupe accessibles depuis les nodes via ref (évite les fermetures périmées)
  const groupHandlersRef = useRef<GroupHandlers>({
    rename: () => {}, recolor: () => {}, promote: async () => false, dissolve: () => {}, resize: () => {},
  })

  const buildGroupNode = useCallback((g: CanvasNodeData, autoEdit = false): Node => ({
    id: g.id,
    type: 'group',
    position: { x: g.x, y: g.y },
    style: { width: g.width, height: g.height, zIndex: -1 },
    data: {
      label: g.label ?? 'Groupe',
      color: g.color ?? 'blue',
      tagId: g.tagId ?? null,
      autoEdit,
      handlers: groupHandlersRef,
    },
  }), [])

  const buildMessageNode = useCallback((n: CanvasNodeData, autoEdit = false): Node => {
    const msg = n.messageId ? messageMap.get(n.messageId) : undefined
    // La surcharge locale (copie de travail) prime sur le contenu du message d'origine
    const displayContent = n.content ?? msg?.content ?? ''
    const trade = msg?.tradeRef ? tradeMeta?.[msg.tradeRef] : undefined
    return {
      id: n.id,
      type: 'message',
      position: { x: n.x, y: n.y },
      ...(n.parentId ? { parentId: n.parentId } : {}),
      style: { width: n.width, height: n.height },
      data: {
        content: displayContent,
        type: msg?.type ?? 'text',
        kind: n.kind === 'text' ? 'text' : 'message',
        edited: n.content != null && !!msg,
        autoEdit,
        trade,
        onRemove: () => {
          onRemoveNode(n.id)
          // Retrait local immédiat — sinon le bloc restait sur le canvas ET revenait dans la liste du bas (doublon)
          setNodes(nds => nds.filter(node => node.id !== n.id))
        },
        onZoom: (src: string) => setZoomSrc(src),
        onResizeEnd: (p: { width: number; height: number; x: number; y: number }) =>
          onUpdateNode(n.id, { width: p.width, height: p.height, x: p.x, y: p.y }),
        onSaveContent: (content: string) => {
          onUpdateNode(n.id, { content })
          setNodes(nds => nds.map(node => node.id === n.id
            ? { ...node, data: { ...node.data, content, edited: !!msg } }
            : node))
        },
        onResetContent: () => {
          onUpdateNode(n.id, { content: null })
          setNodes(nds => nds.map(node => node.id === n.id
            ? { ...node, data: { ...node.data, content: msg?.content ?? '', edited: false } }
            : node))
        },
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageMap, onRemoveNode, onUpdateNode, tradeMeta])

  // ⚠️ Ce filtre est exclusif : tout `kind` non prévu ici est SILENCIEUSEMENT
  // jeté, sans erreur. C'est ce qui serait arrivé aux nœuds-concept, créés en
  // base mais jamais affichés. D'où la troisième branche.
  const rfNodes: Node[] = useMemo(
    () => sortParentsFirst([
      ...initialNodes.filter((n) => n.kind === 'group').map((g) => buildGroupNode(g)),
      ...initialNodes.filter((n) => n.kind === 'concept').map((c) => ({
        id: c.id,
        type: 'concept',
        position: { x: c.x, y: c.y },
        data: { label: c.label ?? '', color: c.color, canvasId },
      })),
      ...initialNodes.filter((n) => n.kind !== 'group' && n.kind !== 'concept' && (n.messageId || n.kind === 'text')).map((n) => buildMessageNode(n)),
    ]),
    [initialNodes, buildGroupNode, buildMessageNode, canvasId]
  )

  const rfEdges: Edge[] = useMemo(
    () =>
      initialEdges.map((e) => ({
        id: e.id,
        source: e.fromId,
        target: e.toId,
        sourceHandle: e.fromHandle ?? undefined,
        targetHandle: e.toHandle ?? undefined,
        label: e.label ?? undefined,
        type: 'trait',
        // Pas de `style` ici : depuis le 0.1.7 l'aspect du trait se déduit de ce
        // qu'il relie, et c'est `CanvasEdge.tsx` qui le décide. Un style posé au
        // site de construction serait ignoré, donc trompeur.
        labelStyle: { fill: 'var(--node-meta)', fontSize: 10 },
      })),
    [initialEdges]
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges)

  // 0.1.7 — même trait que sur l'accueil : le cercle ne parcourt que les traits
  // du bloc survolé (variante 3 du labo). Voir `CanvasEdge.tsx`.
  const [survole, setSurvole] = useState<string | null>(null)
  const edgesAffichees = useMemo(() => avecSurvol(edges, survole), [edges, survole])
  const connexionAutorisee = useMemo(() => connexionValide(edges), [edges])

  // 0.1.7 — même geste qu'à l'accueil : on détache l'extrémité d'un trait pour
  // la reposer sur une autre poignée DU MÊME bloc. Rebrancher sur un autre bloc
  // est refusé pour l'instant (tags et contrainte d'unicité).
  // Pose le concept au centre de la vue, via le layout (cf. la prop).
  const poserConcept = useCallback(async (tag: { id: string; name: string; color: string }) => {
    if (!onCreateConcept) return
    const centre = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    await onCreateConcept({ tagId: tag.id, label: tag.name, color: tag.color, x: centre.x - 80, y: centre.y - 22 })
    setConceptPickerOpen(false)
  }, [onCreateConcept, screenToFlowPosition])

  const onReconnect = useCallback((ancien: Edge, nouveau: Connection) => {
    if (nouveau.source !== ancien.source || nouveau.target !== ancien.target) return
    setEdges(eds => eds.map(e => e.id === ancien.id
      ? { ...e, sourceHandle: nouveau.sourceHandle, targetHandle: nouveau.targetHandle }
      : e))
    onReconnectEdge?.(ancien.id, nouveau.sourceHandle ?? null, nouveau.targetHandle ?? null)
  }, [setEdges, onReconnectEdge])
  const onNodeMouseEnter = useCallback((_: React.MouseEvent, n: Node) => setSurvole(n.id), [])
  const onNodeMouseLeave = useCallback(() => setSurvole(null), [])

  // Sync React Flow internal state when nodes/edges are added/removed externally
  useEffect(() => {
    setNodes((prev) => {
      const rfById = new Map(rfNodes.map((n) => [n.id, n]))
      // On garde l'état VIVANT des nodes encore présents (dédoublonnés), on RETIRE les
      // disparus du modèle (ex. « remettre à zéro »), et on ajoute les nouveaux.
      const seen = new Set<string>()
      const kept = prev.filter((n) => rfById.has(n.id) && !seen.has(n.id) && seen.add(n.id))
      const existingIds = new Set(kept.map((n) => n.id))
      const newNodes = rfNodes.filter((n) => !existingIds.has(n.id))
      if (newNodes.length === 0 && kept.length === prev.length) return prev
      return sortParentsFirst([...kept, ...newNodes])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfNodes])

  useEffect(() => {
    setEdges(rfEdges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfEdges])

  // ---- Groupes : renommer / recolorer / promouvoir / dissoudre ----
  const renameGroup = useCallback((id: string, label: string) => {
    onUpdateNode(id, { label })
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, label } } : n))
  }, [onUpdateNode, setNodes])

  const recolorGroup = useCallback((id: string, color: string) => {
    onUpdateNode(id, { color })
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, color } } : n))
  }, [onUpdateNode, setNodes])

  const dissolveGroup = useCallback((id: string) => {
    const group = nodes.find(n => n.id === id)
    if (!group) return
    // Détacher les enfants en convertissant leur position en absolu AVANT le DELETE serveur
    const children = nodes.filter(n => n.parentId === id)
    for (const child of children) {
      const abs = { x: group.position.x + child.position.x, y: group.position.y + child.position.y }
      onUpdateNode(child.id, { parentId: null, x: abs.x, y: abs.y })
    }
    setNodes(nds => nds
      .filter(n => n.id !== id)
      .map(n => {
        if (n.parentId !== id) return n
        const abs = { x: group.position.x + n.position.x, y: group.position.y + n.position.y }
        return { ...n, parentId: undefined, position: abs }
      })
    )
    onRemoveNode(id)
  }, [nodes, onUpdateNode, onRemoveNode, setNodes])

  groupHandlersRef.current = {
    rename: renameGroup,
    recolor: recolorGroup,
    promote: onPromoteGroupTag,
    dissolve: dissolveGroup,
    resize: (id, p) => onUpdateNode(id, { width: p.width, height: p.height, x: p.x, y: p.y }),
  }

  const groupCount = nodes.filter(n => n.type === 'group').length
  const nextColor = COLOR_KEYS[groupCount % COLOR_KEYS.length]

  // Anti double-clic : une seule création de groupe à la fois (les doubles POST créaient des groupes fantômes)
  const creatingGroupRef = useRef(false)

  // Nouveau groupe vide
  const handleNewGroup = useCallback(async (pos: { x: number; y: number }) => {
    if (creatingGroupRef.current) return
    creatingGroupRef.current = true
    try {
      const created = await onCreateGroup({ label: 'Groupe', color: nextColor, x: pos.x, y: pos.y })
      if (!created) return
      setNodes(nds => sortParentsFirst([...nds.filter(n => n.id !== created.id), buildGroupNode(created, true)]))
    } finally {
      creatingGroupRef.current = false
    }
  }, [onCreateGroup, nextColor, buildGroupNode, setNodes])

  // Bloc de texte libre — édition immédiate à la création
  const handleNewText = useCallback(async (pos: { x: number; y: number }) => {
    const created = await onCreateText({ x: pos.x, y: pos.y })
    if (!created) return
    setNodes(nds => sortParentsFirst([...nds.filter(n => n.id !== created.id), buildMessageNode(created, true)]))
  }, [onCreateText, buildMessageNode, setNodes])

  // Fusionner exactement deux blocs sélectionnés : la copie de travail du bloc
  // du haut absorbe le contenu affiché de l'autre ; les originaux restent intacts.
  const selectedBlocks = nodes.filter(n => n.selected && n.type === 'message')
  const handleMergeSelection = useCallback(() => {
    const selected = nodes.filter(n => n.selected && n.type === 'message')
    if (selected.length !== 2) return
    const absY = (n: Node) => {
      const parent = n.parentId ? nodes.find(p => p.id === n.parentId) : undefined
      return parent ? parent.position.y + n.position.y : n.position.y
    }
    const [a, b] = [...selected].sort((n1, n2) => absY(n1) - absY(n2))
    const contentOf = (n: Node) => (n.data as { content?: string }).content ?? ''
    // Séparateur discret entre les deux blocs fusionnés (rendu « ⸻ » sur sa propre ligne)
    const merged = `${contentOf(a)}<hr/>${contentOf(b)}`
    ;(a.data as { onSaveContent: (c: string) => void }).onSaveContent(merged)
    // Le bloc absorbé quitte le canvas (son message redevient disponible dans la liste)
    onRemoveNode(b.id)
    setNodes(nds => nds
      .filter(n => n.id !== b.id)
      .map(n => n.id === a.id
        ? { ...n, selected: false, style: { ...n.style, height: Math.min(((a.style?.height as number) ?? 120) + ((b.style?.height as number) ?? 120) * 0.7, 520) } }
        : n))
    const newHeight = Math.min(((a.style?.height as number) ?? 120) + ((b.style?.height as number) ?? 120) * 0.7, 520)
    onUpdateNode(a.id, { height: newHeight })
  }, [nodes, onRemoveNode, onUpdateNode, setNodes])

  // Grouper la sélection (blocs libres uniquement)
  const selectedFree = nodes.filter(n => n.selected && n.type === 'message' && !n.parentId)

  const handleGroupSelection = useCallback(async () => {
    if (creatingGroupRef.current) return
    creatingGroupRef.current = true
    try {
    const selected = nodes.filter(n => n.selected && n.type === 'message' && !n.parentId)
    if (selected.length < 2) return
    const boxes = selected.map(n => ({
      x: n.position.x,
      y: n.position.y,
      w: (n.style?.width as number) ?? 280,
      h: (n.style?.height as number) ?? 120,
    }))
    const minX = Math.min(...boxes.map(b => b.x)) - 24
    const minY = Math.min(...boxes.map(b => b.y)) - 44
    const maxX = Math.max(...boxes.map(b => b.x + b.w)) + 24
    const maxY = Math.max(...boxes.map(b => b.y + b.h)) + 24
    const created = await onCreateGroup({ label: 'Groupe', color: nextColor, x: minX, y: minY, width: maxX - minX, height: maxY - minY })
    if (!created) return
    const selectedIds = new Set(selected.map(n => n.id))
    setNodes(nds => sortParentsFirst([
      ...nds.map(n => selectedIds.has(n.id)
        ? { ...n, selected: false, parentId: created.id, position: { x: n.position.x - minX, y: n.position.y - minY } }
        : n),
      buildGroupNode(created, true),
    ]))
    for (const n of selected) {
      onUpdateNode(n.id, { parentId: created.id, x: n.position.x - minX, y: n.position.y - minY })
    }
    } finally {
      creatingGroupRef.current = false
    }
  }, [nodes, onCreateGroup, nextColor, buildGroupNode, setNodes, onUpdateNode])

  // Le trait s'affiche tout de suite (c'est ce qui rend le geste vivant), mais
  // il est RETIRÉ si le serveur refuse. Avant, il était ajouté puis jamais
  // annulé : un POST en échec laissait un trait fantôme à l'écran jusqu'au
  // rechargement, alors qu'il n'existait nulle part en base. On se donne un id
  // explicite pour pouvoir retirer exactement celui-là.
  const onConnect = useCallback(
    async (params: Connection) => {
      if (!params.source || !params.target) return
      const idProvisoire = `local-${params.source}-${params.target}`
      setEdges(eds => addEdge(
        // Aspect décidé par `CanvasEdge.tsx` d'après les nœuds reliés (0.1.7).
        { ...params, id: idProvisoire, type: 'trait' },
        eds,
      ))
      const ok = await onConnectCallback(
        params.source, params.target,
        params.sourceHandle ?? undefined, params.targetHandle ?? undefined,
      )
      if (ok === false) setEdges(eds => eds.filter(e => e.id !== idProvisoire))
    },
    [setEdges, onConnectCallback]
  )

  // Le halo du bloc armé passe par la className du nœud (cf. `.link-armed`).
  const armLink = useCallback((id: string | null) => {
    setLinkSourceId(id)
    setNodes((nds) => nds.map((n) =>
      n.className === 'link-armed' || n.id === id
        ? { ...n, className: n.id === id ? 'link-armed' : undefined }
        : n
    ))
  }, [setNodes])

  // ── Crayon : tap sur le bloc de départ, tap sur celui d'arrivée ──
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (activeTool !== 'connect') return
    if (!linkSourceId) { armLink(node.id); return }
    if (linkSourceId === node.id) { armLink(null); return } // re-tap = on annule
    const source = linkSourceId
    armLink(null)
    // Le tap → tap ne passe PAS par `isValidConnection` (il appelle onConnect
    // directement), donc on refait le garde ici.
    if (lienDejaPresent(edges, source, node.id)) return
    // Sans handles explicites, React Flow prend la première source et la
    // première cible : le trait partirait toujours du bas vers le haut, même
    // pour relier deux blocs côte à côte.
    const cotes = poigneesEntre(getInternalNode, source, node.id, { w: 280, h: 120 })
    onConnect({ source, target: node.id, ...cotes })
  }, [activeTool, linkSourceId, armLink, onConnect, getInternalNode, edges])

  // ── Le vide : y poser le bloc armé, ou annuler le lien en cours ──
  const onPaneClick = useCallback((event: React.MouseEvent) => {
    if (linkSourceId) { armLink(null); return }
    if (!armedMessageId) return
    // Même conversion écran → canvas que le drop souris, au même décalage près :
    // le bloc se pose centré sous le doigt, pas coin supérieur gauche dessous.
    const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    onDropMessage(armedMessageId, pos.x - 140, pos.y - 60)
    onArmedPlaced?.()
  }, [linkSourceId, armLink, armedMessageId, screenToFlowPosition, onDropMessage, onArmedPlaced])

  // Au lâcher : rattacher/détacher selon la zone survolée (« ça va avec ça » au drag)
  const onNodeDragStop = useCallback(
    // L'événement est un `MouseEvent | TouchEvent` du DOM, pas un `React.MouseEvent` :
    // React Flow appelle ce rappel depuis ses propres écouteurs, hors du système
    // d'événements synthétiques de React. Le tapuscrit s'en plaignait depuis le
    // passage à xyflow v12 ; l'événement n'étant pas utilisé, seul le type change.
    (_: MouseEvent | TouchEvent, node: Node) => {
      if (node.type === 'group') {
        onMoveNode(node.id, node.position.x, node.position.y)
        return
      }
      const parent = node.parentId ? nodes.find(n => n.id === node.parentId) : undefined
      const abs = parent
        ? { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y }
        : node.position
      const w = (node.style?.width as number) ?? 280
      const h = (node.style?.height as number) ?? 120
      const cx = abs.x + w / 2
      const cy = abs.y + h / 2
      const blockArea = w * h
      // Rattachement au groupe le plus RECOUVERT (≥35 % du bloc) ou dont il contient le centre.
      // Plus tolérant que le simple test « centre dedans » : évite les blocs « posés dessus » mais non pris.
      let target: Node | undefined
      let bestScore = 0
      for (const g of nodes) {
        if (g.type !== 'group') continue
        const gw = (g.style?.width as number) ?? 360
        const gh = (g.style?.height as number) ?? 260
        const ox = Math.max(0, Math.min(abs.x + w, g.position.x + gw) - Math.max(abs.x, g.position.x))
        const oy = Math.max(0, Math.min(abs.y + h, g.position.y + gh) - Math.max(abs.y, g.position.y))
        const overlap = ox * oy
        const centerIn = cx >= g.position.x && cx <= g.position.x + gw && cy >= g.position.y && cy <= g.position.y + gh
        if (overlap < blockArea * 0.35 && !centerIn) continue
        const score = overlap + (centerIn ? blockArea : 0)
        if (score > bestScore) { bestScore = score; target = g }
      }
      if (target && target.id !== node.parentId) {
        const rel = { x: abs.x - target.position.x, y: abs.y - target.position.y }
        setNodes(nds => sortParentsFirst(nds.map(n => n.id === node.id ? { ...n, parentId: target.id, position: rel } : n)))
        onUpdateNode(node.id, { parentId: target.id, x: rel.x, y: rel.y })
      } else if (!target && node.parentId) {
        setNodes(nds => nds.map(n => n.id === node.id ? { ...n, parentId: undefined, position: abs } : n))
        onUpdateNode(node.id, { parentId: null, x: abs.x, y: abs.y })
      } else {
        onMoveNode(node.id, node.position.x, node.position.y)
      }
    },
    [nodes, onMoveNode, onUpdateNode, setNodes]
  )

  const onEdgeDoubleClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      onDeleteEdge(edge.id)
      setEdges((eds) => eds.filter((e) => e.id !== edge.id))
    },
    [onDeleteEdge, setEdges]
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const messageId = event.dataTransfer.getData('messageId')
      if (!messageId) return

      // Conversion écran → coordonnées canvas (indispensable avec fitView/zoom/pan)
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      onDropMessage(messageId, pos.x - 140, pos.y - 60)
    },
    [onDropMessage, screenToFlowPosition]
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  return (
    <div ref={rootRef} className="canvas-root" onDrop={onDrop} onDragOver={onDragOver}>
      {/* Couches de fond identiques au canvas home */}
      <div className="canvas-grid" style={dotBgStyle} />
      {!isMobile && <div ref={spotlightRef} className="canvas-dot-spotlight" style={dotBgStyle} />}

      <div style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
      <ReactFlow
        nodes={nodes}
        edges={edgesAffichees}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes} edgeTypes={canvasEdgeTypes}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        // 0.1.7 — `mark` supprimé, `select` prend son comportement. Glisser sur
        // le vide trace donc maintenant un rectangle de sélection ici aussi, là
        // où ça déplaçait la vue. Le déplacement reste sur H, sur Espace + glisser
        // et sur le bouton du milieu. Pas le bouton 2 : c'est le menu contextuel.
        selectionOnDrag={activeTool === 'select'}
        panOnDrag={activeTool === 'select' ? [1] : true}
        // Jamais passé jusqu'ici, donc `true` par défaut dans TOUS les outils :
        // les poignées restaient réactives même en mode sélection, alors que
        // l'accueil les désactive hors crayon. On aligne sur l'accueil. React
        // Flow ne donne `pointer-events: all` aux poignées que via la classe
        // `connectionindicator`, qu'il ne pose que si ceci est vrai.
        nodesConnectable={activeTool === 'connect'}
        {...ASSISTANCE_CONNEXION}
        isValidConnection={connexionAutorisee}
        onReconnect={onReconnect}
        reconnectRadius={25}
        // Crayon : les blocs ne bougent pas, sinon le premier tap les déplace
        // au lieu d'armer le lien. Le glissement reste libre pour se déplacer.
        nodesDraggable={activeTool !== 'pan' && activeTool !== 'connect'}
        elementsSelectable={activeTool !== 'pan'}
        style={{ background: 'transparent' }}
      >
        <ConceptPicker
          ouvert={conceptPickerOpen}
          onFermer={() => setConceptPickerOpen(false)}
          onChoisi={poserConcept}
        />
        <BarreOutilsNote
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          onAddConcept={onCreateConcept ? () => setConceptPickerOpen(o => !o) : undefined}
          selectedCount={selectedFree.length}
          mergeableCount={selectedBlocks.length}
          onGroupSelection={handleGroupSelection}
          onMergeSelection={handleMergeSelection}
          onNewGroup={handleNewGroup}
          onNewText={handleNewText}
        />
      </ReactFlow>
      </div>

      {/* L'état du geste en cours. Sans cette ligne, on touche un bloc et « il
          ne se passe rien » — le tap → tap ne s'annonce pas tout seul. */}
      {(armedMessageId || activeTool === 'connect') && (
        <div style={{ position: 'absolute', bottom: 96, left: '50%', transform: 'translateX(-50%)', zIndex: 31, pointerEvents: 'none' }}>
          <div className="canvas-float-pill" style={{ padding: '7px 13px', fontSize: 12, color: 'var(--node-title)', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
            {armedMessageId ? (
              <>Touche le canvas pour <strong style={{ fontWeight: 600 }}>poser le bloc</strong></>
            ) : linkSourceId ? (
              <><Pencil size={12} style={{ color: '#3b82f6', flexShrink: 0 }} />Touche le bloc d&apos;<strong style={{ fontWeight: 600 }}>arrivée</strong></>
            ) : (
              <><Pencil size={12} style={{ color: '#3b82f6', flexShrink: 0 }} />Touche le bloc de <strong style={{ fontWeight: 600 }}>départ</strong></>
            )}
          </div>
        </div>
      )}

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 3 }}>
          <div className="text-center">
            <div className="text-4xl mb-3 opacity-30">🎯</div>
            {isMobile ? (
              <>
                <p className="text-sm" style={{ color: 'var(--node-meta)' }}>Touche un bloc en bas, puis touche le canvas</p>
                <p className="text-xs mt-1" style={{ color: 'var(--node-meta)', opacity: 0.7 }}>Le crayon relie deux blocs : départ, puis arrivée</p>
              </>
            ) : (
              <>
                <p className="text-sm" style={{ color: 'var(--node-meta)' }}>Glisse des blocs depuis le panneau bas</p>
                <p className="text-xs mt-1" style={{ color: 'var(--node-meta)', opacity: 0.7 }}>Glisse sur le vide pour sélectionner plusieurs blocs → « Grouper »</p>
              </>
            )}
          </div>
        </div>
      )}

      <ImageLightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </div>
  )
}
