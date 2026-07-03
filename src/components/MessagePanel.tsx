'use client'

import { useState } from 'react'
import { MessageData } from '@/types'
import { truncateText } from '@/lib/utils'
import { parseBlockContent } from './StudyCanvas'

interface MessagePanelProps {
  canvasId: string
  messages: MessageData[]
}

// Pill flottante en bas — les blocs de la note pas encore posés sur le canvas
export default function MessagePanel({ messages }: MessagePanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  const handleDragStart = (e: React.DragEvent, messageId: string) => {
    e.dataTransfer.setData('messageId', messageId)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        width: collapsed ? 'auto' : 'min(860px, calc(100vw - 380px))',
        minWidth: collapsed ? undefined : 320,
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
                <MessageChip key={msg.id} message={msg} onDragStart={handleDragStart} />
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
  onDragStart,
}: {
  message: MessageData
  onDragStart: (e: React.DragEvent, id: string) => void
}) {
  const { imgSrc, text } = parseBlockContent(message.content, message.type)

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, message.id)}
      className="flex-shrink-0 w-48 p-2.5 rounded-lg cursor-grab active:cursor-grabbing transition-all text-xs leading-relaxed"
      style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-preview)' }}
    >
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
