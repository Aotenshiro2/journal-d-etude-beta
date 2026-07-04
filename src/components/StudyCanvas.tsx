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
  Handle,
  Position,
  Panel,
  useReactFlow,
  useViewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { FolderPlus, ZoomIn, ZoomOut, Maximize2, MousePointer2, Square, Hand, Type, Combine } from 'lucide-react'
import { MessageData, CanvasNodeData, CanvasEdgeData } from '@/types'
import { htmlToText, truncateText, extractImageSrc } from '@/lib/utils'
import ImageLightbox from './ImageLightbox'

type CanvasTool = 'select' | 'mark' | 'pan'

interface StudyCanvasProps {
  canvasId: string
  nodes: CanvasNodeData[]
  edges: CanvasEdgeData[]
  messages: MessageData[]
  onDropMessage: (messageId: string, x: number, y: number) => void
  onMoveNode: (nodeId: string, x: number, y: number) => void
  onRemoveNode: (nodeId: string) => void
  onConnect: (fromId: string, toId: string, fromHandle?: string, toHandle?: string) => void
  onDeleteEdge: (edgeId: string) => void
  onCreateGroup: (group: { label: string; color: string; x: number; y: number; width?: number; height?: number }) => Promise<CanvasNodeData | null>
  onCreateText: (pos: { x: number; y: number }) => Promise<CanvasNodeData | null>
  onUpdateNode: (nodeId: string, patch: Partial<Pick<CanvasNodeData, 'x' | 'y' | 'width' | 'height' | 'label' | 'color' | 'parentId' | 'orderInParent' | 'content'>>) => Promise<void> | void
  onPromoteGroupTag: (label: string) => Promise<boolean>
  tradeMeta?: Record<string, TradeMeta>
}

// Palette sobre des groupes — « ça va avec ça »
export const GROUP_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  blue: { border: '#60a5fa', bg: 'rgba(96,165,250,0.07)', text: '#93c5fd' },
  green: { border: '#34d399', bg: 'rgba(52,211,153,0.07)', text: '#6ee7b7' },
  amber: { border: '#fbbf24', bg: 'rgba(251,191,36,0.07)', text: '#fcd34d' },
  purple: { border: '#a78bfa', bg: 'rgba(167,139,250,0.07)', text: '#c4b5fd' },
  pink: { border: '#f472b6', bg: 'rgba(244,114,182,0.07)', text: '#f9a8d4' },
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

interface GroupHandlers {
  rename: (id: string, label: string) => void
  recolor: (id: string, color: string) => void
  promote: (label: string) => Promise<boolean>
  dissolve: (id: string) => void
  resize: (id: string, p: { width: number; height: number; x: number; y: number }) => void
}

const IMAGE_TYPES = new Set(['image', 'screenshot', 'capture'])

// Un bloc peut être : une image typée (URL nue ou <img>), du texte, OU du texte
// contenant une <img> inline (réalité des données synquées — base64 inclus).
export function parseBlockContent(content: string, type: string): { imgSrc: string | null; text: string } {
  let imgSrc: string | null = null
  const imgMatch = content.match(/<img[^>]*src=["']([^"']+)["']/i)
  if (imgMatch) {
    imgSrc = imgMatch[1]
  } else if (IMAGE_TYPES.has(type) && /^(https?:\/\/|data:image)/.test(content.trim())) {
    imgSrc = content.trim()
  } else if (IMAGE_TYPES.has(type)) {
    imgSrc = extractImageSrc(content)
  }
  const text = htmlToText(content.replace(/<img[^>]*>/gi, ''))
  return { imgSrc, text }
}

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
      {/* Mindmap : connexions sur les 4 côtés (haut/gauche = arrivée, bas/droite = départ) */}
      <Handle id="tt" type="target" position={Position.Top} className="!bg-blue-500" />
      <Handle id="tl" type="target" position={Position.Left} className="!bg-blue-500" />
      <Handle id="sb" type="source" position={Position.Bottom} className="!bg-blue-500" />
      <Handle id="sr" type="source" position={Position.Right} className="!bg-blue-500" />
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
          {d.kind === 'text' ? 'Double-clic pour écrire' : '(bloc vide)'}
        </div>
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
            className="absolute top-1.5 right-8 w-5 h-5 rounded-full bg-blue-500/80 text-white transition-opacity flex items-center justify-center text-[11px] opacity-0 group-hover:opacity-100 z-10"
          >
            ↺
          </button>
        </>
      )}
      {imgSrc && !editing && (
        <button
          onClick={(e) => { e.stopPropagation(); d.onZoom(imgSrc) }}
          title="Agrandir l'image"
          className="nodrag absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-black/55 text-white transition-opacity flex items-center justify-center text-[11px] opacity-0 group-hover:opacity-100 z-10"
        >
          ⤢
        </button>
      )}
      <button
        onClick={d.onRemove}
        title={d.kind === 'text' ? 'Supprimer ce bloc' : 'Retirer du canvas (le bloc revient dans la liste du bas)'}
        className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-red-500/85 text-white transition-opacity flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 z-10"
      >
        ✕
      </button>
    </div>
  )
}

