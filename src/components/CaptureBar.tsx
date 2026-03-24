'use client'

import React, { useState, useRef, useCallback } from 'react'
import { ArrowUp, Plus } from 'lucide-react'

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

  const disabled = !noteId
  const busy = isSending || isUploading
  const hasText = text.trim().length > 0

  const handleSubmit = useCallback(async () => {
    if (!noteId || !hasText || busy) return
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
  }, [noteId, hasText, text, busy, onMessageAdded])

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
    bottom: 72,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 25,
    display: 'flex',
    alignItems: 'center',
    width: 440,
    maxWidth: 'calc(100% - 180px)',
    minHeight: 52,
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 24,
    boxShadow: 'var(--float-shadow)',
    overflow: 'hidden',
  }

  const sideBtnStyle: React.CSSProperties = {
    flexShrink: 0,
    width: 44,
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    cursor: disabled || busy ? 'not-allowed' : 'pointer',
    color: disabled ? 'var(--muted-foreground)' : 'var(--muted-foreground)',
    transition: 'color 0.15s',
    opacity: disabled ? 0.35 : 1,
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

      {/* + button (image upload) */}
      <button
        style={sideBtnStyle}
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || busy}
        title="Joindre une image"
        onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.color = 'var(--card-foreground)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--muted-foreground)' }}
      >
        {isUploading
          ? <span style={{ fontSize: 11, color: 'var(--node-meta)' }}>…</span>
          : <Plus size={16} />
        }
      </button>

      {/* Text input */}
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled || busy}
        placeholder={disabled
          ? 'Sélectionne une note pour écrire...'
          : `Écrire dans « ${noteTitle ?? ''} »...`
        }
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          fontSize: 13,
          color: disabled ? 'var(--muted-foreground)' : 'var(--card-foreground)',
          caretColor: 'var(--card-foreground)',
          minWidth: 0,
        }}
      />

      {/* ↑ send button */}
      <button
        style={{
          ...sideBtnStyle,
          background: hasText && !disabled ? '#3b82f6' : 'none',
          color: hasText && !disabled ? '#fff' : 'var(--node-border)',
          borderRadius: '50%',
          width: 32,
          height: 32,
          marginRight: 8,
          opacity: disabled ? 0.4 : 1,
        }}
        onClick={handleSubmit}
        disabled={disabled || !hasText || busy}
        title="Envoyer (Entrée)"
        onMouseEnter={e => { if (hasText && !disabled) (e.currentTarget as HTMLElement).style.background = '#2563eb' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = hasText && !disabled ? '#3b82f6' : 'none' }}
      >
        {isSending
          ? <span style={{ fontSize: 10 }}>…</span>
          : <ArrowUp size={14} />
        }
      </button>
    </div>
  )
}
