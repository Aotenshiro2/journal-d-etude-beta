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
  Panel,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Sun, Moon, Map as MapIcon, Grid3x3, ChevronDown, ChevronLeft, ChevronRight,
  BookOpen, Lightbulb, BookMarked, BarChart2, FileText,
  MousePointer2, Hand, Pencil, Square, ZoomIn, ZoomOut, Maximize2,
  Star, FolderPlus, Compass, Sunrise, Layers, Eye, EyeOff,
} from 'lucide-react'
import { NoteData, CanvasData, MessageData } from '@/types'
import { GroupNode, GROUP_COLORS, sortParentsFirst, type GroupHandlers } from './StudyCanvas'
import CaptureBar from '@/components/CaptureBar'
import ImageLightbox from '@/components/ImageLightbox'
import { stripHtml, formatRelativeTime, extractImageSrc } from '@/lib/utils'
import { useTheme } from '@/contexts/ThemeContext'
import { useShowMeta } from '@/hooks/useShowMeta'
import { renderWikilinks } from '@/lib/wikilinks'
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

// Le menu dépliant = les ESPACES (pour garder l'écran épuré). Les actions rapides du
// flux (Relire, Notes, Guide) vivent en bas-droite, pas ici.
const MODES = [
  { label: 'Étudier mes notes',     href: '/',          Icon: BookOpen,   match: (p: string) => p === '/' || p.startsWith('/study') || p.startsWith('/notes') },
  { label: 'Observer les concepts', href: '/concepts',  Icon: Lightbulb,  match: (p: string) => p === '/concepts' },
  { label: 'Analyser mes données',  href: '/analytics', Icon: BarChart2,  match: (p: string) => p === '/analytics' },
  { label: 'Pattern Maps',          href: '/patterns',  Icon: Compass,    match: (p: string) => p === '/patterns' },
  { label: 'Carte A/B/C-game',      href: '/game',      Icon: Layers,     match: (p: string) => p === '/game' },
  { label: 'Rituel de séance',      href: '/session',   Icon: Sunrise,    match: (p: string) => p === '/session' },
  { label: 'Documenter mes trades', href: '/journal',   Icon: BookMarked, match: (p: string) => p === '/journal' },
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

const NoteMapNode = React.memo(function NoteMapNode({ id, data }: NodeProps) {
  const router = useRouter()
  const { setNodes } = useReactFlow()
  const { note, dbNodeId, canvasId } = data as { note: NoteData; dbNodeId?: string; canvasId?: string }
  const [hovered, setHovered] = useState(false)

  const handleRemove = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!dbNodeId || !canvasId) return
    await fetch(`/api/canvas/${canvasId}/nodes/${dbNodeId}`, { method: 'DELETE' })
    setNodes(nds => nds.filter(n => n.id !== id))
  }, [id, dbNodeId, canvasId, setNodes])

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
          style={{ position: 'relative' }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* Remove from canvas button */}
          {dbNodeId && hovered && (
            <button
              onClick={handleRemove}
              title="Retirer du canvas"
              style={{
                position: 'absolute', top: 6, right: 6, zIndex: 10,
                width: 18, height: 18, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(239,68,68,0.85)', border: 'none',
                cursor: 'pointer', color: '#fff', fontSize: 13, lineHeight: 1,
                padding: 0,
              }}
            >×</button>
          )}
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

          {/* Body — aperçu compact (le double-clic OUVRE la note, il ne déplie plus) */}
          {preview && (
            <p style={{
              padding: '0 14px', fontSize: 11, color: 'var(--node-preview)',
              lineHeight: '1.6', flex: 1,
              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{preview}</p>
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
            <button
              onClick={(e) => { e.stopPropagation(); router.push(`/notes/${note.id}`) }}
              title="Ouvrir la note (ou double-clic sur la carte)"
              style={{
                fontSize: 10, color: 'var(--node-meta)', background: 'none',
                border: '1px solid transparent', borderRadius: 6, padding: '2px 6px',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#3b82f6'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.35)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--node-meta)'; e.currentTarget.style.borderColor = 'transparent' }}
            >
              ↗ ouvrir
            </button>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => router.push(`/notes/${note.id}`)}>↗ Ouvrir la note</ContextMenuItem>
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

const nodeTypes = { noteMap: NoteMapNode, group: GroupNode }
const GROUP_COLOR_KEYS = Object.keys(GROUP_COLORS)

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
  pinnedNoteIds: Set<string>
  onFocus: (noteId: string) => void
  onPreview: (noteId: string) => void
  dropCounter: number
}

function NotesBubble({ notes, pinnedNoteIds, onFocus, onPreview, dropCounter }: NotesBubbleProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (dropCounter > 0) setOpen(false)
  }, [dropCounter])

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
              {filtered.map(note => {
                const isPinned = pinnedNoteIds.has(note.id)
                return (
                <div
                  key={note.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('noteId', note.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  style={{ position: 'relative' }}
                >
                  <button
                    onClick={() => { onFocus(note.id); onPreview(note.id); setOpen(false) }}
                    style={{
                      width: '100%', textAlign: 'left', padding: '7px 12px',
                      background: 'none', border: 'none', cursor: 'grab',
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
                      <span style={{ fontSize: 12, color: 'var(--node-preview)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 1 }}>
                        {note.title}
                      </span>
                      {isPinned && (
                        <span style={{ fontSize: 9, color: '#3b82f6', flexShrink: 0 }}>●</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--node-meta)', marginTop: 2, paddingLeft: 22 }}>
                      {formatRelativeTime(new Date(note.lastModifiedAt))}
                    </div>
                  </button>
                </div>
                )
              })}
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

// ─── Note content renderer (messages-first, content fallback) ────────────────

const IMAGE_TYPES = new Set(['image', 'screenshot', 'capture'])

function NoteContentRenderer({ note, className, onImageClick, showMeta = false }: { note: NoteData; className: string; onImageClick?: (src: string) => void; showMeta?: boolean }) {
  // Délégation : images → lightbox, pastilles [[concept]] → /concepts
  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (onImageClick && target instanceof HTMLImageElement && target.src) { onImageClick(target.src); return }
    if (target.classList.contains('wikilink')) window.location.assign('/concepts')
  }
  if (note.messages && note.messages.length > 0) {
    return (
      <div className={className} onClick={handleClick}>
        {note.messages.map(msg => {
          // Bloc 'meta' (date/titre/URL de capture) : masqué par défaut, jamais du contenu
          if (msg.type === 'meta') {
            return showMeta ? (
              <p key={msg.id} style={{ fontSize: 10, fontStyle: 'italic', color: 'var(--node-meta)', opacity: 0.7, margin: '4px 0', wordBreak: 'break-all' }}>
                {msg.content}
              </p>
            ) : null
          }
          return IMAGE_TYPES.has(msg.type)
            ? <img key={msg.id} src={extractImageSrc(msg.content) ?? msg.content} alt="" style={{ maxWidth: '100%', borderRadius: 6, margin: '6px 0', display: 'block', cursor: onImageClick ? 'zoom-in' : undefined }} />
            : <div key={msg.id} dangerouslySetInnerHTML={{ __html: renderWikilinks(msg.content) }} />
        })}
      </div>
    )
  }
  return <div className={className} onClick={handleClick} dangerouslySetInnerHTML={{ __html: renderWikilinks(note.content || '<p>Aucun contenu</p>') }} />
}

// ─── Note preview panel (left overlay) ───────────────────────────────────────

interface NotePreviewPanelProps {
  note: NoteData | undefined
  refreshTrigger: number
}

function NotePreviewPanel({ note, refreshTrigger }: NotePreviewPanelProps) {
  const [fetchedMessages, setFetchedMessages] = useState<MessageData[] | null>(null)
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)
  const [showMeta, toggleShowMeta] = useShowMeta()

  useEffect(() => {
    if (!note) { setFetchedMessages(null); return }
    fetch(`/api/notes/${note.id}/messages`)
      .then(r => r.ok ? r.json() : null)
      .then(setFetchedMessages)
      .catch(() => setFetchedMessages(null))
  }, [note?.id, refreshTrigger])

  if (!note) return null
  const displayNote: NoteData = fetchedMessages ? { ...note, messages: fetchedMessages } : note
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
          <span style={{ flex: 1 }} />
          <button
            onClick={toggleShowMeta}
            title={showMeta ? 'Masquer les métadonnées de capture' : 'Afficher les métadonnées de capture (date, page, URL)'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, borderRadius: 6, cursor: 'pointer', padding: 0,
              background: showMeta ? 'rgba(59,130,246,0.12)' : 'none',
              border: showMeta ? '1px solid rgba(59,130,246,0.35)' : '1px solid transparent',
              color: showMeta ? '#3b82f6' : 'var(--node-meta)',
            }}
          >
            {showMeta ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        <NoteContentRenderer note={displayNote} className="note-preview-content" onImageClick={setZoomSrc} showMeta={showMeta} />
      </div>
      <ImageLightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />

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
  dueCount?: number
}

function NoteMapCanvasInner({ notes, canvas, user, title, dueCount }: NoteMapCanvasProps) {
  const router = useRouter()
  const pathname = usePathname()
  const activeMode = MODES.find(m => m.match(pathname)) ?? MODES[0]
  const displayTitle = title ?? activeMode.label

  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [previewNoteId, setPreviewNoteId] = useState<string | null>(null)
  const [lastPreviewNoteId, setLastPreviewNoteId] = useState<string | null>(null)
  const [favNoteIds, setFavNoteIds] = useState<Set<string>>(new Set())
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const reactFlowWrapper = useRef<HTMLDivElement>(null)

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
  const [isDragOver, setIsDragOver] = useState(false)
  const [dropCounter, setDropCounter] = useState(0)
  // Message éphémère du drop extension (résolution en cours / note introuvable)
  const [dropNotice, setDropNotice] = useState<string | null>(null)
  const dragEnterCounterRef = useRef(0)
  const { setCenter, screenToFlowPosition } = useReactFlow()
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

  // Fraîcheur des notes sans recharger la page : une note qui vient d'être
  // synchronisée depuis l'extension apparaît dans la liste (et se résout au
  // drop) via un refresh au retour sur l'onglet + toutes les 60 s.
  useEffect(() => {
    const onFocus = () => router.refresh()
    window.addEventListener('focus', onFocus)
    const interval = setInterval(() => {
      if (!document.hidden) router.refresh()
    }, 60_000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [router])

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

  // Groupes de notes (proto-dossiers / concepts) — même mécanique que les groupes de blocs
  const groupHandlersRef = useRef<GroupHandlers>({
    rename: () => {}, recolor: () => {}, promote: async () => false, dissolve: () => {}, resize: () => {},
  })

  const initialNodes: Node[] = useMemo(() => {
    const groupNodes: Node[] = canvas.nodes
      .filter(n => n.kind === 'group')
      .map(g => ({
        id: g.id, type: 'group',
        position: { x: g.x, y: g.y },
        style: { width: g.width, height: g.height, zIndex: -1 },
        data: { label: g.label ?? 'Groupe', color: g.color ?? 'blue', tagId: g.tagId ?? null, handlers: groupHandlersRef },
      }))
    const noteNodes: Node[] = canvas.nodes
      .filter(n => n.noteId != null)
      .flatMap(n => {
        const note = notes.find(note => note.id === n.noteId)
        if (!note) return []
        return [{
          id: note.id, type: 'noteMap',
          position: { x: n.x, y: n.y },
          ...(n.parentId ? { parentId: n.parentId } : {}),
          style: { width: 260, height: 152 },
          data: { note, dbNodeId: n.id, canvasId: canvas.id },
        }]
      })
    return sortParentsFirst([...groupNodes, ...noteNodes])
  },
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

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (singleClickTimerRef.current) clearTimeout(singleClickTimerRef.current)
    singleClickTimerRef.current = setTimeout(() => {
      openPreview(node.id)
    }, 220)
  }, [])

  // Double-clic = OUVRIR le poste de travail de la note (décision Brice 17/07 —
  // remplace l'ancien dépliage sur place, jugé inexploitables)
  const handleNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (singleClickTimerRef.current) {
      clearTimeout(singleClickTimerRef.current)
      singleClickTimerRef.current = null
    }
    if (node.type !== 'noteMap') return
    router.push(`/notes/${node.id}`)
  }, [router])

  const handleNodeDragStop: OnNodeDrag = useCallback(async (_, node) => {
    // Groupe déplacé : on persiste juste sa position (id RF = id DB du groupe)
    if (node.type === 'group') {
      await fetch(`/api/canvas/${canvas.id}/nodes/${node.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: node.position.x, y: node.position.y }),
      })
      return
    }

    // Carte de note : s'assurer qu'elle est persistée en base
    let dbNodeId = savedNodeRef.current.get(node.id)
    if (!dbNodeId) {
      const res = await fetch(`/api/canvas/${canvas.id}/nodes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: node.id, x: node.position.x, y: node.position.y }),
      })
      if (!res.ok) return
      const data = await res.json()
      dbNodeId = data.id as string
      savedNodeRef.current.set(node.id, data.id)
      setNodes(nds => nds.map(n => n.id === node.id
        ? { ...n, data: { ...n.data, dbNodeId: data.id, canvasId: canvas.id } } : n))
    }

    // Rattachement/détachement à un groupe selon la zone survolée (« ça va avec ça » macro)
    const parent = node.parentId ? nodes.find(n => n.id === node.parentId) : undefined
    const abs = parent ? { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y } : node.position
    const w = 260, h = 152
    const cx = abs.x + w / 2, cy = abs.y + h / 2
    const area = w * h
    let target: Node | undefined
    let best = 0
    for (const g of nodes) {
      if (g.type !== 'group') continue
      const gw = (g.style?.width as number) ?? 360
      const gh = (g.style?.height as number) ?? 260
      const ox = Math.max(0, Math.min(abs.x + w, g.position.x + gw) - Math.max(abs.x, g.position.x))
      const oy = Math.max(0, Math.min(abs.y + h, g.position.y + gh) - Math.max(abs.y, g.position.y))
      const overlap = ox * oy
      const inside = cx >= g.position.x && cx <= g.position.x + gw && cy >= g.position.y && cy <= g.position.y + gh
      if (overlap < area * 0.35 && !inside) continue
      const score = overlap + (inside ? area : 0)
      if (score > best) { best = score; target = g }
    }

    if (target && target.id !== node.parentId) {
      const tgt = target
      const rel = { x: abs.x - tgt.position.x, y: abs.y - tgt.position.y }
      setNodes(nds => sortParentsFirst(nds.map(n => n.id === node.id ? { ...n, parentId: tgt.id, position: rel } : n)))
      await fetch(`/api/canvas/${canvas.id}/nodes/${dbNodeId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: tgt.id, x: rel.x, y: rel.y }),
      })
    } else if (!target && node.parentId) {
      setNodes(nds => nds.map(n => n.id === node.id ? { ...n, parentId: undefined, position: abs } : n))
      await fetch(`/api/canvas/${canvas.id}/nodes/${dbNodeId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: null, x: abs.x, y: abs.y }),
      })
    } else {
      await fetch(`/api/canvas/${canvas.id}/nodes/${dbNodeId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: node.position.x, y: node.position.y }),
      })
    }
  }, [canvas.id, nodes, setNodes])

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

  const pinnedNoteIds = useMemo(() => new Set(nodes.map(n => n.id)), [nodes])

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragEnterCounterRef.current = 0
    setIsDragOver(false)

    // ── Résolution de la note glissée ────────────────────────────────────────
    // Deux origines : drag interne (type 'noteId' = id JOURNAL) et drag depuis
    // l'extension ('noteId' = id LOCAL extension + text/plain « carnet-note:id »).
    // ⚠️ Bug corrigé le 17/07 : on prenait 'noteId' tel quel — pour un drag
    // extension c'était son id local, inconnu du journal → abandon silencieux
    // AVANT même la branche pont. On vérifie désormais chaque candidat.
    const rawId = e.dataTransfer.getData('noteId')
    const extRaw = e.dataTransfer.getData('application/x-carnet-note') || e.dataTransfer.getData('text/plain')
    const extParsed = extRaw.match(/^carnet-note:(.+)$/)?.[1]?.trim()

    let noteId = rawId && notes.some(n => n.id === rawId) ? rawId : ''
    let freshNote: NoteData | undefined
    // Candidat extension : le format explicite d'abord, sinon le rawId inconnu
    // du journal (c'est alors très probablement un id local extension)
    const extId = extParsed || (rawId && !noteId ? rawId : '')
    if (!noteId && extId) {
      {
        const match = notes.find(n => n.extensionNoteId === extId)
        if (match) {
          noteId = match.id
        } else {
          // La note vient d'être synchronisée : la page ne la connaît pas encore.
          // Avant : échec SILENCIEUX tant qu'on ne rechargeait pas (bug Brice 17/07).
          // On résout en direct contre l'API — avec retries (une sync peut être en
          // vol) — et si elle n'existe vraiment pas, on le DIT au lieu de mourir.
          setDropNotice('Note en cours de synchronisation…')
          for (let attempt = 0; attempt < 3 && !noteId; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 1500))
            try {
              const res = await fetch('/api/notes')
              if (!res.ok) continue
              const fresh: (NoteData & { tags?: unknown })[] = await res.json()
              const found = fresh.find(n => n.extensionNoteId === extId)
              if (found) {
                freshNote = { ...found, tags: [] }
                noteId = found.id
                router.refresh()
              }
            } catch { /* réseau — on retentera */ }
          }
          if (!noteId) {
            setDropNotice('Cette note n\'est pas encore dans le journal — vérifie « ✓ sync » dans l\'extension, puis re-glisse-la.')
            setTimeout(() => setDropNotice(null), 6000)
            router.refresh()
            return
          }
          setDropNotice(null)
        }
      }
    }
    if (!noteId) return
    if (nodes.some(n => n.id === noteId)) {
      setDropNotice('Cette note est déjà sur le canvas.')
      setTimeout(() => setDropNotice(null), 3000)
      return
    }

    // Center the node on the drop cursor position
    const position = screenToFlowPosition({ x: e.clientX - 130, y: e.clientY - 76 })
    const note = notes.find(n => n.id === noteId) ?? freshNote
    if (!note) return

    const res = await fetch(`/api/canvas/${canvas.id}/nodes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId, x: position.x, y: position.y }),
    })
    if (!res.ok) return
    const dbNode = await res.json()

    savedNodeRef.current.set(noteId, dbNode.id)
    setNodes(prev => [...prev, {
      id: noteId, type: 'noteMap',
      position,
      style: { width: 260, height: 152 },
      data: { note, dbNodeId: dbNode.id, canvasId: canvas.id },
    }])
    setDropCounter(c => c + 1)
  }, [nodes, notes, canvas.id, screenToFlowPosition, setNodes, router])

  // ── Groupes de notes : renommer / recolorer / promouvoir / dissoudre / redimensionner ──
  const patchNode = useCallback((id: string, body: Record<string, unknown>) =>
    fetch(`/api/canvas/${canvas.id}/nodes/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), [canvas.id])

  const renameGroup = useCallback((id: string, label: string) => {
    patchNode(id, { label })
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, label } } : n))
  }, [patchNode, setNodes])

  const recolorGroup = useCallback((id: string, color: string) => {
    patchNode(id, { color })
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, color } } : n))
  }, [patchNode, setNodes])

  const dissolveGroup = useCallback((id: string) => {
    const group = nodes.find(n => n.id === id)
    if (!group) return
    const children = nodes.filter(n => n.parentId === id)
    for (const child of children) {
      const abs = { x: group.position.x + child.position.x, y: group.position.y + child.position.y }
      const childDbId = savedNodeRef.current.get(child.id)
      if (childDbId) patchNode(childDbId, { parentId: null, x: abs.x, y: abs.y })
    }
    setNodes(nds => nds.filter(n => n.id !== id).map(n => {
      if (n.parentId !== id) return n
      const abs = { x: group.position.x + n.position.x, y: group.position.y + n.position.y }
      return { ...n, parentId: undefined, position: abs }
    }))
    fetch(`/api/canvas/${canvas.id}/nodes/${id}`, { method: 'DELETE' })
  }, [nodes, patchNode, setNodes, canvas.id])

  // 0.1.3 « le nom sert » : les NOTES du groupe portent le concept (NoteTag) —
  // « ces notes expriment une même idée » devient de la donnée pour /concepts.
  const promoteGroupTag = useCallback(async (label: string, groupId: string) => {
    const noteIds = nodes
      .filter(n => n.parentId === groupId && n.type === 'noteMap')
      .map(n => n.id)
    const res = await fetch('/api/tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: label, noteIds }),
    })
    if (!res.ok) return false
    // Groupe VIVANT : mémoriser le concept sur le groupe — désormais y déposer
    // une note la tague, l'en sortir la détague (côté serveur, route PATCH nodes)
    const tag = await res.json()
    if (tag?.id) {
      await patchNode(groupId, { tagId: tag.id })
      setNodes(nds => nds.map(n => n.id === groupId ? { ...n, data: { ...n.data, tagId: tag.id } } : n))
    }
    return true
  }, [nodes, patchNode, setNodes])

  groupHandlersRef.current = {
    rename: renameGroup,
    recolor: recolorGroup,
    promote: promoteGroupTag,
    dissolve: dissolveGroup,
    resize: (id, p) => {
      patchNode(id, { width: p.width, height: p.height, x: p.x, y: p.y })
      setNodes(nds => nds.map(n => n.id === id ? { ...n, position: { x: p.x, y: p.y }, style: { ...n.style, width: p.width, height: p.height } } : n))
    },
    // 0.1.5 : ouvrir la collection (groupe de notes) dans son canvas de mapping
    openCollection: (groupId) => router.push(`/collection/${groupId}`),
  }

  // Grouper les cartes de notes sélectionnées (le pendant macro des groupes de blocs)
  const creatingGroupRef = useRef(false)
  const selectedFreeNotes = nodes.filter(n => n.selected && n.type === 'noteMap' && !n.parentId)

  const handleGroupSelection = useCallback(async () => {
    if (creatingGroupRef.current) return
    creatingGroupRef.current = true
    try {
      const selected = nodes.filter(n => n.selected && n.type === 'noteMap' && !n.parentId)
      if (selected.length < 2) return
      const boxes = selected.map(n => ({ x: n.position.x, y: n.position.y, w: (n.style?.width as number) ?? 260, h: (n.style?.height as number) ?? 152 }))
      const minX = Math.min(...boxes.map(b => b.x)) - 28
      const minY = Math.min(...boxes.map(b => b.y)) - 52
      const maxX = Math.max(...boxes.map(b => b.x + b.w)) + 28
      const maxY = Math.max(...boxes.map(b => b.y + b.h)) + 28
      const color = GROUP_COLOR_KEYS[nodes.filter(n => n.type === 'group').length % GROUP_COLOR_KEYS.length]
      const res = await fetch(`/api/canvas/${canvas.id}/nodes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'group', label: 'Groupe', color, x: minX, y: minY, width: maxX - minX, height: maxY - minY }),
      })
      if (!res.ok) return
      const g = await res.json()
      const selectedIds = new Set(selected.map(n => n.id))
      setNodes(nds => sortParentsFirst([
        { id: g.id, type: 'group', position: { x: g.x, y: g.y }, style: { width: g.width, height: g.height, zIndex: -1 }, data: { label: g.label ?? 'Groupe', color: g.color ?? color, autoEdit: true, handlers: groupHandlersRef } },
        ...nds.map(n => selectedIds.has(n.id) ? { ...n, selected: false, parentId: g.id, position: { x: n.position.x - minX, y: n.position.y - minY } } : n),
      ]))
      for (const n of selected) {
        const dbId = savedNodeRef.current.get(n.id)
        if (dbId) patchNode(dbId, { parentId: g.id, x: n.position.x - minX, y: n.position.y - minY })
      }
    } finally {
      creatingGroupRef.current = false
    }
  }, [nodes, canvas.id, patchNode, setNodes])

  // Tool → ReactFlow props mapping
  const toolProps = {
    select:  { panOnDrag: false as const, selectionOnDrag: true,  nodesConnectable: false, nodesDraggable: true,  selectionMode: SelectionMode.Partial },
    mark:    { panOnDrag: false as const, selectionOnDrag: true,  nodesConnectable: false, nodesDraggable: true,  selectionMode: SelectionMode.Full    },
    connect: { panOnDrag: false as const, selectionOnDrag: false, nodesConnectable: true,  nodesDraggable: false, selectionMode: SelectionMode.Partial },
    pan:     { panOnDrag: true  as const, selectionOnDrag: false, nodesConnectable: false, nodesDraggable: false, selectionMode: SelectionMode.Partial },
  }

  const previewNote = previewNoteId ? notes.find(n => n.id === previewNoteId) : undefined
  const previewNoteTitle = previewNote?.title

  return (
    <div className="flex h-full overflow-hidden relative" style={{ background: 'var(--canvas-bg)' }}>

      {/* ── Canvas ── */}
      <div
        ref={canvasRef}
        className="canvas-root"
        style={{ cursor: spacePressed ? 'grab' : activeTool === 'pan' ? 'grab' : 'default' }}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={() => { dragEnterCounterRef.current++; setIsDragOver(true) }}
        onDragLeave={() => { dragEnterCounterRef.current--; if (dragEnterCounterRef.current === 0) setIsDragOver(false) }}
      >

        {/* Dot grid */}
        {showGrid && <div className="canvas-grid" style={dotBgStyle} />}
        {showGrid && <div ref={spotlightRef} className="canvas-dot-spotlight" style={dotBgStyle} />}

        {/* Drop zone overlay */}
        {isDragOver && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 100, pointerEvents: 'none',
            border: '2px dashed var(--node-handle)',
            borderRadius: 12,
            boxShadow: 'inset 0 0 40px rgba(59,130,246,0.06)',
          }} />
        )}

        {/* Message du drop extension — résolution en cours ou note introuvable */}
        {dropNotice && (
          <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 110 }}>
            <div className="canvas-float-pill" style={{ padding: '8px 14px', fontSize: 12, color: 'var(--node-title)', maxWidth: 420, textAlign: 'center' }}>
              {dropNotice}
            </div>
          </div>
        )}

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
        <NotePreviewPanel note={previewNote} refreshTrigger={refreshTrigger} />

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
          <NotesBubble notes={notes} pinnedNoteIds={pinnedNoteIds} onFocus={focusNote} onPreview={openPreview} dropCounter={dropCounter} />
        </div>

        {/* ── Capture bar ── */}
        <CaptureBar
          noteId={previewNoteId}
          noteTitle={previewNoteTitle}
          onMessageAdded={() => setRefreshTrigger(t => t + 1)}
        />

        {/* ── Bottom-right — theme + nav ── */}
        <div style={{ position: 'absolute', bottom: showMiniMap ? 168 : 16, right: 14, zIndex: 20 }}>
          <div className="canvas-float-pill" style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 8px' }}>
            <ThemeToggleInline />
            <div style={{ width: 1, height: 16, background: 'var(--float-border)', margin: '0 4px' }} />
            <Link href="/review"
              title="Relire tes jugements A/B/C échus"
              style={{ fontSize: 12, color: dueCount ? 'var(--node-title)' : 'var(--node-meta)', padding: '4px 8px', borderRadius: 6, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--node-title)'; (e.currentTarget as HTMLElement).style.background = 'var(--canvas-bg)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = dueCount ? 'var(--node-title)' : 'var(--node-meta)'; (e.currentTarget as HTMLElement).style.background = 'none' }}
            >
              Relire
              {!!dueCount && dueCount > 0 && (
                <span style={{ fontSize: 10, fontWeight: 600, color: '#fff', background: '#ef4444', borderRadius: 999, padding: '0 6px', lineHeight: '15px' }}>{dueCount}</span>
              )}
            </Link>
            {[
              { href: '/notes', label: 'Notes' },
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

        {/* ── ReactFlow ── */}
        <div
          ref={reactFlowWrapper}
          style={{ position: 'absolute', inset: 0, zIndex: 2 }}
        >
          {nodes.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 1, pointerEvents: 'none',
            }}>
              <p style={{
                fontSize: 14, color: 'var(--node-meta)', fontWeight: 500,
                textAlign: 'center', lineHeight: 1.7,
              }}>
                Glisse une note depuis la liste ↙ pour l&apos;ajouter au canvas
              </p>
            </div>
          )}
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
            {selectedFreeNotes.length >= 2 && (
              <Panel position="top-center">
                <button
                  onClick={handleGroupSelection}
                  className="canvas-float-pill"
                  style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, color: '#3b82f6', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <FolderPlus size={13} /> Grouper la sélection ({selectedFreeNotes.length})
                </button>
              </Panel>
            )}
            {showMiniMap && (
              <MiniMap nodeColor="var(--node-border)" maskColor="rgba(0,0,0,0.12)"
                style={{ background: 'var(--float-bg)', border: '1px solid var(--float-border)', borderRadius: 12, backdropFilter: 'blur(12px)' }}
              />
            )}
          </ReactFlow>
        </div>
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
