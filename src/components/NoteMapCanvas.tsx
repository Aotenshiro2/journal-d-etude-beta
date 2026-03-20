'use client'

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
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
import {
  Sun, Moon, Map as MapIcon, Grid3x3, ChevronDown, ChevronLeft, ChevronRight,
  BookOpen, Lightbulb, TrendingUp, BookMarked, BarChart2, FileText,
  MousePointer2, Hand, Pencil, Square, ZoomIn, ZoomOut, Maximize2,
  Star,
} from 'lucide-react'
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

// ─── Tool type ────────────────────────────────────────────────────────────────

type Tool = 'select' | 'mark' | 'connect' | 'pan'

// ─── Modes ────────────────────────────────────────────────────────────────────

const MODES = [
  { label: 'Étudier mes notes',       href: '/',          Icon: BookOpen,   match: (p: string) => p === '/' || p.startsWith('/study') },
  { label: 'Observer les concepts',   href: '/concepts',  Icon: Lightbulb,  match: (p: string) => p === '/concepts' },
  { label: 'Étudier le Price Action', href: '/review',    Icon: TrendingUp, match: (p: string) => p === '/review' },
  { label: 'Documenter mes trades',   href: '/journal',   Icon: BookMarked, match: (p: string) => p === '/journal' },
  { label: 'Analyser mes données',    href: '/analytics', Icon: BarChart2,  match: (p: string) => p === '/analytics' },
]

// ─── Source badge ─────────────────────────────────────────────────────────────

function getSourceBadge(sourceUrl?: string | null): { label: string; color: string } | null {
  if (!sourceUrl) return null
  if (sourceUrl.includes('tradingview')) return { label: 'TradingView', color: '#26A69A' }
  if (sourceUrl.includes('topstep'))     return { label: 'TopStep',     color: '#4285F4' }
  if (sourceUrl.includes('youtube'))     return { label: 'YouTube',     color: '#EF4444' }
  if (sourceUrl.includes('skool'))       return { label: 'Skool',       color: '#6366F1' }
  if (sourceUrl.includes('simplefx') || sourceUrl.includes('trade')) return { label: 'Trading', color: '#F59E0B' }
  return null
}

// ─── Note card node ───────────────────────────────────────────────────────────

const NoteMapNode = React.memo(function NoteMapNode({ data }: NodeProps) {
  const router = useRouter()
  const { note, isExpanded } = data as { note: NoteData; isExpanded?: boolean }

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
        <div className="note-map-card">
          <Handle type="target" position={Position.Top}
            style={{ background: 'var(--node-handle)', opacity: 0, width: 8, height: 8, minWidth: 0, border: 'none' }}
            className="!transition-opacity group-hover:!opacity-100"
          />
          <Handle type="source" position={Position.Bottom}
            style={{ background: 'var(--node-handle)', opacity: 0, width: 8, height: 8, minWidth: 0, border: 'none' }}
            className="!transition-opacity group-hover:!opacity-100"
          />

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '14px 14px 8px', flexShrink: 0 }}>
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

          {/* Body — compact or expanded */}
          {isExpanded ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 14px' }}>
              <div
                className="note-content-preview"
                dangerouslySetInnerHTML={{ __html: note.content || '' }}
              />
            </div>
          ) : (
            preview && (
              <p style={{
                padding: '0 14px', fontSize: 11, color: 'var(--node-preview)',
                lineHeight: '1.6', flex: 1,
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>{preview}</p>
            )
          )}

          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', marginTop: 'auto', borderTop: '1px solid var(--node-border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {badge && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 100, background: `${badge.color}20`, color: badge.color }}>
                  {badge.label}
                </span>
              )}
              <span style={{ fontSize: 10, color: 'var(--node-meta)' }}>{relativeDate}</span>
            </div>
            <span style={{ fontSize: 10, color: 'var(--node-meta)' }}>
              {isExpanded ? '↙ réduire' : '↗ ouvrir'}
            </span>
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

// ─── Notes bubble (style Stitch "Agent log") ─────────────────────────────────

interface NotesBubbleProps {
  notes: NoteData[]
  onFocus: (noteId: string) => void
  onPreview: (noteId: string) => void
}

