'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LifeBuoy, Send, User, X } from 'lucide-react'
import BesoinFormulaire, { EntreeBesoin } from './BesoinFormulaire'
// (06/11, apres-midi) Besoins des membres, pistes A, B et C : le bouton dit
// « Aide et idées », la bulle de decouverte une seule fois, et le formulaire
// pre-rempli ouvert par une ligne de friction (evenement EVENEMENT_OUVRIR_BESOIN).
import {
  EVENEMENT_OUVRIR_BESOIN, LIBELLE_AIDE_IDEES, TEXTE_BULLE_DECOUVERTE, bulleDejaVue, marquerBulleVue, type BesoinPrerempli,
} from '@/lib/besoins/decouverte'

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
  // (06/11) Besoins des membres, lot 2 : « Il me manque quelque chose » dans le meme panneau.
  const [vue, setVue] = useState<'chat' | 'besoin'>('chat')
  // (06/11) Le formulaire pre-rempli par une ligne de friction (piste C) ; `n` le remonte a chaque ouverture.
  const [prerempli, setPrerempli] = useState<(BesoinPrerempli & { n: number }) | null>(null)
  // (06/11) La bulle de decouverte (piste B) : une seule fois, jamais avant d'avoir lu le navigateur.
  const [bulle, setBulle] = useState(false)
  const threadIdRef = useRef<string | null>(null)
  const loadedRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // B : montree une fois = vue (fermee ou non, elle ne revient pas). Stockage
  // illisible : pas de bulle. L'apparition est en CSS, aucune minuterie.
  useEffect(() => {
    if (bulleDejaVue()) return
    marquerBulleVue()
    setBulle(true)
  }, [])

  // C : une ligne de friction ouvre « Il me manque quelque chose » pre-rempli.
  useEffect(() => {
    const ouvrir = (e: Event) => {
      const d = (e as CustomEvent<BesoinPrerempli>).detail
      if (!d || typeof d.texte !== 'string') return
      setPrerempli(p => ({ texte: d.texte, signal: typeof d.signal === 'string' ? d.signal : null, n: (p?.n ?? 0) + 1 }))
      setVue('besoin')
      setBulle(false)
      setOpen(true)
    }
    window.addEventListener(EVENEMENT_OUVRIR_BESOIN, ouvrir)
    return () => window.removeEventListener(EVENEMENT_OUVRIR_BESOIN, ouvrir)
  }, [])

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

  // (06/11, piste A) Le bouton dit « Aide et idées » : en toutes lettres dans la
  // pill (comme ses voisins « Relire », « Notes »), en libelle du bouton rond.
  const basculer = () => {
    setBulle(false)
    setOpen(o => !o)
  }

  // Retour au support : le formulaire libre la prochaine fois (sans phrase ni signal).
  const fermerBesoin = () => {
    setVue('chat')
    setPrerempli(null)
  }

  const trigger =
    variant === 'round' ? (
      <button
        onClick={basculer}
        className="canvas-float-pill"
        title={LIBELLE_AIDE_IDEES}
        aria-label={LIBELLE_AIDE_IDEES}
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
        onClick={basculer}
        title={LIBELLE_AIDE_IDEES}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          padding: '4px 8px', border: 'none', background: 'none', borderRadius: 6,
          cursor: 'pointer', fontSize: 12, color: open ? '#3b82f6' : 'var(--node-meta)',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = open ? '#3b82f6' : 'var(--node-title)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = open ? '#3b82f6' : 'var(--node-meta)' }}
      >
        <LifeBuoy size={14} />
        {LIBELLE_AIDE_IDEES}
      </button>
    )

  // (06/11, piste B) La bulle de decouverte, une seule fois : au-dessus du
  // bouton, apparition en CSS (animation retardee, aucune minuterie JS), sans
  // mouvement si le systeme le demande. Un clic ouvre le panneau, la croix la ferme.
  const bulleDecouverte =
    bulle && !open && typeof document !== 'undefined'
      ? createPortal(
          <div
            role="status"
            className="canvas-float-pill aok-bulle-aide"
            style={{
              position: 'fixed', right: 14, bottom: variant === 'round' ? 118 : 60, zIndex: 85,
              maxWidth: 'min(260px, calc(100vw - 28px))', display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '10px 10px 10px 12px', fontSize: 13, lineHeight: 1.45, color: 'var(--node-title)',
            }}
          >
            <style>{`
              @keyframes aokBulleAide { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
              .aok-bulle-aide { animation: aokBulleAide 0.35s ease-out 1.2s both }
              @media (prefers-reduced-motion: reduce) { .aok-bulle-aide { animation: none } }
            `}</style>
            <button
              onClick={basculer}
              style={{ flex: 1, border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }}
            >
              {TEXTE_BULLE_DECOUVERTE}
            </button>
            <button
              onClick={() => setBulle(false)}
              aria-label="Fermer"
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--node-meta)', display: 'flex', padding: 0 }}
            >
              <X size={14} />
            </button>
          </div>,
          document.body
        )
      : null

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
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--node-title)' }}>{LIBELLE_AIDE_IDEES}</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--node-meta)', display: 'flex' }}
              >
                <X size={16} />
              </button>
            </div>

            {vue === 'besoin' && (
              <BesoinFormulaire
                key={prerempli?.n ?? 0}
                app={APP_ID}
                onFermer={fermerBesoin}
                texteInitial={prerempli?.texte}
                signal={prerempli?.signal ?? null}
              />
            )}

            {vue === 'chat' && (<>
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

            {/* (06/11) Besoins des membres : l'entree visible, au-dessus de « Parler à un humain ». */}
            <EntreeBesoin onOuvrir={() => setVue('besoin')} />

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
            </>)}
          </div>,
          document.body
        )
      : null

  return (
    <>
      {trigger}
      {bulleDecouverte}
      {panel}
    </>
  )
}
