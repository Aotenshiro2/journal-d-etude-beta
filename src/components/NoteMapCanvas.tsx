'use client'

import { useState, useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Node,
  Edge,
  Connection,
  addEdge,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  Handle,
  Position,
  NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import Link from 'next/link'
import { NoteData, CanvasData } from '@/types'

interface NoteMapCanvasProps {
  notes: NoteData[]
  canvas: CanvasData
}

function NoteMapNode({ data }: NodeProps) {
  const d = data as { note: NoteData }
  return (
    <div className="bg-gray-800 border border-white/20 rounded-xl p-3 w-full h-full shadow-lg">
      <Handle type="target" position={Position.Top} className="!bg-blue-400" />
      <Handle type="source" position={Position.Bottom} className="!bg-blue-400" />
      <div className="flex items-center gap-2 mb-1.5">
        {d.note.favicon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.note.favicon} alt="" className="w-3.5 h-3.5 rounded flex-shrink-0" />
        )}
        <span className="text-xs font-semibold text-white line-clamp-1">{d.note.title}</span>
      </div>
      <Link
        href={`/study/${d.note.id}`}
        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
      >
        Étudier →
      </Link>
    </div>
  )
}

const nodeTypes = { noteMap: NoteMapNode }

export default function NoteMapCanvas({ notes, canvas }: NoteMapCanvasProps) {
  const noteMap = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes])
  const placedNoteIds = new Set(canvas.nodes.filter((n) => n.noteId).map((n) => n.noteId as string))
  const [availableNotes, setAvailableNotes] = useState(notes.filter((n) => !placedNoteIds.has(n.id)))

  const rfNodes: Node[] = useMemo(
    () =>
      canvas.nodes
        .filter((n) => n.noteId)
        .map((n) => ({
          id: n.id,
          type: 'noteMap',
          position: { x: n.x, y: n.y },
          style: { width: 200, height: 80 },
          data: { note: noteMap.get(n.noteId!) ?? { id: n.noteId!, title: '...', content: '', userId: '', firstSyncAt: '', lastModifiedAt: '' } },
        })),
    [canvas.nodes, noteMap]
  )

  const rfEdges: Edge[] = useMemo(
    () =>
      canvas.edges.map((e) => ({
        id: e.id,
        source: e.fromId,
        target: e.toId,
        type: 'smoothstep',
        style: { stroke: '#60a5fa', strokeWidth: 1.5 },
      })),
    [canvas.edges]
  )

  const [nodes, , onNodesChange] = useNodesState(rfNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges)

  const onConnect = useCallback(
    async (params: Connection) => {
      setEdges((eds) => addEdge({ ...params, type: 'smoothstep', style: { stroke: '#60a5fa', strokeWidth: 1.5 } }, eds))
      if (params.source && params.target) {
        await fetch(`/api/canvas/${canvas.id}/edges`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromId: params.source, toId: params.target }),
        })
      }
    },
    [setEdges, canvas.id]
  )

  const handleDropNote = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const noteId = e.dataTransfer.getData('noteId')
      if (!noteId) return

      const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const x = e.clientX - bounds.left - 100
      const y = e.clientY - bounds.top - 40

      const res = await fetch(`/api/canvas/${canvas.id}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId, x, y }),
      })

      if (res.ok) {
        setAvailableNotes((prev) => prev.filter((n) => n.id !== noteId))
      }
    },
    [canvas.id]
  )

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar with available notes */}
      <div className="w-56 border-r border-white/10 bg-gray-900 overflow-y-auto flex-shrink-0 p-3">
        <p className="text-xs font-medium text-gray-400 mb-3">Notes à lier</p>
        <div className="space-y-2">
          {availableNotes.map((note) => (
            <div
              key={note.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('noteId', note.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              className="p-2.5 rounded-lg border border-white/10 bg-gray-800 hover:border-white/20 cursor-grab active:cursor-grabbing text-xs text-gray-300 transition-all"
            >
              <div className="flex items-center gap-1.5">
                {note.favicon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={note.favicon} alt="" className="w-3.5 h-3.5 rounded flex-shrink-0" />
                )}
                <span className="line-clamp-2 leading-tight">{note.title}</span>
              </div>
            </div>
          ))}
          {availableNotes.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-4">Toutes les notes sont sur le canvas</p>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div
        className="flex-1 relative"
        onDrop={handleDropNote}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          className="bg-gray-900"
        >
          <Background color="#374151" gap={24} />
          <Controls className="[&>button]:bg-gray-800 [&>button]:border-white/20 [&>button]:text-white" />
        </ReactFlow>
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-4xl mb-3 opacity-30">🗺</div>
              <p className="text-sm text-gray-600">Glisse des notes depuis la liste de gauche</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