function NotesBubble({ notes, onFocus, onPreview }: NotesBubbleProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = useMemo(
    () => notes.filter(n => n.title.toLowerCase().includes(search.toLowerCase())),
    [notes, search]
  )

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="canvas-float-pill"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', cursor: 'pointer', border: 'none',
          color: 'var(--node-title)', fontSize: 12, fontWeight: 500,
        }}
      >
        <FileText size={13} style={{ color: 'var(--node-meta)' }} />
        <span>Notes · {notes.length}</span>
        <span style={{ color: 'var(--node-meta)', fontSize: 11 }}>→</span>
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div
            className="canvas-float-pill"
            style={{
              position: 'absolute', bottom: 42, left: 0, zIndex: 50,
              width: 280, maxHeight: 200, display: 'flex', flexDirection: 'column',
              overflow: 'hidden', padding: 0,
            }}
          >
            <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--float-border)', flexShrink: 0 }}>
              <input
                type="text" placeholder="Rechercher..."
                value={search} onChange={e => setSearch(e.target.value)}
                autoFocus
                style={{
                  width: '100%', background: 'var(--canvas-bg)',
                  border: '1px solid var(--node-border)', borderRadius: 7,
                  padding: '5px 10px', fontSize: 12,
                  color: 'var(--node-title)', outline: 'none',
                }}
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              {filtered.map(note => (
                <button key={note.id}
                  onClick={() => { onFocus(note.id); onPreview(note.id); setOpen(false) }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '7px 12px',
                    background: 'none', border: 'none', cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--canvas-bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
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
              {filtered.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--node-meta)', textAlign: 'center', paddingTop: 20 }}>Aucune note</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Note preview panel (left overlay) ───────────────────────────────────────

interface NotePreviewPanelProps {
  note: NoteData | undefined
}

function NotePreviewPanel({ note }: NotePreviewPanelProps) {
  if (!note) return null
  const badge = getSourceBadge(note.sourceUrl)

  return (
    <div
      className="canvas-float-pill"
      style={{
        position: 'absolute', left: 14, top: 56, bottom: 270, zIndex: 30,
        width: 300, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', padding: 0,
      }}
    >
      {/* Header */}
      <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--float-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {note.favicon
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={note.favicon} alt="" style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0 }} />
            : <div style={{ width: 16, height: 16, borderRadius: 3, background: 'var(--node-border)', flexShrink: 0 }} />
          }
          <span style={{
            fontSize: 13, fontWeight: 600, color: 'var(--node-title)', overflow: 'hidden',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {note.title}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          {badge && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 100, background: `${badge.color}20`, color: badge.color }}>
              {badge.label}
            </span>
          )}
          <span style={{ fontSize: 10, color: 'var(--node-meta)' }}>
            {formatRelativeTime(new Date(note.lastModifiedAt))}
          </span>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        <div
          className="note-preview-content"
          dangerouslySetInnerHTML={{ __html: note.content || '<p>Aucun contenu</p>' }}
        />
      </div>

      {/* Footer */}
      {note.sourceUrl && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--float-border)', flexShrink: 0 }}>
          <a
            href={note.sourceUrl} target="_blank" rel="noreferrer"
            style={{ fontSize: 11, color: '#3b82f6', textDecoration: 'none', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', display: 'block' }}
          >
            ↗ {note.sourceUrl}
          </a>
        </div>
      )}
    </div>
  )
}

// ─── Right toolbar ────────────────────────────────────────────────────────────

interface RightToolbarProps {
  activeTool: Tool
  setActiveTool: (t: Tool) => void
  isFav: boolean
  onToggleFav: () => void
}

function RightToolbar({ activeTool, setActiveTool, isFav, onToggleFav }: RightToolbarProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()

  const tools: { id: Tool; Icon: React.ElementType; label: string }[] = [
    { id: 'select',  Icon: MousePointer2, label: 'Sélectionner (V)' },
    { id: 'mark',    Icon: Square,        label: 'Sélection groupée (M)' },
    { id: 'connect', Icon: Pencil,        label: 'Connecter les cartes (E)' },
    { id: 'pan',     Icon: Hand,          label: 'Déplacer le canvas (H)' },
  ]

  const btnBase: React.CSSProperties = {
    width: 30, height: 30, borderRadius: 7,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'none', border: '1px solid transparent',
    cursor: 'pointer', color: 'var(--node-meta)',
  }

  const divider = <div style={{ height: 1, background: 'var(--float-border)', margin: '2px 0' }} />

  return (
    <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', zIndex: 20 }}>
      <div className="canvas-float-pill" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 4px' }}>

        {/* Tools */}
        {tools.map(tool => (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id)}
            title={tool.label}
            style={{
              ...btnBase,
              background: activeTool === tool.id ? 'rgba(59,130,246,0.15)' : 'none',
              border: activeTool === tool.id ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
              color: activeTool === tool.id ? '#3b82f6' : 'var(--node-meta)',
            }}
          >
            <tool.Icon size={14} />
          </button>
        ))}

        {divider}

        {/* Zoom controls */}
        {([
          { Icon: ZoomIn,    label: 'Zoom avant',    action: () => zoomIn({ duration: 200 }) },
          { Icon: ZoomOut,   label: 'Zoom arrière',  action: () => zoomOut({ duration: 200 }) },
          { Icon: Maximize2, label: 'Ajuster la vue', action: () => fitView({ duration: 400 }) },
        ] as { Icon: React.ElementType; label: string; action: () => void }[]).map(({ Icon, label, action }) => (
          <button key={label} onClick={action} title={label} style={btnBase}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--node-title)'; e.currentTarget.style.background = 'var(--canvas-bg)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--node-meta)'; e.currentTarget.style.background = 'none' }}
          >
            <Icon size={14} />
          </button>
        ))}

        {divider}

        {/* Favorite */}
        <button
          onClick={onToggleFav}
          title={isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          style={{ ...btnBase, color: isFav ? '#f59e0b' : 'var(--node-meta)' }}
          onMouseEnter={e => { if (!isFav) e.currentTarget.style.color = 'var(--node-title)' }}
          onMouseLeave={e => { if (!isFav) e.currentTarget.style.color = 'var(--node-meta)' }}
        >
          <Star size={14} fill={isFav ? '#f59e0b' : 'none'} />
        </button>

      </div>
    </div>
  )
}

