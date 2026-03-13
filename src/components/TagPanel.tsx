'use client'

import { useState } from 'react'
import { TagData } from '@/types'

interface TagPanelProps {
  messageId: string
  existingTags: TagData[]
  onClose: () => void
  onTagAdded: (tag: TagData) => void
  onTagRemoved: (tagId: string) => void
}

export default function TagPanel({
  messageId,
  existingTags,
  onClose,
  onTagAdded,
  onTagRemoved,
}: TagPanelProps) {
  const [tagName, setTagName] = useState('')
  const [loading, setLoading] = useState(false)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tagName.trim()) return
    setLoading(true)

    const res = await fetch(`/api/messages/${messageId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: tagName.trim() }),
    })

    if (res.ok) {
      const tag: TagData = await res.json()
      onTagAdded(tag)
      setTagName('')
    }
    setLoading(false)
  }

  const handleRemove = async (tagId: string) => {
    await fetch(`/api/messages/${messageId}/tags/${tagId}`, { method: 'DELETE' })
    onTagRemoved(tagId)
  }

  return (
    <div className="absolute right-4 top-16 z-30 w-64 rounded-xl border border-white/10 bg-gray-900 shadow-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-white">Tags</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-xs">✕</button>
      </div>

      {existingTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {existingTags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: tag.color + '33', color: tag.color }}
            >
              {tag.name}
              <button
                onClick={() => handleRemove(tag.id)}
                className="hover:opacity-70 transition-opacity"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="text"
          value={tagName}
          onChange={(e) => setTagName(e.target.value)}
          placeholder="Nouveau tag..."
          className="flex-1 px-2.5 py-1.5 rounded-lg bg-gray-800 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400/50"
        />
        <button
          type="submit"
          disabled={loading || !tagName.trim()}
          className="px-2.5 py-1.5 rounded-lg bg-yellow-400/20 text-yellow-300 text-xs hover:bg-yellow-400/30 transition-colors disabled:opacity-40"
        >
          +
        </button>
      </form>
    </div>
  )
}
