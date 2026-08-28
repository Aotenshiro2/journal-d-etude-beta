'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LifeBuoy, Send, User, X } from 'lucide-react'

// Support AOK — la même bouée que dans l'extension, côté journal web.
// Même origine que les routes /api/support/* : l'auth passe par les cookies
// Supabase (branche 2 de getUserId), pas besoin de Bearer. Fils remontés
// dans le cockpit avec app='journal'.
//
// Deux variantes de déclencheur pour épouser les pills flottantes :
// - 'pill-item' : entrée icône dans la pill d'actions rapides (desktop)
// - 'round'     : bouton rond autonome, empilé au-dessus du « ⋯ » (mobile)
// Le panneau est rendu en portal : .canvas-float-pill a un backdrop-filter,
// qui ferait d'elle le containing block d'un position:fixed enfant.

const APP_ID = 'journal'

type Msg = { role: 'user' | 'assistant' | 'human'; content: string; at?: string }

// Rend cliquables les URLs des réponses (équivalent web du Linkified de l'extension).
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g)
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

export default function SupportBubble({ variant = 'pill-item' }: { variant?: 'pill-item' | 'round' }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const threadIdRef = useRef<string | null>(null)
  const loadedRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending, open])

  // À l'ouverture, rouvrir le dernier fil « journal » : une réponse humaine
  // posée depuis le cockpit doit parvenir au membre ici.
  useEffect(() => {
    if (!open || loadedRef.current) return
    loadedRef.current = true
    fetch(`/api/support/thread?app=${APP_ID}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.threadId && Array.isArray(data.messages)) {
          threadIdRef.current = data.threadId
          setMessages(data.messages as Msg[])
        }
      })
      .catch(() => {})
  }, [open])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setNotice(null)
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setSending(true)
    try {
      const res = await fetch('/api/support/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, threadId: threadIdRef.current ?? undefined, app: APP_ID }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.reply) {
        threadIdRef.current = data.threadId ?? threadIdRef.current
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
      } else {
        setNotice(data.error ?? `Support indisponible (HTTP ${res.status}). Réessaie dans un instant.`)
      }
    } catch {
      setNotice('Connexion impossible. Vérifie ton réseau et réessaie.')
    } finally {
      setSending(false)
    }
  }

  const talkToHuman = async () => {
    let email = 'brice.d@aoknowledge.com'
    let notified = false
    try {
      const res = await fetch('/api/support/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: threadIdRef.current }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.email) email = data.email
      notified = Boolean(data.notified)
    } catch {
      /* mailto de secours ci-dessous */
    }
    if (notified) {
      setNotice("C'est transmis : un membre de l'équipe te répond ici et par email.")
      return
    }
    const transcript = messages
      .map(m => `${m.role === 'user' ? 'Moi' : m.role === 'human' ? 'Équipe' : 'Assistant'} : ${m.content}`)
      .join('\n\n')
      .slice(0, 1400)
    const body = encodeURIComponent(
      `Bonjour,\n\n[Décris ton problème ici]\n\n--- Échange avec l'assistant ---\n${transcript}`
    )
    window.location.href = `mailto:${email}?subject=${encodeURIComponent("Support — Journal d'Études")}&body=${body}`
  }

  const trigger =
    variant === 'round' ? (
      <button
        onClick={() => setOpen(o => !o)}
        className="canvas-float-pill"
        title="Contacter le support"
        aria-label="Contacter le support"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 42, height: 42, border: 'none', cursor: 'pointer',
          color: open ? '#3b82f6' : 'var(--node-title)', marginBottom: 8,
        }}
      >
        <LifeBuoy size={17} />
      </button>
    ) : (
      <button
        onClick={() => setOpen(o => !o)}
        title="Contacter le support"
        aria-label="Contacter le support"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '4px 8px', border: 'none', background: 'none', borderRadius: 6,
          cursor: 'pointer', color: open ? '#3b82f6' : 'var(--node-meta)',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = open ? '#3b82f6' : 'var(--node-title)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = open ? '#3b82f6' : 'var(--node-meta)' }}
      >
        <LifeBuoy size={14} />
      </button>
    )

  const panel =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="canvas-float-pill"
            style={{
              position: 'fixed', bottom: 64, right: 14, zIndex: 90,
              width: 360, maxWidth: 'calc(100vw - 28px)',
              height: 480, maxHeight: 'calc(100dvh - 90px)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            {/* En-tête */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--float-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <LifeBuoy size={15} style={{ color: '#3b82f6' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--node-title)' }}>Support</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--node-meta)', display: 'flex' }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Fil */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {messages.length === 0 && !sending && (
                <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--node-preview)', margin: 0 }}>
                  Une question sur le journal, la sync avec l&apos;extension ou ton
                  compte ? Un assistant répond tout de suite, et tu peux demander un
                  humain à tout moment.
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div
                    style={{
                      maxWidth: '85%', padding: '8px 12px', borderRadius: 10,
                      fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                      ...(m.role === 'user'
                        ? { background: '#3b82f6', color: '#fff' }
                        : m.role === 'human'
                          ? { background: 'var(--canvas-bg)', color: 'var(--node-title)', border: '1px solid #3b82f6' }
                          : { background: 'var(--canvas-bg)', color: 'var(--node-title)', border: '1px solid var(--float-border)' }),
                    }}
                  >
                    {m.role === 'human' && (
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#3b82f6', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Équipe AOK
                      </div>
                    )}
                    <Linkified text={m.content} />
                  </div>
                </div>
              ))}
              {sending && (
                <span style={{ fontSize: 12, color: 'var(--node-meta)' }}>L&apos;assistant écrit…</span>
              )}
              {notice && (
                <div style={{ fontSize: 12, color: 'var(--node-preview)', border: '1px solid var(--float-border)', borderRadius: 8, padding: '8px 10px' }}>
                  {notice}
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Parler à un humain — visible sans crier, comme dans l'extension. */}
            <button
              onClick={talkToHuman}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                width: '100%', padding: '8px 0', border: 'none', background: 'none',
                borderTop: '1px solid var(--float-border)', cursor: 'pointer',
                fontSize: 12, color: 'var(--node-meta)',
              }}
            >
              <User size={12} /> Parler à un humain
            </button>

            {/* Saisie */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 12px', borderTop: '1px solid var(--float-border)' }}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                rows={1}
                placeholder="Écris ta question…"
                style={{
                  flex: 1, resize: 'none', maxHeight: 110, border: 'none', outline: 'none',
                  background: 'none', fontSize: 13, lineHeight: 1.5, color: 'var(--node-title)',
                  fontFamily: 'inherit',
                }}
              />
              <button
                onClick={send}
                disabled={sending || !input.trim()}
                aria-label="Envoyer"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32, borderRadius: 999, border: 'none', cursor: 'pointer',
                  background: '#3b82f6', color: '#fff', flexShrink: 0,
                  opacity: sending || !input.trim() ? 0.4 : 1,
                }}
              >
                <Send size={14} />
              </button>
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      {trigger}
      {panel}
    </>
  )
}