// ─── Settings panel toggle ────────────────────────────────────────────────────

interface SettingsPanelProps {
  showGrid: boolean
  setShowGrid: (v: boolean) => void
  showMiniMap: boolean
  setShowMiniMap: (v: boolean) => void
}

function SettingsPanel({ showGrid, setShowGrid, showMiniMap, setShowMiniMap }: SettingsPanelProps) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  const activeMode = MODES.find(m => m.match(pathname)) ?? MODES[0]

  const canvasItems = [
    { label: 'Grille',     icon: <Grid3x3 size={13} />, value: showGrid,    toggle: () => setShowGrid(!showGrid) },
    { label: 'Mini-carte', icon: <MapIcon size={13} />,  value: showMiniMap, toggle: () => setShowMiniMap(!showMiniMap) },
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
        title="Changer de module"
      >
        <activeMode.Icon size={13} style={{ color: 'var(--node-meta)', flexShrink: 0 }} />
        <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
          {activeMode.label}
        </span>
        <ChevronDown size={11} style={{ color: 'var(--node-meta)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div
            className="canvas-float-pill"
            style={{ position: 'absolute', top: 42, left: 0, zIndex: 50, minWidth: 210, padding: '6px 0', overflow: 'hidden' }}
          >
            <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--node-meta)', padding: '4px 14px 6px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Modules
            </p>
            {MODES.map(mode => {
              const isActive = mode.match(pathname)
              return (
                <button
                  key={mode.href}
                  onClick={() => { router.push(mode.href); setOpen(false) }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 14px', background: isActive ? 'var(--canvas-bg)' : 'none',
                    border: 'none', cursor: 'pointer', color: 'var(--node-title)', fontSize: 12,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--canvas-bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = isActive ? 'var(--canvas-bg)' : 'none')}
                >
                  <mode.Icon size={13} style={{ color: isActive ? '#3b82f6' : 'var(--node-meta)', flexShrink: 0 }} />
                  <span style={{ flex: 1, textAlign: 'left', color: isActive ? 'var(--node-title)' : 'var(--node-preview)' }}>
                    {mode.label}
                  </span>
                  {isActive && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />}
                </button>
              )
            })}

            <div style={{ height: 1, background: 'var(--float-border)', margin: '6px 0' }} />

            <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--node-meta)', padding: '4px 14px 6px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Canvas
            </p>
            {canvasItems.map(item => (
              <button
                key={item.label}
                onClick={() => { item.toggle() }}
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
                <span style={{
                  width: 28, height: 16, borderRadius: 8, position: 'relative', flexShrink: 0,
                  background: item.value ? '#3b82f6' : 'var(--node-border)',
                  transition: 'background 0.15s', display: 'inline-block',
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

function NoteMapCanvasInner({ notes, canvas, user, title }: NoteMapCanvasProps) {
  const pathname = usePathname()
  const activeMode = MODES.find(m => m.match(pathname)) ?? MODES[0]
  const displayTitle = title ?? activeMode.label

  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [previewNoteId, setPreviewNoteId] = useState<string | null>(null)
  const [lastPreviewNoteId, setLastPreviewNoteId] = useState<string | null>(null)
  const [favNoteIds, setFavNoteIds] = useState<Set<string>>(new Set())

  const openPreview = useCallback((id: string) => {
    setPreviewNoteId(id)
    setLastPreviewNoteId(id)
  }, [])
  const closePreview = useCallback(() => {
    if (previewNoteId) setLastPreviewNoteId(previewNoteId)
    setPreviewNoteId(null)
  }, [previewNoteId])
  const togglePreview = useCallback(() => {
    if (previewNoteId) {
      closePreview()
    } else if (lastPreviewNoteId) {
      openPreview(lastPreviewNoteId)
    }
  }, [previewNoteId, lastPreviewNoteId, openPreview, closePreview])
  const singleClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [spacePressed, setSpacePressed] = useState(false)
  const [showMiniMap, setShowMiniMap] = useState(false)
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
      const tag = (e.target as HTMLElement).tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA'

      if (e.code === 'Space' && !isInput) {
        e.preventDefault()
        setSpacePressed(true)
      }

      if (!isInput) {
        if (e.key === 'v' || e.key === 'V') setActiveTool('select')
        if (e.key === 'm' || e.key === 'M') setActiveTool('mark')
        if (e.key === 'e' || e.key === 'E') setActiveTool('connect')
        if (e.key === 'h' || e.key === 'H') setActiveTool('pan')
        if (e.key === 'Escape') closePreview()
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
      data: { note, isExpanded: false },
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

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const handleExpandNode = useCallback((nodeId: string) => {
    setNodes(nds => nds.map(n => {
      if (n.id !== nodeId) return n
      const wasExpanded = !!(n.data as { isExpanded?: boolean }).isExpanded
      return {
        ...n,
        style: wasExpanded ? { width: 260, height: 152 } : { width: 300, height: 500 },
        data: { ...n.data, isExpanded: !wasExpanded },
      }
    }))
  }, [setNodes])

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (singleClickTimerRef.current) clearTimeout(singleClickTimerRef.current)
    singleClickTimerRef.current = setTimeout(() => {
      openPreview(node.id)
    }, 220)
  }, [])

  const handleNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (singleClickTimerRef.current) {
      clearTimeout(singleClickTimerRef.current)
      singleClickTimerRef.current = null
    }
    handleExpandNode(node.id)
  }, [handleExpandNode])

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

  // Tool → ReactFlow props mapping
  const toolProps = {
    select:  { panOnDrag: false as const, selectionOnDrag: true,  nodesConnectable: false, nodesDraggable: true,  selectionMode: SelectionMode.Partial },
    mark:    { panOnDrag: false as const, selectionOnDrag: true,  nodesConnectable: false, nodesDraggable: true,  selectionMode: SelectionMode.Full    },
    connect: { panOnDrag: false as const, selectionOnDrag: false, nodesConnectable: true,  nodesDraggable: false, selectionMode: SelectionMode.Partial },
    pan:     { panOnDrag: true  as const, selectionOnDrag: false, nodesConnectable: false, nodesDraggable: false, selectionMode: SelectionMode.Partial },
  }

  const previewNote = previewNoteId ? notes.find(n => n.id === previewNoteId) : undefined

  return (
    <div className="flex h-full overflow-hidden relative" style={{ background: 'var(--canvas-bg)' }}>

      {/* ── Canvas ── */}
      <div ref={canvasRef} className="canvas-root" style={{ cursor: spacePressed ? 'grab' : activeTool === 'pan' ? 'grab' : 'default' }}>

        {/* Dot grid */}
        {showGrid && <div className="canvas-grid" style={dotBgStyle} />}
        {showGrid && <div ref={spotlightRef} className="canvas-dot-spotlight" style={dotBgStyle} />}

        {/* Top gradient */}
        <div className="canvas-top-gradient" />

        {/* ── Top-left — module switcher + titre ── */}
        <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <SettingsPanel
            showGrid={showGrid} setShowGrid={setShowGrid}
            showMiniMap={showMiniMap} setShowMiniMap={setShowMiniMap}
          />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--node-title)', letterSpacing: '-0.02em', textShadow: '0 1px 3px rgba(0,0,0,0.12)' }}>
            {displayTitle}
          </span>
        </div>

        {/* ── Top-right — avatar ── */}
        {user && (
          <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 20 }}>
            <AvatarBubble user={user} />
          </div>
        )}

        {/* ── Note preview panel (left overlay) ── */}
        <NotePreviewPanel note={previewNote} />

        {/* ── Drawer handle — ouvrir/fermer le panel ── */}
        {lastPreviewNoteId !== null && (
          <button
            onClick={togglePreview}
            title={previewNoteId ? 'Réduire la note' : 'Rouvrir la note'}
            style={{
              position: 'absolute',
              left: previewNoteId ? 314 : 14,
              top: 100,
              zIndex: 35,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 20, height: 36,
              padding: 0,
              cursor: 'pointer',
              background: 'var(--drawer-bg)',
              border: '1px solid var(--drawer-border)',
              borderLeft: previewNoteId ? 'none' : '1px solid var(--drawer-border)',
              borderRadius: previewNoteId ? '0 8px 8px 0' : '8px',
              boxShadow: 'var(--float-shadow)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              transition: 'left 0.25s ease',
            }}
          >
            {previewNoteId
              ? <ChevronLeft size={12} style={{ color: 'var(--drawer-icon)' }} />
              : <ChevronRight size={12} style={{ color: 'var(--drawer-icon)' }} />
            }
          </button>
        )}

        {/* ── Right toolbar ── */}
        <RightToolbar
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          isFav={previewNoteId ? favNoteIds.has(previewNoteId) : false}
          onToggleFav={() => {
            if (!previewNoteId) return
            setFavNoteIds(s => {
              const next = new Set(s)
              next.has(previewNoteId) ? next.delete(previewNoteId) : next.add(previewNoteId)
              return next
            })
          }}
        />

        {/* ── Bottom-left — notes bubble ── */}
        <div style={{ position: 'absolute', bottom: 16, left: 14, zIndex: 20 }}>
          <NotesBubble notes={notes} onFocus={focusNote} onPreview={openPreview} />
        </div>

        {/* ── Bottom-right — theme + nav ── */}
        <div style={{ position: 'absolute', bottom: showMiniMap ? 168 : 16, right: 14, zIndex: 20 }}>
          <div className="canvas-float-pill" style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 8px' }}>
            <ThemeToggleInline />
            <div style={{ width: 1, height: 16, background: 'var(--float-border)', margin: '0 4px' }} />
            {[
              { href: '/study',    label: 'Vue liste' },
              { href: '/concepts', label: 'Concepts' },
              { href: '/guide',    label: 'Guide' },
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

        {/* ── ReactFlow ── */}
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onNodeDragStop={handleNodeDragStop}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          nodeTypes={nodeTypes}
          fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
          minZoom={0.08} maxZoom={2.5} deleteKeyCode={null}
          panOnScroll panOnScrollMode={PanOnScrollMode.Vertical}
          zoomOnScroll={false} zoomActivationKeyCode="Control"
          panActivationKeyCode="Space"
          onlyRenderVisibleElements proOptions={{ hideAttribution: true }}
          style={{ background: 'transparent', position: 'relative', zIndex: 2 }}
          {...toolProps[activeTool]}
        >
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
