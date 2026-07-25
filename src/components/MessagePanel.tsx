'use client'

import { useState, useEffect } from 'react'
import { MessageData } from '@/types'
import { truncateText } from '@/lib/utils'
import { parseBlockContent, TradeBadge, TradeMeta } from './StudyCanvas'
import { useIsMobile } from '@/hooks/useIsMobile'

interface MessagePanelProps {
  canvasId: string
  messages: MessageData[]
  tradeMeta?: Record<string, TradeMeta>
  /** Bloc « armé » : touché ici, il attend qu'on touche le canvas pour s'y poser. */
  armedId?: string | null
  onArm?: (id: string | null) => void
}

// Pill flottante en bas — les blocs de la note pas encore posés sur le canvas
export default function MessagePanel({ messages, tradeMeta, armedId, onArm }: MessagePanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const isMobile = useIsMobile()

  // Un bloc armé se pose sur le canvas : on replie le tiroir pour le dégager.
  useEffect(() => {
    if (armedId) setCollapsed(true)
  }, [armedId])

  const handleDragStart = (e: React.DragEvent, messageId: string) => {
    e.dataTransfer.setData('messageId', messageId)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      className="safe-bottom-offset"
      style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        // Au téléphone, `calc(100vw - 380px)` laissait un tiroir minuscule (la
        // marge était calculée pour les panneaux latéraux du bureau).
        width: collapsed ? 'auto' : isMobile ? 'calc(100vw - 28px)' : 'min(860px, calc(100vw - 380px))',
        minWidth: collapsed || isMobile ? undefined : 320,
      }}
    >
      <div className="canvas-float-pill" style={{ overflow: 'hidden' }}>
        <button
          onClick={() => setCollapsed(v => !v)}
          style={{
            width: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '8px 14px',
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 11, color: 'var(--node-meta)',
          }}
        >
          <span style={{ fontWeight: 600 }}>Blocs disponibles ({messages.length})</span>
          <span>{collapsed ? '▲' : '▼'}</span>
        </button>

        {!collapsed && (
          messages.length === 0 ? (
            <div style={{ padding: '4px 14px 12px', textAlign: 'center', fontSize: 11, color: 'var(--node-meta)', opacity: 0.7 }}>
              Tous les blocs sont placés sur le canvas
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'thin', padding: '2px 12px 12px' }}>
              {messages.map((msg) => (
                <MessageChip
                  key={msg.id}
                  message={msg}
                  tradeMeta={tradeMeta}
                  onDragStart={handleDragStart}
                  armed={armedId === msg.id}
                  onArm={onArm}
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}

function MessageChip({
  message,
  tradeMeta,
  onDragStart,
  armed,
  onArm,
}: {
  message: MessageData
  tradeMeta?: Record<string, TradeMeta>
  onDragStart: (e: React.DragEvent, id: string) => void
  armed?: boolean
  onArm?: (id: string | null) => void
}) {
  const { imgSrc, text } = parseBlockContent(message.content, message.type)
  const trade = message.tradeRef ? tradeMeta?.[message.tradeRef] : undefined
  // Collection (0.1.5b) : blocs de plusieurs notes mélangés → afficher l'origine
  const sourceNoteTitle = (message as MessageData & { sourceNoteTitle?: string }).sourceNoteTitle

  return (
    // Le tap arme le bloc, un second tap sur le canvas le pose (le glisser-
    // déposer HTML5 ne se déclenche jamais au doigt). À la souris, les deux
    // gestes cohabitent : le drag reste, le clic arme.
    <div
      draggable
      onDragStart={(e) => onDragStart(e, message.id)}
      onClick={() => onArm?.(armed ? null : message.id)}
      className="flex-shrink-0 w-48 p-2.5 rounded-lg cursor-grab active:cursor-grabbing transition-all text-xs leading-relaxed"
      style={{
        background: 'var(--node-bg)',
        border: armed ? '1px solid #3b82f6' : '1px solid var(--node-border)',
        boxShadow: armed ? '0 0 0 3px rgba(59,130,246,0.22)' : undefined,
        opacity: armed ? 1 : undefined,
        color: 'var(--node-preview)',
      }}
    >
      {sourceNoteTitle && (
        <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide truncate" style={{ color: 'var(--node-meta)', opacity: 0.75 }} title={sourceNoteTitle}>
          {sourceNoteTitle}
        </p>
      )}
      {trade && <div className="mb-1.5"><TradeBadge meta={trade} /></div>}
      {imgSrc ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imgSrc} alt="" className="w-full h-16 object-cover rounded-md" draggable={false} />
          {text && <p className="line-clamp-1 mt-1.5">{truncateText(text, 40)}</p>}
        </>
      ) : (
        <p className="line-clamp-3">{truncateText(text, 80) || '(bloc vide)'}</p>
      )}
      {message.tags && message.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {message.tags.slice(0, 2).map(({ tag }) => (
            <span
              key={tag.id}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{ backgroundColor: tag.color + '33', color: tag.color }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
