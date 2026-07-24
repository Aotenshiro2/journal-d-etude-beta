'use client'

// ─── OnboardingOverlay — l'accueil du nouvel élève, en surcouche sur le canvas ──
//
// DA (Brice) : « le canvas se métamorphose » — pas de nouvelle page. Une couche
// légère par-dessus l'accueil, 2-3 temps, puis on la referme et le canvas est là.
//
// Déclenchement (géré par la home) : au 1er passage (user_metadata.onboarding_completed
// ≠ true), OU forcé par ?welcome=1 depuis le menu (« Revoir le parcours »). À la
// fin, on pose le flag via supabase.auth.updateUser (aucune migration DB).
//
// Contenu = version condensée du /guide (les 3 chemins). La détection de l'extension
// reprend le flag data-aok-installed (cf. EmptyNotesState).

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sparkles, Camera, Compass, ArrowRight, ArrowLeft, X } from 'lucide-react'

const CWS = 'https://chromewebstore.google.com/detail/trading-notes-by-aoknowle/phajegonlmgnjkkfdooedoddnmgpheic'

interface OnboardingOverlayProps {
  /** Visibilité initiale, calculée côté serveur (flag non posé ou ?welcome=1). */
  show: boolean
}

export default function OnboardingOverlay({ show }: OnboardingOverlayProps) {
  const router = useRouter()
  const [visible, setVisible] = useState(show)
  const [step, setStep] = useState(0)
  const [extensionInstalled, setExtensionInstalled] = useState<boolean | null>(null)

  useEffect(() => {
    setExtensionInstalled(document.documentElement.getAttribute('data-aok-installed') === '1')
  }, [])

  // Re-déclenchement : « Revoir le parcours » pousse ?welcome=1 sur la home déjà
  // montée → show passe à true. Sans ce sync, l'état local resterait à sa valeur
  // initiale et l'overlay ne se rouvrirait pas.
  useEffect(() => {
    setVisible(show)
    if (show) setStep(0)
  }, [show])

  if (!visible) return null

  // On pose le flag « déjà vu » puis on referme. Re-déclenchable via ?welcome=1.
  const finish = async () => {
    setVisible(false)
    try {
      const supabase = createClient()
      await supabase.auth.updateUser({ data: { onboarding_completed: true } })
    } catch {
      // silencieux : ne jamais bloquer l'entrée dans l'app sur un échec réseau
    }
    // Nettoie le ?welcome=1 éventuel de l'URL sans recharger
    if (typeof window !== 'undefined' && window.location.search.includes('welcome')) {
      router.replace('/')
    }
  }

  const STEPS = [
    {
      Icon: Sparkles,
      tint: '#3b82f6',
      title: 'Bienvenue dans ton Journal d’Études',
      body: 'Ici, tu captures ce que tu apprends, tu le réorganises à ta main, puis tu le relis jusqu’à ce que ça devienne ton edge. Ton canvas t’attend — laisse-moi te montrer par où commencer.',
      action: null as React.ReactNode,
    },
    {
      Icon: Camera,
      tint: '#f59e0b',
      title: 'Tout commence par une capture',
      body: 'Avec l’extension « Le Carnet du Trader », capture tes cours et tes séances sans friction, pendant que tu regardes ou que tu trades. Elles apparaissent ici, sur ton canvas, automatiquement.',
      action:
        extensionInstalled === null ? null : extensionInstalled ? (
          <button
            onClick={() => document.dispatchEvent(new CustomEvent('aok:open-panel'))}
            style={pillButton('#f59e0b')}
          >
            📌 Ouvrir l&rsquo;extension
          </button>
        ) : (
          <a href={CWS} target="_blank" rel="noopener noreferrer" style={pillButton('#f59e0b')}>
            🧩 Installer l&rsquo;extension Chrome
          </a>
        ),
    },
    {
      Icon: Compass,
      tint: '#a78bfa',
      title: 'Trois chemins, à ton rythme',
      body: 'Apprendre (ancrer la connaissance), trouver ton edge (juger et analyser), et le mental game (ta psychologie). Rien à faire dans l’ordre — le parcours détaillé reste à un clic.',
      action: (
        <button onClick={() => router.push('/guide')} style={pillButton('#a78bfa')}>
          Voir le parcours complet
        </button>
      ),
    },
  ]

  const isLast = step === STEPS.length - 1
  const current = STEPS[step]

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
        background: 'var(--modal-overlay)',
        backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
      }}
    >
      <div
        className="canvas-float-pill"
        style={{ position: 'relative', width: 'min(460px, 94vw)', padding: '28px 26px 22px', borderRadius: 18 }}
      >
        {/* Fermer / passer */}
        <button
          onClick={finish}
          aria-label="Passer"
          style={{
            position: 'absolute', top: 14, right: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--node-meta)',
          }}
        >
          <X size={16} />
        </button>

        {/* Icône du temps */}
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 44, height: 44, borderRadius: 12, marginBottom: 16,
            background: `${current.tint}1a`, border: `1px solid ${current.tint}44`, color: current.tint,
          }}
        >
          <current.Icon size={20} />
        </span>

        <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--node-title)', marginBottom: 8 }}>
          {current.title}
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--node-preview)', marginBottom: current.action ? 18 : 22 }}>
          {current.body}
        </p>

        {current.action && <div style={{ marginBottom: 22 }}>{current.action}</div>}

        {/* Pied : points + navigation */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {STEPS.map((_, i) => (
              <span
                key={i}
                style={{
                  width: i === step ? 18 : 6, height: 6, borderRadius: 999,
                  background: i === step ? current.tint : 'var(--float-border)',
                  transition: 'width 0.2s, background 0.2s',
                }}
              />
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {step > 0 && (
              <button
                onClick={() => setStep(s => s - 1)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px', borderRadius: 9,
                  border: 'none', background: 'none', cursor: 'pointer', color: 'var(--node-meta)', fontSize: 13,
                }}
              >
                <ArrowLeft size={14} /> Retour
              </button>
            )}
            <button
              onClick={() => (isLast ? finish() : setStep(s => s + 1))}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10,
                border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: current.tint, color: '#fff',
              }}
            >
              {isLast ? 'Commencer' : 'Suivant'}
              {!isLast && <ArrowRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function pillButton(tint: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10,
    background: `${tint}14`, border: `1px solid ${tint}33`, color: tint,
    fontSize: 13, fontWeight: 500, cursor: 'pointer', textDecoration: 'none',
  }
}
