'use client'

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
  PanOnScrollMode,
  SelectionMode,
  useViewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Sun, Moon, Map as MapIcon, Grid3x3, PanelLeft, ChevronDown } from 'lucide-react'
import { NoteData, CanvasData } from '@/types'
import { stripHtml, formatRelativeTime } from '@/lib/utils'
import { useTheme } from '@/contexts/ThemeContext'
import { createClient } from '@/lib/supabase/client'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

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
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          className="note-map-card"
          onDoubleClick={() => router.push(`/study/${note.id}`)}
        >
          <Handle type="target" position={Position.Top}
            style={{ background: 'var(--node-handle)', opacity: 0, width: 8, height: 8, minWidth: 0, border: 'none' }}
            className="!transition-opacity group-hover:!opacity-100"
          />
          <Handle type="source" position={Position.Bottom}
            style={{ background: 'var(--node-handle)', opacity: 0, width: 8, height: 8, minWidth: 0, border: 'none' }}
            className="!transition-opacity group-hover:!opacity-100"
          />

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '14px 14px 8px' }}>
            {note.favicon
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={note.favicon} alt="" style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0, marginTop: 2 }} />
              : <div style={{ width: 16, height: 16, borderRadius: 3, background: 'var(--node-border)', flexShrink: 0, marginTop: 2 }} />
            }
            <TooltipProvider delay={700}>
              <Tooltip>
                <TooltipTrigger render={<span style={{
                  fontSize: 13, fontWeight: 600, color: 'var(--node-title)', lineHeight: '1.3',
                  flex: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }} />}>
                  {note.title}
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p className="text-xs font-medium">{note.title}</p>
                  {note.sourceUrl && <p className="text-[10px] opacity-60 truncate mt-0.5">{note.sourceUrl}</p>}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Preview */}
          {preview && (
            <p style={{
              padding: '0 14px', fontSize: 11, color: 'var(--node-preview)',
              lineHeight: '1.6', flex: 1,
              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{preview}</p>
          )}

          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', marginTop: 'auto', borderTop: '1px solid var(--node-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {badge && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 100, background: `${badge.color}20`, color: badge.color }}>
                  {badge.label}
                </span>
              )}
              <span style={{ fontSize: 10, color: 'var(--node-meta)' }}>{relativeDate}</span>
            </div>
            <span style={{ fontSize: 10, color: 'var(--node-meta)' }}>↗ ouvrir</span>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => router.push(`/study/${note.id}`)}>↗ Ouvrir la note</ContextMenuItem>
        {note.sourceUrl && (
          <ContextMenuItem onClick={() => window.open(note.sourceUrl!, '_blank')}>🔗 Source originale</ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => navigator.clipboard.writeText(note.title)}>Copier le titre</ContextMenuItem>
        {note.sourceUrl && (
          <ContextMenuItem onClick={() => navigator.clipboard.writeText(note.sourceUrl!)}>Copier le lien</ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
})

const nodeTypes = { noteMap: NoteMapNode }

function autoPosition(index: number): { x: number; y: number } {
  const cols = 4
  const colW = 310
  const rowH = 210
  return { x: (index % cols) * colW + 60, y: Math.floor(index / cols) * rowH + 60 }
}

// ─── Avatar bubble (Google-style) ────────────────────────────────────────────

function AvatarBubble({ user }: { user: { email: string; name: string; avatarUrl?: string } }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth')
    router.refresh()
  }

  const initials = user.name
    ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : user.email?.[0]?.toUpperCase() ?? 'U'

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: 34, height: 34, borderRadius: '50%',
          overflow: 'hidden', border: '2px solid var(--float-border)',
          boxShadow: 'var(--float-shadow)', cursor: 'pointer',
          background: 'var(--float-bg)', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        title={user.name || user.email}
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--node-title)', letterSpacing: '-0.02em' }}>
            {initials}
          </span>
        )}
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div
            className="canvas-float-pill"
            style={{ position: 'absolute', right: 0, top: 42, zIndex: 50, minWidth: 200, overflow: 'hidden' }}
          >
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--float-border)' }}>
              {user.name && <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--node-title)', marginBottom: 2 }}>{user.name}</p>}
              <p style={{ fontSize: 11, color: 'var(--node-meta)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              style={{ width: '100%', textAlign: 'left', padding: '9px 14px', fontSize: 13, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              Se déconnecter
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Settings panel toggle ────────────────────────────────────────────────────

interface SettingsPanelProps {
  showGrid: boolean
  setShowGrid: (v: boolean) => void
  showMiniMap: boolean
  setShowMiniMap: (v: boolean) => void
  leftOpen: boolean
  setLeftOpen: (v: boolean) => void
}

function SettingsPanel({ showGrid, setShowGrid, showMiniMap, setShowMiniMap, leftOpen, setLeftOpen }: SettingsPanelProps) {
  const [open, setOpen] = useState(false)

  const items = [
    { label: 'Panneau notes', icon: <PanelLeft size={13} />, value: leftOpen, toggle: () => setLeftOpen(!leftOpen) },
    { label: 'Grille', icon: <Grid3x3 size={13} />, value: showGrid, toggle: () => setShowGrid(!showGrid) },
    { label: 'Mini-carte', icon: <MapIcon size={13} />, value: showMiniMap, toggle: () => setShowMiniMap(!showMiniMap) },
  ]

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="canvas-float-pill"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 10px', cursor: 'pointer', border: 'none',
          color: 'var(--node-title)', fontSize: 12, fontWeight: 500,
        }}
        title="Paramètres du canvas"
      >
        <Grid3x3 size={13} style={{ color: 'var(--node-meta)' }} />
        <ChevronDown size={11} style={{ color: 'var(--node-meta)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div
            className="canvas-float-pill"
            style={{ position: 'absolute', top: 42, left: 0, zIndex: 50, minWidth: 180, padding: '6px 0', overflow: 'hidden' }}
          >
            {items.map(item => (
              <button
                key={item.label}
                onClick={() => { item.toggle(); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--node-title)', fontSize: 12,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--canvas-bg)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--node-preview)' }}>
                  {item.icon}
                  {item.label}
                </span>
                {/* Toggle pill */}
                <span style={{
                  width: 28, height: 16, borderRadius: 8, position: 'relative', flexShrink: 0,
                  background: item.value ? '#3b82f6' : 'var(--node-border)',
                  transition: 'background 0.15s',
                  display: 'inline-block',
                }}>
                  <span style={{
                    position: 'absolute', top: 2, left: item.value ? 14 : 2,
                    width: 12, height: 12, borderRadius: '50%',
                    background: '#fff', transition: 'left 0.15s',
                  }} />
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Theme toggle inline ──────────────────────────────────────────────────────

function ThemeToggleInline() {
  const { theme, toggleTheme } = useTheme()
  return (
    <button
      onClick={toggleTheme}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 30, borderRadius: 8, background: 'none', border: 'none',
        cursor: 'pointer', color: 'var(--node-meta)',
      }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--node-title)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'var(--node-meta)')}
      title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
    >
      {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  )
}

// ─── Canvas inner ─────────────────────────────────────────────────────────────

interface NoteMapCanvasProps {
  notes: NoteData[]
  canvas: CanvasData
  user?: { email: string; name: string; avatarUrl?: string }
  title?: string
}

function NoteMapCanvasInner({ notes, canvas, user, title = "Journal d'Études" }: NoteMapCanvasProps) {
  const [leftOpen, setLeftOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [spacePressed, setSpacePressed] = useState(false)
  const [showMiniMap, setShowMiniMap] = useState(true)
  const [showGrid, setShowGrid] = useState(true)
  const { setCenter } = useReactFlow()
  const { x: vpX, y: vpY, zoom } = useViewport()

  const dotSize = 22 * zoom
  const dotPosX = ((vpX % dotSize) + dotSize) % dotSize
  const dotPosY = ((vpY % dotSize) + dotSize) % dotSize
  const dotBgStyle = {
    backgroundSize: `${dotSize}px ${dotSize}px`,
    backgroundPosition: `${dotPosX}px ${dotPosY}px`,
  }

  const canvasRef = useRef<HTMLDivElement>(null)
  const spotlightRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const spotlight = spotlightRef.current
    const onMove = (e: MouseEvent) => {
      if (!spotlight) return
      const rect = el.getBoundingClientRect()
      spotlight.style.setProperty('--mx', `${e.clientX - rect.left}px`)
      spotlight.style.setProperty('--my', `${e.clientY - rect.top}px`)
      spotlight.style.opacity = '1'
    }
    const onLeave = () => { if (spotlight) spotlight.style.opacity = '0' }
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
        e.preventDefault()
        setSpacePressed(true)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') setSpacePressed(false) }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  }, [])

  const savedNodeRef = useRef(new Map() as Map<string, string>)
  useMemo(() => { canvas.nodes.forEach(n => { if (n.noteId) savedNodeRef.current.set(n.noteId, n.id) }) }, [canvas.nodes])

  type PosMap = Map<string, {x: number; y: number}>
  const savedPositions = useMemo(() => {
    const map: PosMap = new Map()
    canvas.nodes.forEach(n => { if (n.noteId) map.set(n.noteId, { x: n.x, y: n.y }) })
    return map
  }, [canvas.nodes])

  const initialNodes: Node[] = useMemo(() =>
    notes.map((note, i) => ({
      id: note.id, type: 'noteMap',
      position: savedPositions.get(note.id) ?? autoPosition(i),
      style: { width: 260, height: 152 },
      data: { note },
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const initialEdges: Edge[] = useMemo(() =>
    canvas.edges.map(e => ({
      id: e.id, source: e.fromId, target: e.toId, type: 'smoothstep',
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
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
      })
    } else {
      const res = await fetch(`/api/canvas/${canvas.id}/nodes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: node.id, x, y }),
      })
      if (res.ok) { const data = await res.json(); savedNodeRef.current.set(node.id, data.id) }
    }
  }, [canvas.id])

  const onConnect = useCallback(async (params: Connection) => {
    setEdges(eds => addEdge({ ...params, type: 'smoothstep', style: { stroke: '#3b82f6', strokeWidth: 1.5, opacity: 0.5 } }, eds))
    if (params.source && params.target) {
      await fetch(`/api/canvas/${canvas.id}/edges`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromId: params.source, toId: params.target }),
      })
    }
  }, [setEdges, canvas.id])

  const focusNote = useCallback((noteId: string) => {
    const node = nodes.find(n => n.id === noteId)
    if (node) setCenter(node.position.x + 130, node.position.y + 76, { zoom: 1.1, duration: 600 })
  }, [nodes, setCenter])

  const filteredNotes = useMemo(() =>
    notes.filter(n => n.title.toLowerCase().includes(search.toLowerCase())),
    [notes, search]
  )

  return (
    <div className="flex flex-1 overflow-hidden relative" style={{ background: 'var(--canvas-bg)' }}>

      {/* ── Left panel ── */}
      <div
        className="flex-shrink-0 flex flex-col overflow-hidden"
        style={{
          width: leftOpen ? 256 : 0, minWidth: leftOpen ? 256 : 0,
          transition: 'width 0.2s ease',
          background: 'var(--node-bg)', borderRight: '1px solid var(--node-border)',
          zIndex: 5,
        }}
      >
        <div style={{ padding: '52px 12px 12px', borderBottom: '1px solid var(--node-border)', flexShrink: 0 }}>
          <input
            type="text" placeholder="Rechercher..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', background: 'var(--canvas-bg)', border: '1px solid var(--node-border)',
              borderRadius: 8, padding: '6px 12px', fontSize: 13, color: 'var(--node-title)', outline: 'none',
            }}
          />
          <p style={{ fontSize: 10, color: 'var(--node-meta)', marginTop: 8, paddingLeft: 2 }}>
            {notes.length} note{notes.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {filteredNotes.map(note => (
            <button key={note.id} onClick={() => focusNote(note.id)}
              style={{ width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 10, background: 'transparent', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--canvas-bg)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {note.favicon
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={note.favicon} alt="" style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} />
                  : <div style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--node-border)', flexShrink: 0 }} />
                }
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

      {/* ── Canvas ── */}
      <div ref={canvasRef} className="canvas-root" style={{ cursor: spacePressed ? 'grab' : 'default' }}>

        {/* Dot grid */}
        {showGrid && <div className="canvas-grid" style={dotBgStyle} />}
        {showGrid && <div ref={spotlightRef} className="canvas-dot-spotlight" style={dotBgStyle} />}

        {/* Top gradient (remplace le header) */}
        <div className="canvas-top-gradient" />

        {/* ── Floating panel : top-left — titre + settings ── */}
        <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--node-title)', letterSpacing: '-0.02em', textShadow: '0 1px 3px rgba(0,0,0,0.12)' }}>
            {title}
          </span>
          <SettingsPanel
            showGrid={showGrid} setShowGrid={setShowGrid}
            showMiniMap={showMiniMap} setShowMiniMap={setShowMiniMap}
            leftOpen={leftOpen} setLeftOpen={setLeftOpen}
          />
        </div>

        {/* ── Floating panel : top-right — avatar Google ── */}
        {user && (
          <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 20 }}>
            <AvatarBubble user={user} />
          </div>
        )}

        {/* ── Floating panel : bottom-center — theme + nav ── */}
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}>
          <div className="canvas-float-pill" style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 8px' }}>
            <ThemeToggleInline />
            <div style={{ width: 1, height: 16, background: 'var(--float-border)', margin: '0 4px' }} />
            {[
              { href: '/study', label: 'Vue liste' },
              { href: '/concepts', label: 'Concepts' },
              { href: '/guide', label: 'Guide' },
            ].map(({ href, label }) => (
              <Link key={href} href={href}
                style={{ fontSize: 12, color: 'var(--node-meta)', padding: '4px 8px', borderRadius: 6, textDecoration: 'none', display: 'block' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--node-title)'; (e.currentTarget as HTMLElement).style.background = 'var(--canvas-bg)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--node-meta)'; (e.currentTarget as HTMLElement).style.background = 'none' }}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        {/* ── Left panel edge toggle ── */}
        <button
          onClick={() => setLeftOpen(o => !o)}
          className="absolute top-4 z-20 w-5 h-8 rounded-r-lg flex items-center justify-center transition-colors"
          style={{ left: 0, background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-meta)' }}
          title={leftOpen ? 'Fermer le panneau' : 'Ouvrir le panneau'}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d={leftOpen ? 'M6 2L4 5L6 8' : 'M4 2L6 5L4 8'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* ── ReactFlow ── */}
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onNodeDragStop={handleNodeDragStop}
          nodeTypes={nodeTypes}
          fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
          minZoom={0.08} maxZoom={2.5} deleteKeyCode={null}
          panOnScroll panOnScrollMode={PanOnScrollMode.Vertical}
          zoomOnScroll={false} zoomActivationKeyCode="Control"
          panActivationKeyCode="Space" panOnDrag={false}
          selectionOnDrag selectionMode={SelectionMode.Partial}
          onlyRenderVisibleElements proOptions={{ hideAttribution: true }}
          style={{ background: 'transparent', position: 'relative', zIndex: 2 }}
        >
          <Controls style={{
            background: 'var(--float-bg)', border: '1px solid var(--float-border)',
            borderRadius: 10, boxShadow: 'var(--float-shadow)',
            backdropFilter: 'blur(12px)',
          }} />
          {showMiniMap && (
            <MiniMap nodeColor="var(--node-border)" maskColor="rgba(0,0,0,0.12)"
              style={{ background: 'var(--float-bg)', border: '1px solid var(--float-border)', borderRadius: 12, backdropFilter: 'blur(12px)' }}
            />
          )}
        </ReactFlow>
      </div>
    </div>
  )
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function NoteMapCanvas(props: NoteMapCanvasProps) {
  return (
    <ReactFlowProvider>
      <NoteMapCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
