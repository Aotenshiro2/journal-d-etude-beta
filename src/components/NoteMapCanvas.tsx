'use client'

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
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
      className="note-map-card"
      onDoubleClick={() => router.push(`/study/${note.id}`)}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: 'var(--node-handle)', opacity: 0, width: 8, height: 8, minWidth: 0, border: 'none' }}
        className="!transition-opacity group-hover:!opacity-100"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: 'var(--node-handle)', opacity: 0, width: 8, height: 8, minWidth: 0, border: 'none' }}
        className="!transition-opacity group-hover:!opacity-100"
      />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '14px 14px 8px' }}>
        {note.favicon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={note.favicon} alt="" style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0, marginTop: 2 }} />
        ) : (
          <div style={{ width: 16, height: 16, borderRadius: 3, background: 'var(--node-border)', flexShrink: 0, marginTop: 2 }} />
        )}
        <span style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--node-title)',
          lineHeight: '1.3',
          flex: 1,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {note.title}
        </span>
      </div>

      {/* Preview */}
      {preview && (
        <p style={{
          padding: '0 14px',
          fontSize: 11,
          color: 'var(--node-preview)',
          lineHeight: '1.6',
          flex: 1,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {preview}
        </p>
      )}

      {/* Footer */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        marginTop: 'auto',
        borderTop: '1px solid var(--node-border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {badge && (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: 100,
              background: `${badge.color}20`,
              color: badge.color,
            }}>
              {badge.label}
            </span>
          )}
          <span style={{ fontSize: 10, color: 'var(--node-meta)' }}>{relativeDate}</span>
        </div>
        <span style={{ fontSize: 10, color: 'var(--node-meta)' }}>↗ ouvrir</span>
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

  // Cursor glow
  const canvasRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const glow = glowRef.current
    const onMove = (e: MouseEvent) => {
      if (!glow) return
      const rect = el.getBoundingClientRect()
      glow.style.left = `${e.clientX - rect.left}px`
      glow.style.top = `${e.clientY - rect.top}px`
      glow.style.opacity = '1'
    }
    const onLeave = () => { if (glow) glow.style.opacity = '0' }
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  // noteId → dbNodeId
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
    []
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

  const focusNote = useCallback((noteId: string) => {
    const node = nodes.find(n => n.id === noteId)
    if (node) {
      setCenter(node.position.x + 130, node.position.y + 76, { zoom: 1.1, duration: 600 })
    }
  }, [nodes, setCenter])

  const filteredNotes = useMemo(() =>
    notes.filter(n => n.title.toLowerCase().includes(search.toLowerCase())),
    [notes, search]
  )

  return (
    <div className="flex flex-1 overflow-hidden relative">

      {/* ── Left panel ── */}
      <div
        className="flex-shrink-0 flex flex-col overflow-hidden"
        style={{
          width: leftOpen ? 256 : 0,
          minWidth: leftOpen ? 256 : 0,
          transition: 'width 0.2s ease',
          background: 'var(--node-bg)',
          borderRight: '1px solid var(--node-border)',
        }}
      >
        {/* Search */}
        <div style={{ padding: 12, borderBottom: '1px solid var(--node-border)', flexShrink: 0 }}>
          <input
            type="text"
            placeholder="Rechercher..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--canvas-bg)',
              border: '1px solid var(--node-border)',
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 13,
              color: 'var(--node-title)',
              outline: 'none',
            }}
          />
          <p style={{ fontSize: 10, color: 'var(--node-meta)', marginTop: 8, paddingLeft: 2 }}>
            {notes.length} note{notes.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Note list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {filteredNotes.map(note => (
            <button
              key={note.id}
              onClick={() => focusNote(note.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                borderRadius: 10,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--canvas-bg)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {note.favicon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={note.favicon} alt="" style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--node-border)', flexShrink: 0 }} />
                )}
                <span style={{ fontSize: 12, color: 'var(--node-preview)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {note.title}
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--node-meta)', marginTop: 2, paddingLeft: 22 }}>
                {formatRelativeTime(new Date(note.lastModifiedAt))}
              </div>
            </button>
          ))}
          {filteredNotes.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--node-meta)', textAlign: 'center', paddingTop: 32 }}>Aucune note</p>
          )}
        </div>
      </div>

      {/* ── Toggle button ── */}
      <button
        onClick={() => setLeftOpen(o => !o)}
        className="absolute top-4 z-20 w-5 h-8 rounded-r-lg flex items-center justify-center transition-colors"
        style={{
          left: leftOpen ? 256 : 0,
          transition: 'left 0.2s ease',
          background: 'var(--node-bg)',
          border: '1px solid var(--node-border)',
          color: 'var(--node-meta)',
        }}
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
      <div ref={canvasRef} className="canvas-root">
        <div className="canvas-grid" />
        <div ref={glowRef} className="canvas-cursor-glow" style={{ opacity: 0 }} />

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
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
          style={{ background: 'transparent', position: 'relative', zIndex: 2 }}
        >
          <Controls
            style={{
              background: 'var(--node-bg)',
              border: '1px solid var(--node-border)',
              borderRadius: 8,
              boxShadow: 'var(--node-shadow)',
            }}
          />
          <MiniMap
            nodeColor="var(--node-border)"
            maskColor="rgba(0,0,0,0.15)"
            style={{
              background: 'var(--node-bg)',
              border: '1px solid var(--node-border)',
              borderRadius: 12,
            }}
          />

          {notes.length === 0 && (
            <Panel position="top-center">
              <div className="text-center mt-32">
                <div className="text-5xl mb-4 opacity-10">📘</div>
                <p style={{ fontSize: 14, color: 'var(--node-meta)' }}>Aucune note pour l&apos;instant</p>
                <p style={{ fontSize: 12, color: 'var(--node-meta)', marginTop: 6, opacity: 0.7 }}>
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