// Zone englobante nommée — le geste « ça va avec ça »
function GroupNode({ id, data, selected }: NodeProps) {
  const d = data as { label: string; color: string; autoEdit?: boolean; handlers: React.MutableRefObject<GroupHandlers> }
  const [editing, setEditing] = useState(!!d.autoEdit)
  const [draft, setDraft] = useState(d.label)
  const [promoted, setPromoted] = useState(false)
  const palette = GROUP_COLORS[d.color] ?? GROUP_COLORS.blue

  const save = () => {
    const v = draft.trim()
    setEditing(false)
    if (v && v !== d.label) d.handlers.current.rename(id, v)
  }

  return (
    <div
      className="w-full h-full rounded-2xl group/gz"
      style={{ border: `1.5px dashed ${palette.border}`, background: palette.bg }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={150}
        lineStyle={{ borderColor: palette.border }}
        handleStyle={{ background: palette.border, border: 'none', width: 9, height: 9, borderRadius: 2 }}
        onResizeEnd={(_, p) => d.handlers.current.resize(id, { width: p.width, height: p.height, x: p.x, y: p.y })}
      />
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
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
            className="nodrag flex-1 min-w-0 bg-transparent text-xs font-medium outline-none border-b border-white/20 placeholder:text-gray-500"
            style={{ color: palette.border }}
            placeholder="Nom du groupe…"
          />
        ) : (
          <p
            className="flex-1 min-w-0 text-xs font-medium truncate cursor-text"
            style={{ color: palette.border }}
            onDoubleClick={() => { setDraft(d.label); setEditing(true) }}
            title="Double-clic pour renommer"
          >
            {d.label || 'Groupe'}
          </p>
        )}
        <span className="hidden group-hover/gz:flex items-center gap-1 nodrag flex-shrink-0">
          {COLOR_KEYS.map(k => (
            <button
              key={k}
              onClick={() => d.handlers.current.recolor(id, k)}
              className="w-2.5 h-2.5 rounded-full border border-black/40"
              style={{ background: GROUP_COLORS[k].border, opacity: k === d.color ? 1 : 0.45 }}
              title={`Couleur ${k}`}
              aria-label={`Couleur ${k}`}
            />
          ))}
          <button
            onClick={async () => { if (await d.handlers.current.promote(d.label)) setPromoted(true) }}
            className="ml-1 px-1 rounded text-[10px] font-semibold hover:bg-white/10"
            style={{ color: palette.border }}
            title={promoted ? 'Tag créé ✓' : 'Créer un tag depuis ce nom (proto-concept → taxonomie)'}
          >
            {promoted ? '✓' : '#'}
          </button>
          <button
            onClick={() => d.handlers.current.dissolve(id)}
            className="px-1 rounded text-[10px] text-gray-400 hover:text-red-400 hover:bg-white/10"
            title="Dissoudre le groupe (les blocs restent sur le canvas)"
          >
            ✕
          </button>
        </span>
      </div>
    </div>
  )
}

const nodeTypes = { message: MessageNode, group: GroupNode }

// React Flow exige les parents AVANT leurs enfants dans le tableau
function sortParentsFirst(nds: Node[]): Node[] {
  return [...nds.filter(n => n.type === 'group'), ...nds.filter(n => n.type !== 'group')]
}

