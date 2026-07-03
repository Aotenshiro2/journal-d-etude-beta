'use client'

import { useState, useCallback } from 'react'
import NoteReader from './NoteReader'
import StudyCanvas from './StudyCanvas'
import MessagePanel from './MessagePanel'
import DivergenceBanner from './DivergenceBanner'
import { MessageData, CanvasData, NoteData, CanvasNodeData, CanvasEdgeData } from '@/types'

interface StudyLayoutProps {
  note: NoteData & { messages: MessageData[] }
  canvas: CanvasData
  isDiverged: boolean
}

export default function StudyLayout({ note, canvas: initialCanvas, isDiverged }: StudyLayoutProps) {
  const [canvas, setCanvas] = useState<CanvasData>(initialCanvas)

  // Messages not yet placed on canvas
  const placedMessageIds = new Set(
    canvas.nodes.filter((n) => n.messageId).map((n) => n.messageId as string)
  )
  const availableMessages = note.messages?.filter((m) => !placedMessageIds.has(m.id)) ?? []

  const handleDropMessage = useCallback(
    async (messageId: string, x: number, y: number) => {
      const res = await fetch(`/api/canvas/${canvas.id}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, x, y }),
      })
      if (res.ok) {
        const node: CanvasNodeData = await res.json()
        setCanvas((prev) => ({ ...prev, nodes: [...prev.nodes, node] }))
      }
    },
    [canvas.id]
  )

  const handleMoveNode = useCallback(
    async (nodeId: string, x: number, y: number) => {
      const res = await fetch(`/api/canvas/${canvas.id}/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
      })
      if (res.ok) {
        setCanvas((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)),
        }))
      }
    },
    [canvas.id]
  )

  const handleRemoveNode = useCallback(
    async (nodeId: string) => {
      await fetch(`/api/canvas/${canvas.id}/nodes/${nodeId}`, { method: 'DELETE' })
      setCanvas((prev) => ({
        ...prev,
        nodes: prev.nodes.filter((n) => n.id !== nodeId),
      }))
    },
    [canvas.id]
  )

  // Créer un groupe nommé (zone englobante) — retourne le node créé
  const handleCreateGroup = useCallback(
    async (group: { label: string; color: string; x: number; y: number; width?: number; height?: number }): Promise<CanvasNodeData | null> => {
      const res = await fetch(`/api/canvas/${canvas.id}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'group', ...group }),
      })
      if (!res.ok) return null
      const node: CanvasNodeData = await res.json()
      setCanvas((prev) => ({ ...prev, nodes: [...prev.nodes, node] }))
      return node
    },
    [canvas.id]
  )

  // Mise à jour générique d'un node (position, appartenance, label, couleur…)
  const handleUpdateNode = useCallback(
    async (nodeId: string, patch: Partial<Pick<CanvasNodeData, 'x' | 'y' | 'width' | 'height' | 'label' | 'color' | 'parentId' | 'orderInParent'>>) => {
      const res = await fetch(`/api/canvas/${canvas.id}/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        setCanvas((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
        }))
      }
    },
    [canvas.id]
  )

  // Promouvoir le nom d'un groupe en tag de la taxonomie (proto-concept → concept)
  const handlePromoteGroupTag = useCallback(async (label: string): Promise<boolean> => {
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: label }),
    })
    return res.ok
  }, [])

  const handleConnect = useCallback(
    async (fromId: string, toId: string) => {
      const res = await fetch(`/api/canvas/${canvas.id}/edges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromId, toId }),
      })
      if (res.ok) {
        const edge: CanvasEdgeData = await res.json()
        setCanvas((prev) => ({ ...prev, edges: [...prev.edges, edge] }))
      }
    },
    [canvas.id]
  )

  const handleDeleteEdge = useCallback(
    async (edgeId: string) => {
      await fetch(`/api/canvas/${canvas.id}/edges/${edgeId}`, { method: 'DELETE' })
      setCanvas((prev) => ({
        ...prev,
        edges: prev.edges.filter((e) => e.id !== edgeId),
      }))
    },
    [canvas.id]
  )

  const handleDismissDivergence = useCallback(async () => {
    await fetch(`/api/canvas/${canvas.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteContentHash: note.contentHash }),
    })
  }, [canvas.id, note.contentHash])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {isDiverged && (
        <DivergenceBanner onDismiss={handleDismissDivergence} />
      )}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Note reader */}
        <div className="w-80 flex-shrink-0 border-r border-white/10 overflow-y-auto">
          <NoteReader note={note} />
        </div>

        {/* Right: Canvas + Message Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <StudyCanvas
            canvasId={canvas.id}
            nodes={canvas.nodes}
            edges={canvas.edges}
            messages={note.messages ?? []}
            onDropMessage={handleDropMessage}
            onMoveNode={handleMoveNode}
            onRemoveNode={handleRemoveNode}
            onConnect={handleConnect}
            onDeleteEdge={handleDeleteEdge}
            onCreateGroup={handleCreateGroup}
            onUpdateNode={handleUpdateNode}
            onPromoteGroupTag={handlePromoteGroupTag}
          />
          <MessagePanel
            canvasId={canvas.id}
            messages={availableMessages}
          />
        </div>
      </div>
    </div>
  )
}
