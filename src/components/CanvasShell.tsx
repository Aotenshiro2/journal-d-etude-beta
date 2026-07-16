'use client'

// ─── CanvasShell — le « monde » commun de l'app pour les écrans hors accueil ────
//
// Direction artistique (Brice, 2026-07-11) : quand on change de page, on ne doit
// pas avoir l'impression de quitter l'app — la page d'accueil « se métamorphose »
// en ce dont le nouvel écran a besoin. Le langage commun :
//   • le canvas en toile de fond (dot grid + top gradient),
//   • le dropdown des espaces en haut à gauche (mêmes MODES que l'accueil) — il
//     suffit à dire où tu es : pas de titre à côté (le nom de l'app reste à l'accueil),
//   • les actions rapides du flux en bas à droite (thème · Relire · Notes · Guide),
//   • chaque page pose SON contenu au centre (slot children), avec ses besoins.
//
// NB : l'accueil (NoteMapCanvas) et StudyCanvas sont les références validées — ce
// shell REPRODUIT leur langage sans les modifier. Si le style de la pill ou des
// modes évolue là-bas, répercuter ici (classes partagées dans globals.css :
// .canvas-grid, .canvas-top-gradient, .canvas-float-pill).

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import {
  BookOpen, Lightbulb, BarChart2, Compass, Layers, Sunrise, BookMarked,
  ChevronDown, Sun, Moon,
} from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import UserMenu from './UserMenu'

// Les ESPACES — même liste que l'accueil (NoteMapCanvas.MODES).
const MODES = [
  { label: 'Étudier mes notes',     href: '/',          Icon: BookOpen,   match: (p: string) => p === '/' || p.startsWith('/study') || p.startsWith('/notes') },
  { label: 'Observer les concepts', href: '/concepts',  Icon: Lightbulb,  match: (p: string) => p === '/concepts' },
  { label: 'Analyser mes données',  href: '/analytics', Icon: BarChart2,  match: (p: string) => p === '/analytics' },
  { label: 'Pattern Maps',          href: '/patterns',  Icon: Compass,    match: (p: string) => p === '/patterns' },
  { label: 'Carte A/B/C-game',      href: '/game',      Icon: Layers,     match: (p: string) => p === '/game' },
  { label: 'Rituel de séance',      href: '/session',   Icon: Sunrise,    match: (p: string) => p === '/session' },
  { label: 'Documenter mes trades', href: '/journal',   Icon: BookMarked, match: (p: string) => p === '/journal' },
]

function SpacesDropdown() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const activeMode = MODES.find(m => m.match(pathname)) ?? MODES[0]

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="canvas-float-pill"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 10px', cursor: 'pointer', border: 'none',
          color: 'var(--node-title)', fontSize: 12, fontWeight: 500,
        }}
        title="Changer de module"
      >
        <activeMode.Icon size={13} style={{ color: 'var(--node-meta)', flexShrink: 0 }} />
        <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
          {activeMode.label}
        </span>
        <ChevronDown size={11} style={{ color: 'var(--node-meta)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div
            className="canvas-float-pill"
            style={{ position: 'absolute', top: 42, left: 0, zIndex: 50, minWidth: 210, padding: '6px 0', overflow: 'hidden' }}
          >
            <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--node-meta)', padding: '4px 14px 6px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Modules
            </p>
            {MODES.map(mode => {
              const isActive = mode.match(pathname)
              return (
                <button
                  key={mode.href}
                  onClick={() => { router.push(mode.href); setOpen(false) }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 14px', background: isActive ? 'var(--canvas-bg)' : 'none',
                    border: 'none', cursor: 'pointer', color: 'var(--node-title)', fontSize: 12,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--canvas-bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = isActive ? 'var(--canvas-bg)' : 'none')}
                >
                  <mode.Icon size={13} style={{ color: isActive ? '#3b82f6' : 'var(--node-meta)', flexShrink: 0 }} />
                  <span style={{ flex: 1, textAlign: 'left', color: isActive ? 'var(--node-title)' : 'var(--node-preview)' }}>
                    {mode.label}
                  </span>
                  {isActive && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function ThemeToggleInline() {
  const { theme, toggleTheme } = useTheme()
  return (
    <button
      onClick={toggleTheme}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 30, borderRadius: 8, background: 'none', border: 'none',
        cursor: 'pointer', color: 'var(--node-meta)',
      }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--node-title)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'var(--node-meta)')}
      title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
    >
      {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  )
}

interface CanvasShellProps {
  user: { email: string; name: string }
  /** Badge « Relire » (jugements échus) — même signal que l'accueil. */
  dueCount?: number
  /** Actions propres à la page, injectées dans la pill bas-droite (optionnel). */
  extraActions?: React.ReactNode
  children: React.ReactNode
}

export default function CanvasShell({ user, dueCount, extraActions, children }: CanvasShellProps) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden', background: 'var(--canvas-bg)' }}>
      {/* Toile de fond — même dot grid que l'accueil (statique : pas de zoom ici) */}
      <div className="canvas-grid" style={{ backgroundSize: '24px 24px', backgroundPosition: '0px 0px' }} />
      <div className="canvas-top-gradient" />

      {/* ── Haut-gauche — dropdown des espaces ── */}
      {/* Le dropdown dit à lui seul où tu es : hors accueil, pas de titre en plus
          (le nom de l'app n'est affiché que sur l'accueil). Choix de Brice, 2026-07-16. */}
      <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
        <SpacesDropdown />
      </div>

      {/* ── Haut-droite — menu utilisateur ── */}
      <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 20 }}>
        <UserMenu user={user} />
      </div>

      {/* ── Contenu de la page (chaque écran a ses besoins) ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 10, paddingTop: 56, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {children}
      </div>

      {/* ── Bas-droite — thème + actions rapides du flux (comme l'accueil) ── */}
      <div style={{ position: 'absolute', bottom: 16, right: 14, zIndex: 20 }}>
        <div className="canvas-float-pill" style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 8px' }}>
          <ThemeToggleInline />
          <div style={{ width: 1, height: 16, background: 'var(--float-border)', margin: '0 4px' }} />
          <Link href="/review"
            title="Relire tes jugements A/B/C échus"
            style={{ fontSize: 12, color: dueCount ? 'var(--node-title)' : 'var(--node-meta)', padding: '4px 8px', borderRadius: 6, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            Relire
            {!!dueCount && dueCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 600, color: '#fff', background: '#ef4444', borderRadius: 999, padding: '0 6px', lineHeight: '15px' }}>{dueCount}</span>
            )}
          </Link>
          {[
            { href: '/notes', label: 'Notes' },
            { href: '/guide', label: 'Guide' },
          ].map(({ href, label }) => (
            <Link key={href} href={href}
              style={{ fontSize: 12, color: 'var(--node-meta)', padding: '4px 8px', borderRadius: 6, textDecoration: 'none', display: 'block' }}
            >
              {label}
            </Link>
          ))}
          {extraActions}
        </div>
      </div>
    </div>
  )
}
