'use client'

import React, { useState, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  ReactFlow,
  Node,
  Edge,
  Connection,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  NodeProps,
  OnNodeDrag,
  Panel,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { NoteData, CanvasData } from '@/types'
import { stripHtml, formatRelativeTime } from '@/lib/utils'

// ─── Source badge ─────────────────────────────────────────────────────────────

function getSourceBadge(sourceUrl?: string | null): { label: string; color: string } | null {
  if (!sourceUrl) return null
  if (sourceUrl.includes('tradingview')) return { label: 'TradingView', color: '#26A69A' }
  if (sourceUrl.includes('topstep')) return { label: 'TopStep', color: '#4285F4' }
  if (sourceUrl.includes('youtube')) return { label: 'YouTube', color: '#EF4444' }
  if (sourceUrl.includes('skool')) return { label: 'Skool', color: '#6366F1' }
  if (sourceUrl.includes('simplefx') || sourceUrl.includes('trade')) return { label: 'Trading', color: '#F59E0B' }
  return null
}

// ─── Note card node ───────────────────────────────────────────────────────────

const NoteMapNode = React.memo(function NoteMapNode({ data }: NodeProps) {
  const router = useRouter()
  const { note } = data as { note: NoteData }

  const preview = useMemo(() => {
    const text = stripHtml(note.content || '')
    return text.slice(0, 110).trim()
  }, [note.content])

  const relativeDate = useMemo(
    () => formatRelativeTime(new Date(note.lastModifiedAt)),
    [note.lastModifiedAt]
  )

  const badge = useMemo(() => getSourceBadge(note.sourceUrl), [note.sourceUrl])

  return (
    <div
      className="w-full h-full flex flex-col bg-[#141414] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden group cursor-default"
      style={{ transition: 'border-color 0.15s' }}
      onDoubleClick={() => router.push(`/study/${note.id}`)}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(59,130,246,0.45)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!opacity-0 group-hover:!opacity-100 !w-2 !h-2 !min-w-0 !bg-blue-400 !border-0 !transition-opacity"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!opacity-0 group-hover:!opacity-100 !w-2 !h-2 !min-w-0 !bg-blue-400 !border-0 !transition-opacity"
      />

      {/* Header */}
      <div className="flex items-start gap-2 px-3.5 pt-3.5 pb-2">
        {note.favicon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={note.favicon} alt="" className="w-4 h-4 rounded flex-shrink-0 mt-0.5" />
        ) : (
          <div className="w-4 h-4 rounded bg-white/10 flex-shrink-0 mt-0.5" />
        )}
        <span className="text-[13px] font-semibold text-white line-clamp-2 leading-tight flex-1">
          {note.title}
        </span>
      </div>

      {/* Preview */}
      {preview && (
        <p className="px-3.5 text-[11px] text-gray-500 line-clamp-3 leading-relaxed flex-1">
          {preview}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-3.5 py-2.5 mt-auto border-t border-white/[0.05]">
        <div className="flex items-center gap-2">
          {badge && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: `${badge.color}20`, color: badge.color }}
            >
              {badge.label}
            </span>
          )}
          <span className="text-[10px] text-gray-600">{relativeDate}</span>
        </div>
        <span className="text-[10px] text-gray-700 group-hover:text-blue-400 transition-colors">
          ↗ ouvrir
        </span>
      </div>
    </div>
  )
})

const nodeTypes = { noteMap: NoteMapNode }

// ─── Auto-position (grid fallback pour notes sans position sauvegardée) ───────

function autoPosition(index: number): { x: number; y: number } {
  const cols = 4
  const colW = 310
  const rowH = 210
  return {
    x: (index % cols) * colW + 60,
    y: Math.floor(index / cols) * rowH + 60,
  }
}

// ─── Inner canvas (needs ReactFlowProvider) ───────────────────────────────────

interface NoteMapCanvasProps {
  notes: NoteData[]
  canvas: CanvasData
}

