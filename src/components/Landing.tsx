'use client'

// ─── Landing — l'accueil pré-connexion (visiteur anonyme) ──────────────────────
//
// Immersion immédiate façon Stitch (stitch.withgoogle.com) : on est directement
// plongé dans le canvas du Journal — grille à points + aurore lumineuse animée
// (flamme bleue) sur fond sombre — avec une grande capture bar en verre dépoli au
// centre. On peut écrire dedans ; c'est en VALIDANT (Entrée / flèche) qu'on part
// vers l'auth. Le fond canvas persiste jusqu'à /auth → transition continue.
//
// Typo = design system des écrans d'accueil AOKnowledge (sites v3) : titres en
// Noto Serif, corps en Space Grotesk, labels en Inter (chargées dans layout.tsx).
// Fond volontairement SOMBRE (className="dark" → tokens sombres) pour faire
// ressortir l'aurore, même si l'app est en clair.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'

const DOT_BG = { backgroundSize: '22px 22px', backgroundPosition: '0px 0px' }

// Familles de marque
const SERIF = 'var(--font-noto-serif), Georgia, serif'
const SANS = 'var(--font-space-grotesk), system-ui, sans-serif'
const LABEL = 'var(--font-inter), system-ui, sans-serif'

export default function Landing() {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  const spotlightRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')

  // Halo qui suit le curseur (repris de CanvasShell) — les points s'illuminent.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const spotlight = spotlightRef.current
    const onMove = (e: MouseEvent) => {
      if (!spotlight) return
      const rect = el.getBoundingClientRect()
      spotlight.style.setProperty('--mx', `${e.clientX - rect.left}px`)
      spotlight.style.setProperty('--my', `${e.clientY - rect.top}px`)
      spotlight.style.opacity = '1'
    }
    const onLeave = () => { if (spotlight) spotlight.style.opacity = '0' }
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  // On laisse écrire ; c'est la validation (Entrée / flèche) qui envoie vers l'auth.
  const goAuth = () => router.push('/auth?redirectTo=/')

  return (
    <div
      ref={rootRef}
      className="dark"
      style={{
        position: 'relative', width: '100%', height: '100vh', overflow: 'hidden',
        background: 'radial-gradient(130% 120% at 50% 6%, #121214 0%, #050506 55%, #000000 100%)',
        color: 'var(--node-title)',
      }}
    >
      {/* Toile de fond : aurore (z0) → grille de points transparente (z1) → spotlight */}
      <div className="canvas-aurora"><span className="aurora-blob" /></div>
      <div className="canvas-grid-dots" style={DOT_BG} />
      <div ref={spotlightRef} className="canvas-dot-spotlight" style={DOT_BG} />

      {/* ── Haut-gauche — wordmark (Noto Serif, capitales) + badge Pré-Alpha (Inter) ── */}
      <div style={{ position: 'absolute', top: 28, left: 38, zIndex: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 18, color: '#f5f7fa', letterSpacing: '-0.01em', textTransform: 'uppercase' }}>
          Journal d&rsquo;Études
        </span>
        <span
          style={{
            fontFamily: LABEL, fontSize: 10, fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase',
            color: '#c2c9d4', padding: '3px 9px', borderRadius: 999,
            background: 'rgba(255, 255, 255, 0.06)', border: '1px solid rgba(255, 255, 255, 0.16)',
          }}
        >
          Pré-Alpha
        </span>
      </div>

      {/* ── Haut-droite — « Essayer » : noir sur blanc, inset du bord pour attirer l'œil ── */}
      <div style={{ position: 'absolute', top: 26, right: 40, zIndex: 20 }}>
        <button
          onClick={goAuth}
          style={{
            fontFamily: LABEL, fontSize: 13.5, fontWeight: 600, color: '#0a0b10', background: '#ffffff',
            padding: '9px 20px', borderRadius: 999, border: 'none', cursor: 'pointer',
            boxShadow: '0 4px 18px rgba(0, 0, 0, 0.35)',
          }}
        >
          Essayer
        </button>
      </div>

      {/* ── Centre — titre Noto Serif, sous-titre Space Grotesk, grande capture bar ── */}
      <div
        style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '0 24px', textAlign: 'center',
        }}
      >
        <h1
          style={{
            fontFamily: SERIF, fontSize: 'clamp(2.8rem, 6.4vw, 4.8rem)', fontWeight: 400,
            letterSpacing: '-0.035em', lineHeight: 1.02, color: '#f5f7fa', maxWidth: 820, margin: 0,
          }}
        >
          Ta connaissance,<br />vivante.
        </h1>
        <p style={{ fontFamily: SANS, marginTop: 20, fontSize: 'clamp(0.98rem, 2vw, 1.18rem)', color: '#aeb6c2', maxWidth: 560, lineHeight: 1.5 }}>
          Le journal d&rsquo;études du trader. Capture, réorganise et relis tes notes jusqu&rsquo;à trouver ton edge.
        </p>

        {/* Grande capture bar en verre dépoli — HAUTE (≈3×), écrire puis valider → /auth */}
        <form onSubmit={(e) => { e.preventDefault(); goAuth() }} style={{ marginTop: 36, width: 'min(720px, 94vw)' }}>
          <div
            style={{
              display: 'flex', flexDirection: 'column', minHeight: 168,
              padding: '20px 22px 16px', borderRadius: 22,
              background: 'rgba(255, 255, 255, 0.055)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              backdropFilter: 'blur(22px) saturate(1.5)', WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
              boxShadow: '0 12px 50px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.10)',
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); goAuth() } }}
              placeholder="Capture une idée, une note, un trade…"
              aria-label="Capturer — valide pour te connecter"
              rows={3}
              style={{ fontFamily: SANS, flex: 1, width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 17, lineHeight: 1.5, color: '#f5f7fa', resize: 'none', padding: 0 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                type="submit"
                aria-label="Envoyer"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 46, height: 46, borderRadius: 14, flexShrink: 0, cursor: 'pointer',
                  border: 'none', background: '#3b82f6', color: '#fff',
                  boxShadow: '0 4px 16px rgba(59, 130, 246, 0.5)',
                }}
              >
                <ArrowRight size={20} />
              </button>
            </div>
          </div>
        </form>

        <button
          onClick={() => router.push('/guide')}
          style={{ fontFamily: LABEL, marginTop: 20, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#8b93a1' }}
        >
          Découvrir le parcours →
        </button>
      </div>
    </div>
  )
}
