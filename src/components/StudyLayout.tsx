'use client'

import { useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Network, AlignLeft, RotateCcw } from 'lucide-react'
import NoteReader from './NoteReader'
import StudyCanvas, { TradeMeta } from './StudyCanvas'
import DocumentView from './DocumentView'
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
  // Deux projections du même modèle : tri spatial (canvas) ⇄ note linéaire (document)
  const [view, setView] = useState<'canvas' | 'document'>('canvas')

  // Métadonnées des trades (index, résultat, heure, note A/B/C) indexées par id de trade,
  // pour signaler « ceci est un trade » sur chaque bloc concerné (canvas + panneau bas).
  const tradeMeta = useMemo<Record<string, TradeMeta>>(() => {
    const map: Record<string, TradeMeta> = {}
    const gradeByTrade = new Map<string, string>()
    for (const a of note.annotations ?? []) {
      if (a.tradeRef) gradeByTrade.set(a.tradeRef, a.grade)
    }
    ;(note.trades ?? []).forEach((t, i) => {
      map[t.id] = { index: i + 1, outcome: t.outcome ?? null, startedAt: t.startedAt ?? null, grade: gradeByTrade.get(t.id) ?? null }
    })
    return map
  }, [note.trades, note.annotations])

  // Messages not yet placed on canvas — les blocs 'meta' (date/titre/URL de
  // capture) sont exclus : une métadonnée ne se travaille pas sur le canvas
  const placedMessageIds = new Set(
    canvas.nodes.filter((n) => n.messageId).map((n) => n.messageId as string)
  )
  const availableMessages = note.messages?.filter((m) => m.type !== 'meta' && !placedMessageIds.has(m.id)) ?? []

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

  // Promouvoir le nom d'un groupe en tag de la taxonomie (proto-concept → concept).
  // 0.1.3 « le nom sert » : les blocs du groupe portent le concept (MessageTag) —
  // le regroupement spatial devient de la donnée pour /concepts.
  const handlePromoteGroupTag = useCallback(async (label: string, groupId: string): Promise<boolean> => {
    const messageIds = canvas.nodes
      .filter((n) => n.parentId === groupId && n.messageId)
      .map((n) => n.messageId as string)
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: label, messageIds }),
    })
    return res.ok
  }, [canvas.nodes])

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

  // Remettre le canvas à zéro — si on n'est pas satisfait de sa réorganisation.
  // Les blocs reviennent dans la liste du bas ; l'original n'est pas touché.
  const handleResetCanvas = useCallback(async () => {
    if (!window.confirm('Remettre ce canvas à zéro ?\n\nLes blocs reviennent dans la liste du bas, les groupes et textes libres sont supprimés. Ta note d\'origine n\'est pas touchée.')) return
    const res = await fetch(`/api/canvas/${canvas.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true }),
    })
    if (res.ok) setCanvas((prev) => ({ ...prev, nodes: [], edges: [] }))
  }, [canvas.id])

  const handleDismissDivergence = useCallback(async () => {
    await fetch(`/api/canvas/${canvas.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteContentHash: note.contentHash }),
    })
  }, [canvas.id, note.contentHash])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--canvas-bg)', overflow: 'hidden' }}>
      {/* ── Canvas ou document, plein cadre ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex' }}>
        {view === 'canvas' ? (
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
            tradeMeta={tradeMeta}
          />
        ) : (
          <DocumentView
            nodes={canvas.nodes}
            messages={note.messages ?? []}
            insetLeft={drawerOpen ? 344 : 64}
            tradeMeta={tradeMeta}
            onUpdateNode={handleUpdateNode}
          />
        )}
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
          <div style={{ width: 1, height: 16, background: 'var(--float-border)', flexShrink: 0 }} />
          {([
            { id: 'canvas' as const, Icon: Network, label: 'Canvas — tri spatial' },
            { id: 'document' as const, Icon: AlignLeft, label: 'Document — ta note triée, réordonnable' },
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
            title="Remettre ce canvas à zéro (les blocs reviennent dans la liste, groupes supprimés)"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, borderRadius: 6, cursor: 'pointer', flexShrink: 0,
              background: 'none', border: '1px solid transparent', color: 'var(--node-meta)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'var(--canvas-bg)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--node-meta)'; e.currentTarget.style.background = 'none' }}
          >
            <RotateCcw size={13} />
          </button>
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

      {/* ── Blocs disponibles — pill flottante en bas (tri spatial uniquement) ── */}
      {view === 'canvas' && <MessagePanel canvasId={canvas.id} messages={availableMessages} tradeMeta={tradeMeta} />}
    </div>
  )
}
