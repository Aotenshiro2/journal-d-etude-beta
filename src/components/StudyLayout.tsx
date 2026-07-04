'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
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

// La note explosée — même décor que le canvas d'accueil : on zoome dans la note,
// on ne change jamais d'espace.
export default function StudyLayout({ note, canvas: initialCanvas, isDiverged }: StudyLayoutProps) {
  const [canvas, setCanvas] = useState<CanvasData>(initialCanvas)
  const [drawerOpen, setDrawerOpen] = useState(true)

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

  // Bloc de texte libre (kind 'text') — une pensée à soi sur le canvas
  const handleCreateText = useCallback(
    async (pos: { x: number; y: number }): Promise<CanvasNodeData | null> => {
      const res = await fetch(`/api/canvas/${canvas.id}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'text', content: '', x: pos.x, y: pos.y }),
      })
      if (!res.ok) return null
      const node: CanvasNodeData = await res.json()
      setCanvas((prev) => ({ ...prev, nodes: [...prev.nodes, node] }))
      return node
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
    async (fromId: string, toId: string, fromHandle?: string, toHandle?: string) => {
      const res = await fetch(`/api/canvas/${canvas.id}/edges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromId, toId, fromHandle: fromHandle ?? null, toHandle: toHandle ?? null }),
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
    <div style={{ position: 'fixed', inset: 0, background: 'var(--canvas-bg)', overflow: 'hidden' }}>
      {/* ── Canvas plein cadre ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex' }}>
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
          onCreateText={handleCreateText}
          onUpdateNode={handleUpdateNode}
          onPromoteGroupTag={handlePromoteGroupTag}
        />
      </div>

      {/* ── Haut-gauche : retour à la carte + titre de la note ── */}
      <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 40, maxWidth: 'calc(100vw - 120px)' }}>
        <div className="canvas-float-pill" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 8px' }}>
          <Link
            href="/"
            title="Retour à la carte des notes"
            style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--node-meta)', textDecoration: 'none', fontSize: 12, flexShrink: 0 }}
          >
            <ChevronLeft size={14} /> Carte
          </Link>
          <div style={{ width: 1, height: 16, background: 'var(--float-border)', flexShrink: 0 }} />
          {note.favicon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={note.favicon} alt="" style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} />
          )}
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--node-title)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {note.title}
          </span>
        </div>
      </div>

      {/* ── Bannière de divergence ── */}
      {isDiverged && (
        <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 40 }}>
          <div className="canvas-float-pill" style={{ overflow: 'hidden' }}>
            <DivergenceBanner onDismiss={handleDismissDivergence} />
          </div>
        </div>
      )}

      {/* ── Tiroir gauche : la note d'origine (jamais modifiée) ── */}
      {drawerOpen && (
        <div
          className="canvas-float-pill"
          style={{
            position: 'absolute', left: 14, top: 56, bottom: 96, zIndex: 30,
            width: 300, display: 'flex', flexDirection: 'column',
            overflow: 'hidden', padding: 0,
          }}
        >
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <NoteReader note={note} />
          </div>
        </div>
      )}

      {/* ── Poignée du tiroir — même geste que l'aperçu du canvas home ── */}
      <button
        onClick={() => setDrawerOpen(v => !v)}
        title={drawerOpen ? 'Réduire la note d\'origine' : 'Rouvrir la note d\'origine'}
        style={{
          position: 'absolute',
          left: drawerOpen ? 314 : 14,
          top: 100,
          zIndex: 35,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 36,
          padding: 0,
          cursor: 'pointer',
          background: 'var(--drawer-bg)',
          border: '1px solid var(--drawer-border)',
          borderLeft: drawerOpen ? 'none' : '1px solid var(--drawer-border)',
          borderRadius: drawerOpen ? '0 8px 8px 0' : '8px',
          boxShadow: 'var(--float-shadow)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          transition: 'left 0.25s ease',
        }}
      >
        {drawerOpen
          ? <ChevronLeft size={12} style={{ color: 'var(--drawer-icon)' }} />
          : <ChevronRight size={12} style={{ color: 'var(--drawer-icon)' }} />
        }
      </button>

      {/* ── Blocs disponibles — pill flottante en bas ── */}
      <MessagePanel canvasId={canvas.id} messages={availableMessages} />
    </div>
  )
}
