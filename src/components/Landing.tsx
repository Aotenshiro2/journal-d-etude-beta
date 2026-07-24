'use client'

// ─── Landing — l'accueil pré-connexion (visiteur anonyme) ──────────────────────
//
// Immersion immédiate façon Stitch (stitch.withgoogle.com) : on est directement
// plongé dans le canvas du Journal — grille à points + aurore lumineuse animée —
// avec une capture bar au centre. Le geste central du produit (capturer) sert de
// teaser : dès qu'on engage la barre (ou qu'on clique « Essayer »), on part vers
// l'auth. Le fond canvas persiste jusqu'à /auth → transition continue.
//
// L'aurore et la grille vivent dans globals.css (.canvas-aurora, .canvas-grid-dots,
// .canvas-dot-spotlight). Ici on ne fait que suivre le curseur pour le spotlight.

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'

const DOT_BG = { backgroundSize: '22px 22px', backgroundPosition: '0px 0px' }

export default function Landing() {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  const spotlightRef = useRef<HTMLDivElement>(null)

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

  const goAuth = () => router.push('/auth?redirectTo=/')

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden', background: 'var(--canvas-bg)' }}
    >
      {/* Toile de fond : aurore (z0) → grille de points transparente (z1) → spotlight → fade */}
      <div className="canvas-aurora"><span className="aurora-blob" /></div>
      <div className="canvas-grid-dots" style={DOT_BG} />
      <div ref={spotlightRef} className="canvas-dot-spotlight" style={DOT_BG} />
      <div className="canvas-top-gradient" />

      {/* ── Haut-gauche — nom + badge Pré-Alpha (l'accueil est le seul écran avec le titre) ── */}
      <div style={{ position: 'absolute', top: 16, left: 18, zIndex: 20, display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--node-title)', letterSpacing: '-0.02em' }}>
          Journal d&rsquo;Études
        </span>
        <span
          className="canvas-float-pill"
          style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--node-meta)', padding: '2px 8px' }}
        >
          Pré-Alpha
        </span>
      </div>

      {/* ── Haut-droite — « Essayer » (équivalent Try now) ── */}
      <div style={{ position: 'absolute', top: 14, right: 16, zIndex: 20 }}>
        <button
          onClick={goAuth}
          className="canvas-float-pill"
          style={{ fontSize: 13, fontWeight: 600, color: 'var(--node-title)', padding: '7px 16px', cursor: 'pointer', border: 'none' }}
        >
          Essayer
        </button>
      </div>

      {/* ── Centre — peu de mots, capture bar ── */}
      <div
        style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '0 24px', textAlign: 'center',
        }}
      >
        <h1
          style={{
            fontSize: 'clamp(2.4rem, 6vw, 4rem)', fontWeight: 600, letterSpacing: '-0.03em',
            lineHeight: 1.05, color: 'var(--node-title)', maxWidth: 720, margin: 0,
          }}
        >
          Ta connaissance,<br />vivante.
        </h1>
        <p style={{ marginTop: 18, fontSize: 'clamp(0.95rem, 2vw, 1.15rem)', color: 'var(--node-preview)', maxWidth: 520, lineHeight: 1.5 }}>
          Le journal d&rsquo;études du trader — capture, réorganise et relis tes notes jusqu&rsquo;à trouver ton edge.
        </p>

        {/* Capture bar — engager la barre part vers l'auth (teaser du geste « capturer ») */}
        <form onSubmit={(e) => { e.preventDefault(); goAuth() }} style={{ marginTop: 34, width: 'min(620px, 92vw)' }}>
          <div
            className="canvas-float-pill"
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 14px 14px 18px', borderRadius: 16 }}
          >
            <input
              type="text"
              onFocus={goAuth}
              onMouseDown={(e) => { e.preventDefault(); goAuth() }}
              placeholder="Capture une idée, une note, un trade…"
              aria-label="Capturer — commence par te connecter"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 15, color: 'var(--node-title)' }}
            />
            <button
              type="submit"
              aria-label="Commencer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 34, height: 34, borderRadius: 10, flexShrink: 0, cursor: 'pointer',
                border: 'none', background: '#3b82f6', color: '#fff',
              }}
            >
              <ArrowRight size={17} />
            </button>
          </div>
        </form>

        <button
          onClick={() => router.push('/guide')}
          style={{ marginTop: 18, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: 'var(--node-meta)' }}
        >
          Découvrir le parcours →
        </button>
      </div>
    </div>
  )
}
