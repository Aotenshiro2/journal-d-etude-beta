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
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const MAX_HEIGHT = 160 // 8 lignes × ~20px

  const disabled = !noteId
  const busy = isSending || isUploading
  const hasText = text.trim().length > 0

  const handleSubmit = useCallback(async () => {
    if (!noteId || !hasText || busy) return
    setIsSending(true)
    const htmlContent = text.trim().split('\n').map(l => `<p>${l || '&nbsp;'}</p>`).join('')
    try {
      const res = await fetch(`/api/notes/${noteId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: htmlContent, type: 'text' }),
      })
      if (res.ok) {
        setText('')
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
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
    bottom: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 25,
    display: 'flex',
    flexDirection: 'column',
    width: 440,
    maxWidth: 'calc(100% - 180px)',
    background: 'var(--surface-match)',
    border: '1.5px solid var(--surface-match-border)',
    borderRadius: 24,
    boxShadow: '0 4px 24px rgba(0,0,0,0.25), 0 1px 4px rgba(0,0,0,0.12)',
  }

  const iconBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    cursor: disabled || busy ? 'not-allowed' : 'pointer',
    color: 'var(--muted-foreground)',
    transition: 'color 0.15s',
    opacity: disabled ? 0.35 : 1,
    padding: 0,
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

      {/* Upper zone — text input */}
      <div style={{ padding: '14px 16px 10px' }}>
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={e => {
            setText(e.target.value)
            const el = e.target
            el.style.height = 'auto'
            el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px'
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled || busy}
          placeholder={disabled
            ? 'Sélectionne une note pour écrire...'
            : `Écrire dans « ${noteTitle ?? ''} »...`
          }
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            fontSize: 13,
            lineHeight: '20px',
            overflowY: 'auto',
            maxHeight: MAX_HEIGHT,
            color: disabled ? 'var(--muted-foreground)' : 'var(--surface-match-fg)',
            caretColor: 'var(--surface-match-fg)',
            fontFamily: 'inherit',
          }}
        />
      </div>

      {/* Lower zone — action buttons */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 10px 10px',
      }}>
        {/* + button (image upload) */}
        <button
          style={{ ...iconBtnStyle, width: 32, height: 32 }}
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || busy}
          title="Joindre une image"
          onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.color = 'var(--surface-match-fg)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--muted-foreground)' }}
        >
          {isUploading
            ? <span style={{ fontSize: 11 }}>…</span>
            : <Plus size={16} />
          }
        </button>

        {/* ↑ send button */}
        <button
          style={{
            ...iconBtnStyle,
            background: hasText && !disabled ? '#3b82f6' : 'rgba(0,0,0,0.08)',
            color: hasText && !disabled ? '#fff' : 'var(--muted-foreground)',
            borderRadius: '50%',
            width: 32,
            height: 32,
            opacity: disabled ? 0.4 : 1,
          }}
          onClick={handleSubmit}
          disabled={disabled || !hasText || busy}
          title="Envoyer (Entrée)"
          onMouseEnter={e => { if (hasText && !disabled) (e.currentTarget as HTMLElement).style.background = '#2563eb' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = hasText && !disabled ? '#3b82f6' : 'rgba(0,0,0,0.08)' }}
        >
          {isSending
            ? <span style={{ fontSize: 10 }}>…</span>
            : <ArrowUp size={14} />
          }
        </button>
      </div>
    </div>
  )
}
