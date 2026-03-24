'use client'

import React, { useState, useRef, useCallback } from 'react'
import { Send, Paperclip } from 'lucide-react'

interface CaptureBarProps {
  noteId: string | null
  noteTitle?: string
  onMessageAdded: () => void
}

export default function CaptureBar({ noteId, noteTitle, onMessageAdded }: CaptureBarProps) {
  const [text, setText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const disabled = !noteId
  const busy = isSending || isUploading

  const handleSubmit = useCallback(async () => {
    if (!noteId || !text.trim() || busy) return
    setIsSending(true)
    try {
      const res = await fetch(`/api/notes/${noteId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `<p>${text.trim()}</p>`, type: 'text' }),
      })
      if (res.ok) {
        setText('')
        onMessageAdded()
      }
    } catch {
      // silent
    } finally {
      setIsSending(false)
    }
  }, [noteId, text, busy, onMessageAdded])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleImageFile = useCallback(async (file: File) => {
    if (!noteId) return
    setIsUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = async (ev) => {
        try {
          const dataUrl = ev.target?.result as string
          const uploadRes = await fetch(`/api/notes/${noteId}/messages/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageDataUrl: dataUrl, path: file.name }),
          })
          if (!uploadRes.ok) return
          const { url } = await uploadRes.json()
          await fetch(`/api/notes/${noteId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: url, type: 'image' }),
          })
          onMessageAdded()
        } finally {
          setIsUploading(false)
        }
      }
      reader.readAsDataURL(file)
    } catch {
      setIsUploading(false)
    }
  }, [noteId, onMessageAdded])

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 25,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 16px',
    height: 56,
    background: 'var(--float-bg)',
    borderTop: '1px solid var(--float-border)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
  }

  const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, borderRadius: 8,
    background: 'none', border: 'none', cursor: disabled || busy ? 'not-allowed' : 'pointer',
    color: disabled ? 'var(--node-border)' : 'var(--node-meta)',
    flexShrink: 0, transition: 'color 0.15s',
    opacity: disabled ? 0.4 : 1,
  }

  return (
    <div style={containerStyle}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleImageFile(f)
          e.target.value = ''
        }}
      />

      {/* Image attach button */}
      <button
        style={btnStyle}
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || busy}
        title="Joindre une image"
        onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.color = 'var(--node-title)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = disabled ? 'var(--node-border)' : 'var(--node-meta)' }}
      >
        {isUploading
          ? <span style={{ fontSize: 10, color: 'var(--node-meta)' }}>...</span>
          : <Paperclip size={14} />
        }
      </button>

      {/* Text input */}
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled || busy}
        placeholder={disabled ? 'Sélectionne une note...' : `Écrire dans "${noteTitle ?? ''}"...`}
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          fontSize: 13,
          color: disabled ? 'var(--node-meta)' : 'var(--node-title)',
          caretColor: 'var(--node-title)',
        }}
      />

      {/* Send button */}
      <button
        style={{
          ...btnStyle,
          background: text.trim() && !disabled ? 'rgba(59,130,246,0.15)' : 'none',
          color: text.trim() && !disabled ? '#3b82f6' : 'var(--node-border)',
          border: text.trim() && !disabled ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent',
        }}
        onClick={handleSubmit}
        disabled={disabled || !text.trim() || busy}
        title="Envoyer (Entrée)"
      >
        {isSending
          ? <span style={{ fontSize: 10 }}>...</span>
          : <Send size={13} />
        }
      </button>
    </div>
  )
}
