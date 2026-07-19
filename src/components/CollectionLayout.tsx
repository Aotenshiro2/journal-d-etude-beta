'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { ChevronLeft, RotateCcw, Layers } from 'lucide-react'
import StudyCanvas from './StudyCanvas'
import MessagePanel from './MessagePanel'
import { MessageData, CanvasData, CanvasNodeData, CanvasEdgeData } from '@/types'

interface CollectionLayoutProps {
  title: string
  noteCount: number
  messages: (MessageData & { sourceNoteTitle?: string })[]
  canvas: CanvasData
}

// 0.1.5 — Espace de mapping d'une COLLECTION : les blocs de PLUSIEURS notes
// réunies dans un groupe de l'accueil, posables et reliables ensemble. Même
// décor que le canvas d'étude d'une note, mais alimenté par plusieurs séances.
export default function CollectionLayout({ title, noteCount, messages, canvas: initialCanvas }: CollectionLayoutProps) {
  const [canvas, setCanvas] = useState<CanvasData>(initialCanvas)

  const placedMessageIds = new Set(
    canvas.nodes.filter((n) => n.messageId).map((n) => n.messageId as string)
  )
  const availableMessages = messages.filter((m) => !placedMessageIds.has(m.id))

  const handleDropMessage = useCallback(async (messageId: string, x: number, y: number) => {
    const res = await fetch(`/api/canvas/${canvas.id}/nodes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, x, y }),
    })
    if (res.ok) {
      const node: CanvasNodeData = await res.json()
      setCanvas((prev) => ({ ...prev, nodes: [...prev.nodes, node] }))
    }
  }, [canvas.id])

  const handleMoveNode = useCallback(async (nodeId: string, x: number, y: number) => {
    const res = await fetch(`/api/canvas/${canvas.id}/nodes/${nodeId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y }),
    })
    if (res.ok) setCanvas((prev) => ({ ...prev, nodes: prev.nodes.map((n) => n.id === nodeId ? { ...n, x, y } : n) }))
  }, [canvas.id])

  const handleRemoveNode = useCallback(async (nodeId: string) => {
    await fetch(`/api/canvas/${canvas.id}/nodes/${nodeId}`, { method: 'DELETE' })
    setCanvas((prev) => ({ ...prev, nodes: prev.nodes.filter((n) => n.id !== nodeId) }))
  }, [canvas.id])

  const handleCreateGroup = useCallback(async (group: { label: string; color: string; x: number; y: number; width?: number; height?: number }): Promise<CanvasNodeData | null> => {
    const res = await fetch(`/api/canvas/${canvas.id}/nodes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'group', ...group }),
    })
    if (!res.ok) return null
    const node: CanvasNodeData = await res.json()
    setCanvas((prev) => ({ ...prev, nodes: [...prev.nodes, node] }))
    return node
  }, [canvas.id])

  const handleUpdateNode = useCallback(async (nodeId: string, patch: Partial<Pick<CanvasNodeData, 'x' | 'y' | 'width' | 'height' | 'label' | 'color' | 'parentId' | 'orderInParent' | 'tagId'>>) => {
    const res = await fetch(`/api/canvas/${canvas.id}/nodes/${nodeId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (res.ok) setCanvas((prev) => ({ ...prev, nodes: prev.nodes.map((n) => n.id === nodeId ? { ...n, ...patch } : n) }))
  }, [canvas.id])

  const handleCreateText = useCallback(async (pos: { x: number; y: number }): Promise<CanvasNodeData | null> => {
    const res = await fetch(`/api/canvas/${canvas.id}/nodes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'text', content: '', x: pos.x, y: pos.y }),
    })
    if (!res.ok) return null
    const node: CanvasNodeData = await res.json()
    setCanvas((prev) => ({ ...prev, nodes: [...prev.nodes, node] }))
    return node
  }, [canvas.id])

  // Promouvoir un groupe de blocs de la collection en concept (tague les blocs)
  const handlePromoteGroupTag = useCallback(async (label: string, groupId: string): Promise<boolean> => {
    const messageIds = canvas.nodes.filter((n) => n.parentId === groupId && n.messageId).map((n) => n.messageId as string)
    const res = await fetch('/api/tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: label, messageIds }),
    })
    if (!res.ok) return false
    const tag = await res.json()
    if (tag?.id) await handleUpdateNode(groupId, { tagId: tag.id })
    return true
  }, [canvas.nodes, handleUpdateNode])

  const handleConnect = useCallback(async (fromId: string, toId: string, fromHandle?: string, toHandle?: string) => {
    const res = await fetch(`/api/canvas/${canvas.id}/edges`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromId, toId, fromHandle: fromHandle ?? null, toHandle: toHandle ?? null }),
    })
    if (res.ok) {
      const edge: CanvasEdgeData = await res.json()
      setCanvas((prev) => ({ ...prev, edges: [...prev.edges, edge] }))
    }
  }, [canvas.id])

  const handleDeleteEdge = useCallback(async (edgeId: string) => {
    await fetch(`/api/canvas/${canvas.id}/edges/${edgeId}`, { method: 'DELETE' })
    setCanvas((prev) => ({ ...prev, edges: prev.edges.filter((e) => e.id !== edgeId) }))
  }, [canvas.id])

  const handleResetCanvas = useCallback(async () => {
    if (!window.confirm('Remettre ce canvas de collection à zéro ?\n\nLes blocs reviennent dans la liste du bas, les groupes et textes libres sont supprimés. Tes notes d\'origine ne sont pas touchées.')) return
    const res = await fetch(`/api/canvas/${canvas.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true }),
    })
    if (res.ok) setCanvas((prev) => ({ ...prev, nodes: [], edges: [] }))
  }, [canvas.id])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--canvas-bg)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex' }}>
        <StudyCanvas
          canvasId={canvas.id}
          nodes={canvas.nodes}
          edges={canvas.edges}
          messages={messages}
          onDropMessage={handleDropMessage}
          onMoveNode={handleMoveNode}
          onRemoveNode={handleRemoveNode}
          onConnect={handleConnect}
          onDeleteEdge={handleDeleteEdge}
          onCreateGroup={handleCreateGroup}
          onCreateText={handleCreateText}
          onUpdateNode={handleUpdateNode}
          onPromoteGroupTag={handlePromoteGroupTag}
        />
      </div>

      {/* Haut-gauche : retour à la carte + titre de la collection */}
      <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 40, maxWidth: 'calc(100vw - 120px)' }}>
        <div className="canvas-float-pill" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 8px' }}>
          <Link href="/" title="Retour à la carte des notes" style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--node-meta)', textDecoration: 'none', fontSize: 12, flexShrink: 0 }}>
            <ChevronLeft size={14} /> Carte
          </Link>
          <div style={{ width: 1, height: 16, background: 'var(--float-border)', flexShrink: 0 }} />
          <Layers size={13} style={{ color: 'var(--node-meta)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--node-title)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          <span style={{ fontSize: 11, color: 'var(--node-meta)', flexShrink: 0 }}>· {noteCount} note{noteCount > 1 ? 's' : ''}</span>
          <div style={{ width: 1, height: 16, background: 'var(--float-border)', flexShrink: 0 }} />
          <button
            onClick={handleResetCanvas}
            title="Remettre ce canvas de collection à zéro"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, cursor: 'pointer', flexShrink: 0, background: 'none', border: '1px solid transparent', color: 'var(--node-meta)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'var(--canvas-bg)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--node-meta)'; e.currentTarget.style.background = 'none' }}
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      {/* Blocs disponibles — pill flottante en bas (tous les blocs des notes membres) */}
      <MessagePanel canvasId={canvas.id} messages={availableMessages as MessageData[]} />
    </div>
  )
}
