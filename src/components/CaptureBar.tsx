'use client'

import React, { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, Plus, Hash } from 'lucide-react'

interface TagSuggestion { id: string; name: string; color: string }

interface CaptureBarProps {
  noteId: string | null
  noteTitle?: string
  onMessageAdded: () => void
}

// Commandes lançables depuis la capture box (toujours à portée, même sans note sélectionnée)
const COMMANDS = [
  { cmd: '/guide', label: 'Le parcours (aide)', href: '/guide' },
  { cmd: '/relire', label: 'Relecture', href: '/review' },
  { cmd: '/concepts', label: 'Concepts', href: '/concepts' },
  { cmd: '/analyse', label: 'Analyse', href: '/analytics' },
  { cmd: '/patterns', label: 'Pattern Maps', href: '/patterns' },
  { cmd: '/seance', label: 'Rituel de séance', href: '/session' },
]

export default function CaptureBar({ noteId, noteTitle, onMessageAdded }: CaptureBarProps) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const MAX_HEIGHT = 160 // 8 lignes × ~20px

  const disabled = !noteId // pas de note → on ne peut pas ÉCRIRE, mais on peut lancer une commande
  const busy = isSending || isUploading
  const hasText = text.trim().length > 0

  const trimmed = text.trim()
  const isCommand = trimmed.startsWith('/')
  const cmdQuery = trimmed.toLowerCase().split(/\s/)[0]
  const filtered = isCommand ? COMMANDS.filter(c => c.cmd.startsWith(cmdQuery) || c.label.toLowerCase().includes(cmdQuery.slice(1))) : []

  // ── [[concept]] — autocomplete sur la taxonomie (0.1.4, second cerveau) ─────
  // Taper « [[ » ouvre les suggestions ; Entrée insère « [[nom]] » ; si aucun
  // concept ne correspond, une option « créer » l'ajoute à la taxonomie.
  const [allTags, setAllTags] = useState<TagSuggestion[] | null>(null)
  const [wikiQuery, setWikiQuery] = useState<string | null>(null) // null = menu fermé
  const wikiStartRef = useRef(0) // index du « [[ » ouvrant dans le texte

  const loadTags = useCallback(async () => {
    if (allTags) return
    try {
      const res = await fetch('/api/tags')
      if (res.ok) setAllTags(await res.json())
    } catch { setAllTags([]) }
  }, [allTags])

  // Détecte un « [[query » non refermé juste avant le caret
  const detectWiki = useCallback((value: string, caret: number) => {
    const upToCaret = value.slice(0, caret)
    const open = upToCaret.lastIndexOf('[[')
    if (open === -1) return null
    const between = upToCaret.slice(open + 2)
    if (between.includes(']]') || between.includes('\n')) return null
    wikiStartRef.current = open
    return between
  }, [])

  const wikiMatches = wikiQuery !== null && allTags
    ? allTags.filter(t => t.name.toLowerCase().includes(wikiQuery.toLowerCase())).slice(0, 6)
    : []
  const wikiCanCreate = wikiQuery !== null && wikiQuery.trim().length > 0 &&
    !(allTags ?? []).some(t => t.name.toLowerCase() === wikiQuery.trim().toLowerCase())

  const insertWikilink = useCallback((name: string) => {
    const el = textareaRef.current
    const caret = el ? el.selectionStart : text.length
    const next = text.slice(0, wikiStartRef.current) + `[[${name}]] ` + text.slice(caret)
    setText(next)
    setWikiQuery(null)
    if (el) {
      const pos = wikiStartRef.current + name.length + 5
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos) })
    }
  }, [text])

  const createAndInsert = useCallback(async (name: string) => {
    const clean = name.trim()
    if (!clean) return
    try {
      const res = await fetch('/api/tags', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clean }),
      })
      if (res.ok) {
        const tag = await res.json()
        setAllTags(prev => prev ? [...prev, tag] : [tag])
      }
    } catch { /* le lien sera résolu plus tard si le concept existe */ }
    insertWikilink(clean.toLowerCase())
  }, [insertWikilink])

  const resetInput = () => { setText(''); if (textareaRef.current) textareaRef.current.style.height = 'auto' }
  const runCommand = (href: string) => { resetInput(); router.push(href) }

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

  const canSend = hasText && !busy && (!disabled || isCommand)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Menu [[concept]] ouvert : Entrée/Tab sélectionne, Échap ferme
    if (wikiQuery !== null) {
      if (e.key === 'Escape') { e.preventDefault(); setWikiQuery(null); return }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        e.preventDefault()
        if (wikiMatches[0]) insertWikilink(wikiMatches[0].name)
        else if (wikiCanCreate) createAndInsert(wikiQuery)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isCommand && filtered[0]) runCommand(filtered[0].href)
      else handleSubmit()
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
      {/* Menu [[concept]] (au-dessus de la box) — 0.1.4 second cerveau */}
      {wikiQuery !== null && (wikiMatches.length > 0 || wikiCanCreate) && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0,
          background: 'var(--surface-match)', border: '1.5px solid var(--surface-match-border)',
          borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.25)', padding: 4, overflow: 'hidden',
        }}>
          {wikiMatches.map((t, i) => (
            <button
              key={t.id}
              onMouseDown={e => { e.preventDefault(); insertWikilink(t.name) }}
              style={{
                display: 'flex', width: '100%', alignItems: 'center', gap: 8,
                padding: '8px 10px', border: 'none', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                background: i === 0 ? 'rgba(59,130,246,0.12)' : 'none', color: 'var(--surface-match-fg)',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</span>
            </button>
          ))}
          {wikiCanCreate && (
            <button
              onMouseDown={e => { e.preventDefault(); createAndInsert(wikiQuery) }}
              style={{
                display: 'flex', width: '100%', alignItems: 'center', gap: 8,
                padding: '8px 10px', border: 'none', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                background: wikiMatches.length === 0 ? 'rgba(59,130,246,0.12)' : 'none',
                color: 'var(--muted-foreground)',
              }}
            >
              <Hash size={12} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12 }}>Créer le concept « {wikiQuery.trim()} »</span>
            </button>
          )}
        </div>
      )}

      {/* Menu de commandes (au-dessus de la box) */}
      {filtered.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0,
          background: 'var(--surface-match)', border: '1.5px solid var(--surface-match-border)',
          borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.25)', padding: 4, overflow: 'hidden',
        }}>
          {filtered.map((c, i) => (
            <button
              key={c.cmd}
              onMouseDown={e => { e.preventDefault(); runCommand(c.href) }}
              style={{
                display: 'flex', width: '100%', alignItems: 'center', gap: 8,
                padding: '8px 10px', border: 'none', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                background: i === 0 ? 'rgba(59,130,246,0.12)' : 'none', color: 'var(--surface-match-fg)',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600 }}>{c.cmd}</span>
              <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{c.label}</span>
            </button>
          ))}
        </div>
      )}

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
            // Autocomplete [[concept]]
            const q = detectWiki(e.target.value, el.selectionStart)
            setWikiQuery(q)
            if (q !== null) loadTags()
          }}
          onKeyDown={handleKeyDown}
          disabled={busy}
          placeholder={disabled
            ? 'Tape /guide pour l’aide — ou choisis une note pour écrire'
            : `Écrire dans « ${noteTitle ?? ''} » — ou tape / pour une commande`
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
            color: 'var(--surface-match-fg)',
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

        {/* ↑ send / run command button */}
        <button
          style={{
            ...iconBtnStyle,
            background: canSend ? '#3b82f6' : 'rgba(0,0,0,0.08)',
            color: canSend ? '#fff' : 'var(--muted-foreground)',
            borderRadius: '50%',
            width: 32,
            height: 32,
            cursor: canSend ? 'pointer' : 'not-allowed',
            opacity: 1,
          }}
          onClick={() => { if (isCommand && filtered[0]) runCommand(filtered[0].href); else handleSubmit() }}
          disabled={!canSend}
          title={isCommand ? 'Lancer la commande (Entrée)' : 'Envoyer (Entrée)'}
          onMouseEnter={e => { if (canSend) (e.currentTarget as HTMLElement).style.background = '#2563eb' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = canSend ? '#3b82f6' : 'rgba(0,0,0,0.08)' }}
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
