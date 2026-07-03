'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowInstance,
  Node,
  Edge,
  Connection,
  addEdge,
  useNodesState,
  useEdgesState,
  Background,
  NodeProps,
  Handle,
  Position,
  Panel,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { FolderPlus, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { MessageData, CanvasNodeData, CanvasEdgeData } from '@/types'
import { stripHtml, truncateText, extractImageSrc } from '@/lib/utils'

interface StudyCanvasProps {
  canvasId: string
  nodes: CanvasNodeData[]
  edges: CanvasEdgeData[]
  messages: MessageData[]
  onDropMessage: (messageId: string, x: number, y: number) => void
  onMoveNode: (nodeId: string, x: number, y: number) => void
  onRemoveNode: (nodeId: string) => void
  onConnect: (fromId: string, toId: string) => void
  onDeleteEdge: (edgeId: string) => void
  onCreateGroup: (group: { label: string; color: string; x: number; y: number; width?: number; height?: number }) => Promise<CanvasNodeData | null>
  onUpdateNode: (nodeId: string, patch: Partial<Pick<CanvasNodeData, 'x' | 'y' | 'width' | 'height' | 'label' | 'color' | 'parentId' | 'orderInParent'>>) => Promise<void> | void
  onPromoteGroupTag: (label: string) => Promise<boolean>
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

interface GroupHandlers {
  rename: (id: string, label: string) => void
  recolor: (id: string, color: string) => void
  promote: (label: string) => Promise<boolean>
  dissolve: (id: string) => void
}

function MessageNode({ data }: NodeProps) {
  const d = data as { content: string; type: string; onRemove: () => void }
  const text = truncateText(stripHtml(d.content), 150)

  return (
    <div
      className="relative rounded-xl p-3 w-full h-full text-xs group"
      style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', boxShadow: 'var(--node-shadow)', color: 'var(--node-preview)' }}
    >
      <Handle type="target" position={Position.Top} className="!bg-blue-500" />
      <Handle type="source" position={Position.Bottom} className="!bg-blue-500" />
      {d.type === 'image' ? (
        (() => {
          const src = extractImageSrc(d.content)
          return src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="w-full h-full object-cover rounded-lg" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-sm" style={{ color: 'var(--node-meta)' }}>
              Image non disponible
            </div>
          )
        })()
      ) : (
        <p className="leading-relaxed overflow-hidden" style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>
          {text}
        </p>
      )}
      <button
        onClick={d.onRemove}
        className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-red-500/0 hover:bg-red-500/80 text-white/0 hover:text-white transition-all flex items-center justify-center text-xs opacity-0 group-hover:opacity-100"
      >
        ✕
      </button>
    </div>
  )
}

// Zone englobante nommée — le geste « ça va avec ça »
function GroupNode({ id, data }: NodeProps) {
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
function CanvasToolbar({ selectedCount, onGroupSelection, onNewGroup }: {
  selectedCount: number
  onGroupSelection: () => void
  onNewGroup: (pos: { x: number; y: number }) => void
}) {
  const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow()

  const btnBase: React.CSSProperties = {
    width: 30, height: 30, borderRadius: 7,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'none', border: '1px solid transparent',
    cursor: 'pointer', color: 'var(--node-meta)',
  }
  const divider = <div style={{ height: 1, background: 'var(--float-border)', margin: '2px 0' }} />

  return (
    <>
      {selectedCount >= 2 && (
        <Panel position="top-center">
          <button
            onClick={onGroupSelection}
            className="canvas-float-pill"
            style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, color: '#3b82f6', cursor: 'pointer' }}
          >
            Grouper la sélection ({selectedCount})
          </button>
        </Panel>
      )}
      <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', zIndex: 20 }}>
        <div className="canvas-float-pill" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 4px' }}>
          <button
            title="Nouveau groupe — une zone nommée, puis glisse des blocs dedans"
            style={btnBase}
            onClick={(e) => onNewGroup(screenToFlowPosition({ x: e.clientX - 460, y: e.clientY }))}
            onMouseEnter={e => { e.currentTarget.style.color = '#3b82f6' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--node-meta)' }}
          >
            <FolderPlus size={14} />
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

export default function StudyCanvas({
  nodes: initialNodes,
  edges: initialEdges,
  messages,
  onDropMessage,
  onMoveNode,
  onRemoveNode,
  onConnect: onConnectCallback,
  onDeleteEdge,
  onCreateGroup,
  onUpdateNode,
  onPromoteGroupTag,
}: StudyCanvasProps) {
  const messageMap = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages]
  )

  // Handlers de groupe accessibles depuis les nodes via ref (évite les fermetures périmées)
  const groupHandlersRef = useRef<GroupHandlers>({
    rename: () => {}, recolor: () => {}, promote: async () => false, dissolve: () => {},
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

  const buildMessageNode = useCallback((n: CanvasNodeData): Node => {
    const msg = messageMap.get(n.messageId!)
    return {
      id: n.id,
      type: 'message',
      position: { x: n.x, y: n.y },
      ...(n.parentId ? { parentId: n.parentId } : {}),
      style: { width: n.width, height: n.height },
      data: {
        content: msg?.content ?? '',
        type: msg?.type ?? 'text',
        onRemove: () => onRemoveNode(n.id),
      },
    }
  }, [messageMap, onRemoveNode])

  const rfNodes: Node[] = useMemo(
    () => sortParentsFirst([
      ...initialNodes.filter((n) => n.kind === 'group').map((g) => buildGroupNode(g)),
      ...initialNodes.filter((n) => n.kind !== 'group' && n.messageId).map(buildMessageNode),
    ]),
    [initialNodes, buildGroupNode, buildMessageNode]
  )

  const rfEdges: Edge[] = useMemo(
    () =>
      initialEdges.map((e) => ({
        id: e.id,
        source: e.fromId,
        target: e.toId,
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
      const existingIds = new Set(prev.map((n) => n.id))
      const newNodes = rfNodes.filter((n) => !existingIds.has(n.id))
      if (newNodes.length === 0) return prev
      return sortParentsFirst([...prev, ...newNodes])
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
  }

  const groupCount = nodes.filter(n => n.type === 'group').length
  const nextColor = COLOR_KEYS[groupCount % COLOR_KEYS.length]

  // Nouveau groupe vide
  const handleNewGroup = useCallback(async (pos: { x: number; y: number }) => {
    const created = await onCreateGroup({ label: 'Groupe', color: nextColor, x: pos.x, y: pos.y })
    if (!created) return
    setNodes(nds => sortParentsFirst([...nds, buildGroupNode(created, true)]))
  }, [onCreateGroup, nextColor, buildGroupNode, setNodes])

  // Grouper la sélection (blocs libres uniquement)
  const selectedFree = nodes.filter(n => n.selected && n.type === 'message' && !n.parentId)

  const handleGroupSelection = useCallback(async () => {
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
  }, [nodes, onCreateGroup, nextColor, buildGroupNode, setNodes, onUpdateNode])

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge({ ...params, type: 'smoothstep', style: { stroke: 'rgba(59,130,246,0.75)', strokeWidth: 1.5 } }, eds))
      if (params.source && params.target) {
        onConnectCallback(params.source, params.target)
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
      const target = nodes.find(g => {
        if (g.type !== 'group') return false
        const gw = (g.style?.width as number) ?? 360
        const gh = (g.style?.height as number) ?? 260
        return cx >= g.position.x && cx <= g.position.x + gw && cy >= g.position.y && cy <= g.position.y + gh
      })
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

  // Instance React Flow — indispensable pour convertir écran → coordonnées canvas
  // (avec fitView/zoom/pan, les offsets bruts déposaient le bloc hors champ)
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null)

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const messageId = event.dataTransfer.getData('messageId')
      if (!messageId) return

      let x: number
      let y: number
      if (rfInstance) {
        const pos = rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        x = pos.x - 140
        y = pos.y - 60
      } else {
        const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
        x = event.clientX - bounds.left - 140
        y = event.clientY - bounds.top - 60
      }

      onDropMessage(messageId, x, y)
    },
    [onDropMessage, rfInstance]
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  return (
    <div className="flex-1 relative" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onInit={setRfInstance}
        nodeTypes={nodeTypes}
        deleteKeyCode={null}
        fitView
        style={{ background: 'transparent' }}
      >
        <Background color="var(--float-border)" gap={22} size={1.5} />
        <CanvasToolbar
          selectedCount={selectedFree.length}
          onGroupSelection={handleGroupSelection}
          onNewGroup={handleNewGroup}
        />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-4xl mb-3 opacity-30">🎯</div>
            <p className="text-sm" style={{ color: 'var(--node-meta)' }}>Glisse des blocs depuis le panneau bas</p>
            <p className="text-xs mt-1" style={{ color: 'var(--node-meta)', opacity: 0.7 }}>Shift + glisser = sélectionner plusieurs blocs → « Grouper »</p>
          </div>
        </div>
      )}
    </div>
  )
}
