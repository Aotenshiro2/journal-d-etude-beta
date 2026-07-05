import { TrendingDown, Crosshair, LineChart } from 'lucide-react'

const GRADES = ['A', 'B', 'C'] as const
const GRADE_COLOR: Record<string, string> = { A: '#22c55e', B: '#f59e0b', C: '#ef4444' }
const CAUSES = [
  { key: 'technique', label: 'Technique' },
  { key: 'connaissance', label: 'Connaissance' },
  { key: 'emotionnel', label: 'Émotionnel' },
] as const
const OUTCOMES = [
  { key: 'gain', label: 'Gain', color: '#22c55e' },
  { key: 'perte', label: 'Perte', color: '#ef4444' },
  { key: 'be', label: 'BE', color: 'var(--node-meta)' },
] as const

export type AnalyticsStats = {
  total: number
  grades: Record<string, number>
  causes: Record<string, number>
  calibration: Record<string, Record<string, number>>
  tradeVerdicts: number
  timeline: { month: string; A: number; B: number; C: number }[]
}

function Section({ icon: Icon, title, subtitle, children }: { icon: React.ElementType; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl p-5" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', boxShadow: 'var(--node-shadow)' }}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} style={{ color: 'var(--node-title)' }} />
        <h2 className="text-sm font-semibold" style={{ color: 'var(--node-title)' }}>{title}</h2>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--node-meta)' }}>{subtitle}</p>
      {children}
    </section>
  )
}

export default function AnalyticsView({ stats }: { stats: AnalyticsStats }) {
  const g = stats.grades
  const gradeTotal = g.A + g.B + g.C
  const causeTotal = CAUSES.reduce((s, c) => s + (stats.causes[c.key] ?? 0), 0)
  const maxCause = Math.max(1, ...CAUSES.map(c => stats.causes[c.key] ?? 0))
  const maxMonth = Math.max(1, ...stats.timeline.map(t => t.A + t.B + t.C))

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
        <div>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--node-title)' }}>Analyser mes données</h1>
          <p className="text-sm" style={{ color: 'var(--node-meta)' }}>
            Ce que tes jugements révèlent. L&apos;objectif n&apos;est pas de multiplier les A, mais de <span style={{ color: '#ef4444' }}>faire fondre tes C</span> — remonter ton plancher (inchworm).
          </p>
        </div>

        {gradeTotal === 0 && (
          <div className="rounded-xl px-4 py-3 text-xs" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-meta)' }}>
            Aucun jugement A/B/C pour l&apos;instant. Note tes trades et tes journées (« 30, une lettre, une phrase ») : ces analyses se rempliront toutes seules.
          </div>
        )}

        {/* ── Où je perds ── */}
        <Section icon={TrendingDown} title="Où je perds" subtitle="La répartition de tes notes et, surtout, la cause de tes B et C — ton levier n°1.">
          <div className="flex items-end gap-3 mb-5">
            {GRADES.map(grade => (
              <div key={grade} className="flex-1 text-center">
                <div className="text-2xl font-bold" style={{ color: GRADE_COLOR[grade] }}>{g[grade]}</div>
                <div className="text-[11px]" style={{ color: 'var(--node-meta)' }}>{grade}</div>
              </div>
            ))}
          </div>
          {gradeTotal > 0 && (
            <div className="flex h-2 rounded-full overflow-hidden mb-5" style={{ background: 'var(--canvas-bg)' }}>
              {GRADES.map(grade => g[grade] > 0 && <div key={grade} style={{ width: `${(g[grade] / gradeTotal) * 100}%`, background: GRADE_COLOR[grade] }} />)}
            </div>
          )}
          {causeTotal > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--node-meta)' }}>Causes</p>
              {CAUSES.map(c => (
                <div key={c.key} className="flex items-center gap-3">
                  <span className="text-xs w-24 flex-shrink-0" style={{ color: 'var(--node-title)' }}>{c.label}</span>
                  <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--canvas-bg)' }}>
                    <div className="h-full rounded-full" style={{ width: `${((stats.causes[c.key] ?? 0) / maxCause) * 100}%`, background: 'var(--node-title)' }} />
                  </div>
                  <span className="text-xs w-6 text-right" style={{ color: 'var(--node-meta)' }}>{stats.causes[c.key] ?? 0}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--node-meta)', opacity: 0.8 }}>Aucune cause renseignée — ajoute une catégorie (technique / connaissance / émotionnel) à tes jugements de perte.</p>
          )}
        </Section>

        {/* ── Calibration ── */}
        <Section icon={Crosshair} title="Calibration — note × résultat" subtitle="Tes A gagnent-ils ? Tes C perdent-ils ? Le jugement est découplé du résultat : un A peut être une perte bien jouée.">
          {stats.tradeVerdicts > 0 ? (
            <div className="overflow-x-auto">
              <table className="text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th className="px-3 py-1.5"></th>
                    {OUTCOMES.map(o => <th key={o.key} className="px-3 py-1.5 text-center font-medium" style={{ color: o.color }}>{o.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {GRADES.map(grade => (
                    <tr key={grade}>
                      <td className="px-3 py-1.5 font-semibold" style={{ color: GRADE_COLOR[grade] }}>{grade}</td>
                      {OUTCOMES.map(o => {
                        const v = stats.calibration[grade]?.[o.key] ?? 0
                        return <td key={o.key} className="px-3 py-1.5 text-center rounded" style={{ color: v ? 'var(--node-title)' : 'var(--node-meta)', background: v ? `${o.color}18` : 'transparent', fontWeight: v ? 600 : 400 }}>{v}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--node-meta)', opacity: 0.8 }}>Pas encore de trade noté avec un résultat. Note quelques trades (A/B/C) : la grille croisera ton jugement et l&apos;issue.</p>
          )}
        </Section>

        {/* ── Progression ── */}
        <Section icon={LineChart} title="Progression" subtitle="Tes notes dans le temps. Le signe qui compte : la part de C qui diminue — le plancher qui remonte.">
          {stats.timeline.length >= 2 ? (
            <div className="flex items-end gap-2" style={{ height: 120 }}>
              {stats.timeline.map(t => {
                const tot = t.A + t.B + t.C
                return (
                  <div key={t.month} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col-reverse rounded-md overflow-hidden" style={{ height: 90, background: 'var(--canvas-bg)' }}>
                      {GRADES.map(grade => t[grade] > 0 && <div key={grade} title={`${t[grade]} ${grade}`} style={{ height: `${(t[grade] / maxMonth) * 100}%`, background: GRADE_COLOR[grade] }} />)}
                    </div>
                    <span className="text-[9px]" style={{ color: 'var(--node-meta)' }}>{t.month.slice(5)}/{t.month.slice(2, 4)}</span>
                    <span className="text-[9px]" style={{ color: 'var(--node-meta)', opacity: 0.6 }}>{tot}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--node-meta)', opacity: 0.8 }}>Pas encore assez d&apos;historique (il faut des jugements sur plusieurs mois). La courbe du plancher apparaîtra ici.</p>
          )}
        </Section>
      </div>
    </div>
  )
}
