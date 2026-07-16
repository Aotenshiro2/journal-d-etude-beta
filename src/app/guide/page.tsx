import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CanvasShell from '@/components/CanvasShell'
import { Camera, LayoutGrid, BookOpen, Lightbulb, PenLine, BarChart2, Compass, Sunrise, ArrowRight, ExternalLink } from 'lucide-react'

const CWS = 'https://chromewebstore.google.com/detail/trading-notes-by-aoknowle/phajegonlmgnjkkfdooedoddnmgpheic'
const EXT_PAGE = 'https://aoknowledge.com/library/extension'

type Step = {
  icon: React.ElementType
  title: string
  desc: string
  links?: { label: string; href: string; external?: boolean }[]
  hint?: string
}
type Track = { key: string; label: string; tint: string; steps: Step[] }

const TRACKS: Track[] = [
  {
    key: 'apprendre', label: 'Apprendre — ancrer la connaissance', tint: '#3b82f6',
    steps: [
      {
        icon: Camera, title: 'Capturer', hint: 'Extension Chrome',
        desc: 'Avec l’extension « Le Carnet du Trader », capture tes cours et tes séances sans friction, pendant que tu regardes ou que tu trades. La mémoire s’étiole vite : capture tout de suite.',
        links: [
          { label: 'Installer l’extension', href: CWS, external: true },
          { label: 'La page dédiée', href: EXT_PAGE, external: true },
        ],
      },
      { icon: LayoutGrid, title: 'Réorganiser', desc: 'Ouvre une note depuis la carte, trie ses blocs en groupes (« ça va avec ça »), bascule en vue document. C’est ce tri qui ancre vraiment la connaissance — ta note d’origine n’est jamais touchée.', links: [{ label: 'Ouvrir la carte', href: '/' }] },
      { icon: BookOpen, title: 'Relire', desc: 'Reviens sur tes notes réorganisées pour les mémoriser. Une note relue est considérée acquise et sort de la file ; tu peux te la reproposer plus tard.', links: [{ label: 'Relecture', href: '/review' }] },
      { icon: Lightbulb, title: 'Observer les concepts', desc: 'Les contextes et variantes qui reviennent dans tes notes émergent ici, avec leurs liens (« va avec »).', links: [{ label: 'Concepts', href: '/concepts' }] },
    ],
  },
  {
    key: 'edge', label: 'Trouver ton edge — juger et analyser', tint: '#f59e0b',
    steps: [
      { icon: PenLine, title: 'Noter A/B/C', hint: 'Depuis l’extension et la relecture', desc: 'Sur tes trades et tes journées : une lettre (A/B/C), une phrase. Découplé du résultat — un A peut être une perte bien jouée. « 30 trades, une lettre, une phrase », puis relis et élimine les C.', links: [{ label: 'Relecture', href: '/review' }] },
      { icon: BarChart2, title: 'Analyser', desc: 'Où tu perds (causes), calibration (ta note face au résultat), progression dans le temps. L’objectif n’est pas de multiplier les A, mais de faire fondre tes C — remonter ton plancher.', links: [{ label: 'Analyse', href: '/analytics' }] },
    ],
  },
  {
    key: 'mental', label: 'Le mental game — ta psychologie', tint: '#a78bfa',
    steps: [
      { icon: Sunrise, title: 'Rituel de séance', desc: 'Un warmup avant (ton état, ta pensée dominante, ton objectif du jour) et un cooldown après (erreurs, leçon, comment tu te recentres). Il cadre ta journée et décharge ton émotion accumulée.', links: [{ label: 'Rituel de séance', href: '/session' }] },
      { icon: Compass, title: 'Pattern Maps', desc: 'Cartographie tes problèmes récurrents (tilt, revenge, FOMO) : l’escalade du déclencheur à l’erreur, pour repérer ton point de bascule avant qu’il n’explose. Relis-les à ton warmup.', links: [{ label: 'Pattern Maps', href: '/patterns' }] },
    ],
  },
]

export default async function GuidePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  let n = 0
  return (
    <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--node-title)' }}>Le parcours</h1>
          <p className="text-sm mb-8" style={{ color: 'var(--node-meta)' }}>
            De la capture d’un cours à la lecture de tes propres patterns. Suis le chemin dans l’ordre — chaque étape prépare la suivante.
          </p>

          <div className="space-y-8">
            {TRACKS.map(track => (
              <section key={track.key}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full" style={{ background: track.tint }} />
                  <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: track.tint }}>{track.label}</h2>
                </div>
                <div className="space-y-2.5">
                  {track.steps.map(step => {
                    n += 1
                    return (
                      <div key={step.title} className="flex gap-3 rounded-2xl p-4" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', boxShadow: 'var(--node-shadow)' }}>
                        <div className="flex flex-col items-center flex-shrink-0">
                          <span className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold" style={{ background: 'var(--canvas-bg)', color: track.tint, border: `1px solid ${track.tint}55` }}>{n}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <step.icon size={15} style={{ color: track.tint }} />
                            <h3 className="text-sm font-semibold" style={{ color: 'var(--node-title)' }}>{step.title}</h3>
                            {step.hint && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas-bg)', color: 'var(--node-meta)' }}>{step.hint}</span>}
                          </div>
                          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--node-preview)' }}>{step.desc}</p>
                          {step.links && step.links.length > 0 && (
                            <div className="flex flex-wrap gap-4 mt-2">
                              {step.links.map(l => l.external ? (
                                <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: track.tint }}>
                                  {l.label} <ExternalLink size={12} />
                                </a>
                              ) : (
                                <Link key={l.href} href={l.href} className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: track.tint }}>
                                  {l.label} <ArrowRight size={12} />
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>

          <p className="text-center text-[11px] mt-10" style={{ color: 'var(--node-meta)', opacity: 0.7 }}>
            Simple en apparence, puissant en profondeur. Reviens ici quand tu veux resituer une étape.
          </p>
        </div>
      </div>
    </CanvasShell>
  )
}
