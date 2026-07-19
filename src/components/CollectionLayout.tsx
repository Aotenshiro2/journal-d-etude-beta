'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, RotateCcw, Layers, Network, AlignLeft } from 'lucide-react'
import StudyCanvas from './StudyCanvas'
import DocumentView from './DocumentView'
import MessagePanel from './MessagePanel'
import { MessageData, CanvasData, CanvasNodeData, CanvasEdgeData } from '@/types'

interface CollectionLayoutProps {
  title: string
  noteCount: number
  memberNotes: { id: string; title: string; favicon: string | null }[]
  messages: (MessageData & { sourceNoteTitle?: string })[]
  canvas: CanvasData
}

// 0.1.5 — Espace de mapping d'une COLLECTION : les blocs de PLUSIEURS notes
// réunies dans un groupe de l'accueil, posables et reliables ensemble. Même
// décor que le canvas d'étude d'une note, mais alimenté par plusieurs séances.
export default function CollectionLayout({ title, noteCount, memberNotes, messages, canvas: initialCanvas }: CollectionLayoutProps) {
  const [canvas, setCanvas] = useState<CanvasData>(initialCanvas)
  const [drawerOpen, setDrawerOpen] = useState(true)
  // Deux projections du même modèle (comme l'étude d'une note) :
  // tri spatial (canvas) ⇄ document linéaire — base de la note de relecture
  const [view, setView] = useState<'canvas' | 'document'>('canvas')

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
        {view === 'canvas' ? (
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
        ) : (
          <DocumentView
            nodes={canvas.nodes}
            messages={messages}
            insetLeft={drawerOpen ? 284 : 64}
            onUpdateNode={handleUpdateNode}
          />
        )}
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
          {([
            { id: 'canvas' as const, Icon: Network, label: 'Canvas — tri spatial' },
            { id: 'document' as const, Icon: AlignLeft, label: 'Document — la collection triée, base de la relecture' },
          ]).map(({ id, Icon, label }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              title={label}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26, borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                background: view === id ? 'rgba(59,130,246,0.15)' : 'none',
                border: view === id ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
                color: view === id ? '#3b82f6' : 'var(--node-meta)',
              }}
            >
              <Icon size={13} />
            </button>
          ))}
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

      {/* ── Tiroir gauche : les notes membres de la collection ── */}
      {drawerOpen && (
        <div
          className="canvas-float-pill"
          style={{
            position: 'absolute', left: 14, top: 56, bottom: 96, zIndex: 30,
            width: 240, display: 'flex', flexDirection: 'column',
            overflow: 'hidden', padding: 0,
          }}
        >
          <p style={{ padding: '12px 14px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--node-meta)', borderBottom: '1px solid var(--float-border)' }}>
            Notes de la collection
          </p>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
            {memberNotes.map((n) => (
              <Link
                key={n.id}
                href={`/notes/${n.id}`}
                title="Ouvrir cette note seule"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px',
                  borderRadius: 8, textDecoration: 'none',
                }}
                className="hover:bg-black/5 dark:hover:bg-white/5"
              >
                {n.favicon
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={n.favicon} alt="" style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} />
                  : <span style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--node-border)', flexShrink: 0 }} />
                }
                <span style={{ fontSize: 12, color: 'var(--node-title)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {n.title}
                </span>
              </Link>
            ))}
            {memberNotes.length === 0 && (
              <p style={{ padding: 12, fontSize: 11, color: 'var(--node-meta)', textAlign: 'center' }}>
                Aucune note — regroupe des notes sur l'accueil puis « Mapper ».
              </p>
            )}
          </div>
        </div>
      )}
      <button
        onClick={() => setDrawerOpen(v => !v)}
        title={drawerOpen ? 'Réduire la liste des notes' : 'Rouvrir la liste des notes'}
        style={{
          position: 'absolute', left: drawerOpen ? 254 : 14, top: 100, zIndex: 35,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 36, padding: 0, cursor: 'pointer',
          background: 'var(--drawer-bg)', border: '1px solid var(--drawer-border)',
          borderLeft: drawerOpen ? 'none' : '1px solid var(--drawer-border)',
          borderRadius: drawerOpen ? '0 8px 8px 0' : '8px',
          boxShadow: 'var(--float-shadow)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          transition: 'left 0.25s ease',
        }}
      >
        {drawerOpen
          ? <ChevronLeft size={12} style={{ color: 'var(--drawer-icon)' }} />
          : <ChevronRight size={12} style={{ color: 'var(--drawer-icon)' }} />
        }
      </button>

      {/* Blocs disponibles — pill flottante en bas (tri spatial uniquement) */}
      {view === 'canvas' && <MessagePanel canvasId={canvas.id} messages={availableMessages as MessageData[]} />}
    </div>
  )
}