function NoteMapCanvasInner({ notes, canvas }: NoteMapCanvasProps) {
  const [leftOpen, setLeftOpen] = useState(true)
  const [search, setSearch] = useState('')
  const { setCenter } = useReactFlow()

  // noteId → { dbNodeId, x, y } — mutable ref so drag saves don't need re-render
  const savedNodeRef = useRef(new Map<string, string>())
  useMemo(() => {
    canvas.nodes.forEach(n => {
      if (n.noteId) savedNodeRef.current.set(n.noteId, n.id)
    })
  }, [canvas.nodes])

  const savedPositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>()
    canvas.nodes.forEach(n => {
      if (n.noteId) map.set(n.noteId, { x: n.x, y: n.y })
    })
    return map
  }, [canvas.nodes])

  // Build initial nodes — ALL notes appear on canvas
  const initialNodes: Node[] = useMemo(() =>
    notes.map((note, i) => {
      const saved = savedPositions.get(note.id)
      const position = saved ?? autoPosition(i)
      return {
        id: note.id,
        type: 'noteMap',
        position,
        style: { width: 260, height: 152 },
        data: { note },
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // intentionally static — canvas layout managed by drag
  )

  const initialEdges: Edge[] = useMemo(() =>
    canvas.edges.map(e => ({
      id: e.id,
      source: e.fromId,
      target: e.toId,
      type: 'smoothstep',
      style: { stroke: '#3b82f6', strokeWidth: 1.5, opacity: 0.5 },
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Save position after drag
  const handleNodeDragStop: OnNodeDrag = useCallback(async (_, node) => {
    const { x, y } = node.position
    const dbNodeId = savedNodeRef.current.get(node.id)

    if (dbNodeId) {
      await fetch(`/api/canvas/${canvas.id}/nodes/${dbNodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
      })
    } else {
      const res = await fetch(`/api/canvas/${canvas.id}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: node.id, x, y }),
      })
      if (res.ok) {
        const data = await res.json()
        savedNodeRef.current.set(node.id, data.id)
      }
    }
  }, [canvas.id])

  // Create edge
  const onConnect = useCallback(async (params: Connection) => {
    setEdges(eds => addEdge(
      { ...params, type: 'smoothstep', style: { stroke: '#3b82f6', strokeWidth: 1.5, opacity: 0.5 } },
      eds
    ))
    if (params.source && params.target) {
      await fetch(`/api/canvas/${canvas.id}/edges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromId: params.source, toId: params.target }),
      })
    }
  }, [setEdges, canvas.id])

  // Focus note on canvas (from left panel click)
  const focusNote = useCallback((noteId: string) => {
    const node = nodes.find(n => n.id === noteId)
    if (node) {
      setCenter(node.position.x + 130, node.position.y + 76, { zoom: 1.1, duration: 600 })
    }
  }, [nodes, setCenter])

  // Filtered notes for left panel
  const filteredNotes = useMemo(() =>
    notes.filter(n => n.title.toLowerCase().includes(search.toLowerCase())),
    [notes, search]
  )

  return (
    <div className="flex flex-1 overflow-hidden relative">

      {/* ── Left panel ── */}
      <div
        className="flex-shrink-0 bg-[#0c0c0c] border-r border-white/[0.06] flex flex-col overflow-hidden"
        style={{
          width: leftOpen ? 256 : 0,
          transition: 'width 0.2s ease',
          minWidth: leftOpen ? 256 : 0,
        }}
      >
        {/* Search */}
        <div className="p-3 border-b border-white/[0.06] flex-shrink-0">
          <input
            type="text"
            placeholder="Rechercher..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-700 outline-none focus:border-blue-500/40 transition-colors"
          />
          <p className="text-[10px] text-gray-700 mt-2 px-0.5">{notes.length} note{notes.length !== 1 ? 's' : ''}</p>
        </div>

        {/* Note list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {filteredNotes.map(note => (
            <button
              key={note.id}
              onClick={() => focusNote(note.id)}
              className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/[0.05] transition-colors group"
            >
              <div className="flex items-center gap-2">
                {note.favicon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={note.favicon} alt="" className="w-3.5 h-3.5 rounded flex-shrink-0" />
                ) : (
                  <div className="w-3.5 h-3.5 rounded bg-white/10 flex-shrink-0" />
                )}
                <span className="text-xs text-gray-400 group-hover:text-white transition-colors line-clamp-1">
                  {note.title}
                </span>
              </div>
              <div className="text-[10px] text-gray-700 mt-0.5 pl-5">
                {formatRelativeTime(new Date(note.lastModifiedAt))}
              </div>
            </button>
          ))}
          {filteredNotes.length === 0 && (
            <p className="text-xs text-gray-700 text-center py-8">Aucune note</p>
          )}
        </div>
      </div>

      {/* ── Toggle button ── */}
      <button
        onClick={() => setLeftOpen(o => !o)}
        className="absolute top-4 z-20 w-5 h-8 bg-[#1a1a1a] border border-white/[0.08] rounded-r-lg flex items-center justify-center text-gray-600 hover:text-white hover:bg-[#222] transition-colors"
        style={{ left: leftOpen ? 256 : 0, transition: 'left 0.2s ease' }}
        title={leftOpen ? 'Fermer le panneau' : 'Ouvrir le panneau'}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d={leftOpen ? 'M6 2L4 5L6 8' : 'M4 2L6 5L4 8'}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* ── Canvas ── */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={handleNodeDragStop}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
          minZoom={0.08}
          maxZoom={2.5}
          deleteKeyCode={null}
          className="bg-[#080808]"
        >
          <Background color="#1c1c1c" gap={32} size={1} />
          <Controls
            className="[&>button]:bg-[#1a1a1a] [&>button]:border-white/[0.08] [&>button]:text-gray-500 [&>button:hover]:bg-[#252525] [&>button:hover]:text-white"
          />
          <MiniMap
            nodeColor="#1e1e1e"
            maskColor="rgba(0,0,0,0.7)"
            className="!bg-[#0c0c0c] !border !border-white/[0.08] !rounded-xl overflow-hidden"
          />

          {notes.length === 0 && (
            <Panel position="top-center">
              <div className="text-center mt-32">
                <div className="text-5xl mb-4 opacity-10">📘</div>
                <p className="text-sm text-gray-600">Aucune note pour l&apos;instant</p>
                <p className="text-xs text-gray-700 mt-1.5">
                  Utilise l&apos;extension Trading Note pour capturer tes premières notes
                </p>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </div>
  )
}

// ─── Export (wraps with ReactFlowProvider) ────────────────────────────────────

export default function NoteMapCanvas(props: NoteMapCanvasProps) {
  return (
    <ReactFlowProvider>
      <NoteMapCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
