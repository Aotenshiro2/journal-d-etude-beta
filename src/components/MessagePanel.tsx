'use client'

import { useState } from 'react'
import { MessageData } from '@/types'
import { stripHtml, truncateText, extractImageSrc } from '@/lib/utils'

interface MessagePanelProps {
  canvasId: string
  messages: MessageData[]
}

export default function MessagePanel({ messages }: MessagePanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  const handleDragStart = (e: React.DragEvent, messageId: string) => {
    e.dataTransfer.setData('messageId', messageId)
    e.dataTransfer.effectAllowed = 'move'
  }

  if (collapsed) {
    return (
      <div
        className="border-t border-white/10 bg-gray-900 px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-800 transition-colors"
        onClick={() => setCollapsed(false)}
      >
        <span className="text-xs text-gray-400">
          Blocs disponibles ({messages.length})
        </span>
        <span className="text-gray-500 text-xs">▲</span>
      </div>
    )
  }

  return (
    <div className="border-t border-white/10 bg-gray-900 flex-shrink-0" style={{ maxHeight: '200px' }}>
      <div
        className="flex items-center justify-between px-4 py-2 border-b border-white/10 cursor-pointer hover:bg-gray-800 transition-colors"
        onClick={() => setCollapsed(true)}
      >
        <span className="text-xs font-medium text-gray-300">
          Blocs disponibles ({messages.length})
        </span>
        <span className="text-gray-500 text-xs">▼ Réduire</span>
      </div>

      {messages.length === 0 ? (
        <div className="px-4 py-4 text-center text-xs text-gray-600">
          Tous les blocs sont placés sur le canvas
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto px-4 py-3" style={{ scrollbarWidth: 'thin' }}>
          {messages.map((msg) => (
            <MessageBlock key={msg.id} message={msg} onDragStart={handleDragStart} />
          ))}
        </div>
      )}
    </div>
  )
}

function MessageBlock({
  message,
  onDragStart,
}: {
  message: MessageData
  onDragStart: (e: React.DragEvent, id: string) => void
}) {
  const text = truncateText(stripHtml(message.content), 80)

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, message.id)}
      className="flex-shrink-0 w-48 p-2.5 rounded-lg border border-white/10 bg-gray-800 hover:border-yellow-400/40 cursor-grab active:cursor-grabbing transition-all text-xs text-gray-300 leading-relaxed"
    >
      {message.type === 'image' ? (() => {
        const src = extractImageSrc(message.content)
        return src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="w-full h-20 object-cover rounded-md" />
        ) : (
          <span className="text-xs text-gray-500">Image non disponible</span>
        )
      })() : (
        <p className="line-clamp-3">{text || '(bloc vide)'}</p>
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
