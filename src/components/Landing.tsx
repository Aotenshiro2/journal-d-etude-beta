'use client'

// ─── Landing — l'accueil pré-connexion (visiteur anonyme) ──────────────────────
//
// Immersion immédiate façon Stitch (stitch.withgoogle.com) : on est directement
// plongé dans le canvas du Journal — grille à points + aurore lumineuse animée
// (flamme bleue) sur fond sombre — avec une grande capture bar en verre dépoli au
// centre. On peut écrire dedans ; c'est en VALIDANT (Entrée / flèche) qu'on part
// vers l'auth. Le fond canvas persiste jusqu'à /auth → transition continue.
//
// Fond volontairement SOMBRE (className="dark" → tokens sombres : points/texte
// clairs, glass sombre) pour faire ressortir l'aurore, même si l'app est en clair.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'

const DOT_BG = { backgroundSize: '22px 22px', backgroundPosition: '0px 0px' }

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
        background: 'radial-gradient(130% 120% at 50% 6%, #14161f 0%, #090a10 55%, #05060b 100%)',
        color: 'var(--node-title)',
      }}
    >
      {/* Toile de fond : aurore (z0) → grille de points transparente (z1) → spotlight */}
      <div className="canvas-aurora"><span className="aurora-blob" /></div>
      <div className="canvas-grid-dots" style={DOT_BG} />
      <div ref={spotlightRef} className="canvas-dot-spotlight" style={DOT_BG} />

      {/* ── Haut-gauche — nom + badge Pré-Alpha (accueil : plus grand, inset) ── */}
      <div style={{ position: 'absolute', top: 28, left: 38, zIndex: 20, display: 'flex', alignItems: 'center', gap: 11 }}>
        <span style={{ fontWeight: 700, fontSize: 18, color: '#f5f7fa', letterSpacing: '-0.02em' }}>
          Journal d&rsquo;Études
        </span>
        <span
          style={{
            fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
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
            fontSize: 14, fontWeight: 600, color: '#0a0b10', background: '#ffffff',
            padding: '9px 20px', borderRadius: 999, border: 'none', cursor: 'pointer',
            boxShadow: '0 4px 18px rgba(0, 0, 0, 0.35)',
          }}
        >
          Essayer
        </button>
      </div>

      {/* ── Centre — peu de mots, grande capture bar ── */}
      <div
        style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '0 24px', textAlign: 'center',
        }}
      >
        <h1
          style={{
            fontSize: 'clamp(2.6rem, 6.2vw, 4.4rem)', fontWeight: 600, letterSpacing: '-0.03em',
            lineHeight: 1.04, color: '#f5f7fa', maxWidth: 760, margin: 0,
          }}
        >
          Ta connaissance,<br />vivante.
        </h1>
        <p style={{ marginTop: 18, fontSize: 'clamp(0.98rem, 2vw, 1.18rem)', color: '#aeb6c2', maxWidth: 560, lineHeight: 1.5 }}>
          Le journal d&rsquo;études du trader. Capture, réorganise et relis tes notes jusqu&rsquo;à trouver ton edge.
        </p>

        {/* Grande capture bar en verre dépoli — écrire puis valider → /auth */}
        <form onSubmit={(e) => { e.preventDefault(); goAuth() }} style={{ marginTop: 38, width: 'min(720px, 94vw)' }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '8px 8px 8px 22px', borderRadius: 20,
              background: 'rgba(255, 255, 255, 0.055)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              backdropFilter: 'blur(22px) saturate(1.5)', WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
              boxShadow: '0 12px 50px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.10)',
            }}
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Capture une idée, une note, un trade…"
              aria-label="Capturer — valide pour te connecter"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 17, color: '#f5f7fa', padding: '14px 0' }}
            />
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
        </form>

        <button
          onClick={() => router.push('/guide')}
          style={{ marginTop: 20, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#8b93a1' }}
        >
          Découvrir le parcours →
        </button>
      </div>
    </div>
  )
}