// Pill d'outils à droite — même vocabulaire visuel que la RightToolbar du canvas home
function CanvasToolbar({ activeTool, setActiveTool, selectedCount, mergeableCount, onGroupSelection, onMergeSelection, onNewGroup, onNewText }: {
  activeTool: CanvasTool
  setActiveTool: (t: CanvasTool) => void
  selectedCount: number
  mergeableCount: number
  onGroupSelection: () => void
  onMergeSelection: () => void
  onNewGroup: (pos: { x: number; y: number }) => void
  onNewText: (pos: { x: number; y: number }) => void
}) {
  const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow()

  const btnBase: React.CSSProperties = {
    width: 30, height: 30, borderRadius: 7,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'none', border: '1px solid transparent',
    cursor: 'pointer', color: 'var(--node-meta)',
  }
  const divider = <div style={{ height: 1, background: 'var(--float-border)', margin: '2px 0' }} />

  const tools: { id: CanvasTool; Icon: React.ElementType; label: string }[] = [
    { id: 'select', Icon: MousePointer2, label: 'Sélectionner (glisser = déplacer la vue)' },
    { id: 'mark', Icon: Square, label: 'Sélection groupée (glisser = rectangle de sélection)' },
    { id: 'pan', Icon: Hand, label: 'Déplacer le canvas' },
  ]

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
      <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', zIndex: 20 }}>
        <div className="canvas-float-pill" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 4px' }}>
          {tools.map(tool => (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              title={tool.label}
              style={{
                ...btnBase,
                background: activeTool === tool.id ? 'rgba(59,130,246,0.15)' : 'none',
                border: activeTool === tool.id ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
                color: activeTool === tool.id ? '#3b82f6' : 'var(--node-meta)',
              }}
            >
              <tool.Icon size={14} />
            </button>
          ))}
          {divider}
          <button
            title="Nouveau groupe — une zone nommée, puis glisse des blocs dedans"
            style={btnBase}
            onClick={(e) => onNewGroup(screenToFlowPosition({ x: e.clientX - 460, y: e.clientY }))}
            onMouseEnter={e => { e.currentTarget.style.color = '#3b82f6' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--node-meta)' }}
          >
            <FolderPlus size={14} />
          </button>
          <button
            title="Bloc de texte libre — une pensée à toi sur le canvas"
            style={btnBase}
            onClick={(e) => onNewText(screenToFlowPosition({ x: e.clientX - 380, y: e.clientY }))}
            onMouseEnter={e => { e.currentTarget.style.color = '#3b82f6' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--node-meta)' }}
          >
            <Type size={14} />
          </button>
          {divider}
          {([
            { Icon: ZoomIn, label: 'Zoom avant', action: () => zoomIn({ duration: 200 }) },
            { Icon: ZoomOut, label: 'Zoom arrière', action: () => zoomOut({ duration: 200 }) },
            { Icon: Maximize2, label: 'Ajuster la vue', action: () => fitView({ duration: 400 }) },
          ] as { Icon: React.ElementType; label: string; action: () => void }[]).map(({ Icon, label, action }) => (
            <button key={label} onClick={action} title={label} style={btnBase}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--node-title)'; e.currentTarget.style.background = 'var(--canvas-bg)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--node-meta)'; e.currentTarget.style.background = 'none' }}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
      </div>
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
  nodes: initialNodes,
  edges: initialEdges,
  messages,
  onDropMessage,
  onMoveNode,
  onRemoveNode,
  onConnect: onConnectCallback,
  onDeleteEdge,
  onCreateGroup,
  onCreateText,
  onUpdateNode,
  onPromoteGroupTag,
  tradeMeta,
}: StudyCanvasProps) {
  const [activeTool, setActiveTool] = useState<CanvasTool>('select')
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)
  const messageMap = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages]
  )

  // ── Grille + spotlight — EXACTEMENT les couches du canvas home ──
  const { screenToFlowPosition } = useReactFlow()
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
  }, [])

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

  const rfNodes: Node[] = useMemo(
    () => sortParentsFirst([
      ...initialNodes.filter((n) => n.kind === 'group').map((g) => buildGroupNode(g)),
      ...initialNodes.filter((n) => n.kind !== 'group' && (n.messageId || n.kind === 'text')).map((n) => buildMessageNode(n)),
    ]),
    [initialNodes, buildGroupNode, buildMessageNode]
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
        type: 'smoothstep',
        style: { stroke: 'rgba(59,130,246,0.75)', strokeWidth: 1.5 },
        labelStyle: { fill: 'var(--node-meta)', fontSize: 10 },
      })),
    [initialEdges]
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges)

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

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge({ ...params, type: 'smoothstep', style: { stroke: 'rgba(59,130,246,0.75)', strokeWidth: 1.5 } }, eds))
      if (params.source && params.target) {
        onConnectCallback(params.source, params.target, params.sourceHandle ?? undefined, params.targetHandle ?? undefined)
      }
    },
    [setEdges, onConnectCallback]
  )

  // Au lâcher : rattacher/détacher selon la zone survolée (« ça va avec ça » au drag)
  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
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
      <div ref={spotlightRef} className="canvas-dot-spotlight" style={dotBgStyle} />

      <div style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onEdgeDoubleClick={onEdgeDoubleClick}
        nodeTypes={nodeTypes}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        selectionOnDrag={activeTool === 'mark'}
        panOnDrag={activeTool === 'mark' ? [1, 2] : true}
        nodesDraggable={activeTool !== 'pan'}
        elementsSelectable={activeTool !== 'pan'}
        style={{ background: 'transparent' }}
      >
        <CanvasToolbar
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          selectedCount={selectedFree.length}
          mergeableCount={selectedBlocks.length}
          onGroupSelection={handleGroupSelection}
          onMergeSelection={handleMergeSelection}
          onNewGroup={handleNewGroup}
          onNewText={handleNewText}
        />
      </ReactFlow>
      </div>

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 3 }}>
          <div className="text-center">
            <div className="text-4xl mb-3 opacity-30">🎯</div>
            <p className="text-sm" style={{ color: 'var(--node-meta)' }}>Glisse des blocs depuis le panneau bas</p>
            <p className="text-xs mt-1" style={{ color: 'var(--node-meta)', opacity: 0.7 }}>Shift + glisser = sélectionner plusieurs blocs → « Grouper »</p>
          </div>
        </div>
      )}

      <ImageLightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </div>
  )
}
