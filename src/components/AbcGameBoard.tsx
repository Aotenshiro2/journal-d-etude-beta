'use client'
import { useRef, useState } from 'react'
import { Target, Quote } from 'lucide-react'

type Level = { count: number; causes: Record<string, number>; phrases: string[]; signals: string[] }
export type GameData = {
  levels: Record<'A' | 'B' | 'C', Level>
  reflection: { aGame: string; bGame: string; cGame: string; focus: string }
}

const CAUSE_LABEL: Record<string, string> = { technique: 'Technique', connaissance: 'Connaissance', emotionnel: 'Émotionnel' }

const COLUMNS = [
  { key: 'aGame' as const, grade: 'A' as const, title: 'A-game', color: '#22c55e', prompt: 'Ton meilleur jeu. Qu\'est-ce qui le caractérise — comment tu penses, ressens, agis quand tu joues A ?' },
  { key: 'bGame' as const, grade: 'B' as const, title: 'B-game', color: '#f59e0b', prompt: 'Ton jeu moyen. Ce qui te fait décrocher du A sans encore dérailler.' },
  { key: 'cGame' as const, grade: 'C' as const, title: 'C-game', color: '#ef4444', prompt: 'Ton pire jeu. Ce qui revient quand ça déraille — c\'est ton plancher, à remonter en premier.' },
]

export default function AbcGameBoard({ data }: { data: GameData }) {
  const values = useRef({ ...data.reflection })
  const [saved, setSaved] = useState<string | null>(null)

  const save = async (field: keyof GameData['reflection'], value: string) => {
    if (values.current[field] === value) return
    values.current[field] = value
    try {
      await fetch('/api/game', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }) })
      setSaved(field)
      setTimeout(() => setSaved(s => (s === field ? null : s)), 1500)
    } catch { /* sauvegarde optimiste — on retentera au prochain blur */ }
  }

  const total = data.levels.A.count + data.levels.B.count + data.levels.C.count

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-5">
        <div>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--node-title)' }}>Ma carte A/B/C-game</h1>
          <p className="text-sm" style={{ color: 'var(--node-meta)' }}>
            Tes trois niveaux de jeu (Tendler). Ce qui revient à chacun — nourri par tes trades notés. En cartographiant ton <span style={{ color: '#ef4444' }}>C-game</span>, tu vois ton chantier : le plancher à remonter.
          </p>
        </div>

        {total === 0 && (
          <div className="rounded-xl px-4 py-3 text-xs" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-meta)' }}>
            Encore aucun trade noté. À mesure que tu notes tes trades (A/B/C), les signaux de chaque niveau se rempliront ici. Tu peux déjà écrire ta réflexion — elle est vivante, elle évoluera avec toi.
          </div>
        )}

        {/* Chantier du moment — le focus (destiné à s'afficher plus tard en rappel dans le warmup) */}
        <section className="rounded-2xl p-5" style={{ background: 'var(--node-bg)', border: '1px solid #ef444455', boxShadow: 'var(--node-shadow)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Target size={16} style={{ color: '#ef4444' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--node-title)' }}>Mon chantier du moment</h2>
            {saved === 'focus' && <span className="text-[10px] ml-auto" style={{ color: '#22c55e' }}>enregistré</span>}
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--node-meta)' }}>
            {"Une chose à la fois — le point de ton C-game sur lequel tu travailles. C'est lui que tu garderas en tête dans ton warmup."}
          </p>
          <input
            defaultValue={data.reflection.focus}
            onBlur={e => save('focus', e.target.value)}
            placeholder="Ex. : ne pas re-rentrer après un SL sans repasser par mon plan."
            className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
            style={{ background: 'var(--canvas-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)' }}
          />
        </section>

        {/* 3 colonnes A / B / C-game */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {COLUMNS.map(col => {
            const lvl = data.levels[col.grade]
            const causeEntries = Object.entries(lvl.causes).filter(([, v]) => v > 0)
            const hasData = causeEntries.length > 0 || lvl.signals.length > 0 || lvl.phrases.length > 0
            return (
              <section key={col.key} className="rounded-2xl p-4 flex flex-col" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', boxShadow: 'var(--node-shadow)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: col.color }} />
                  <h3 className="text-sm font-semibold" style={{ color: col.color }}>{col.title}</h3>
                  <span className="text-[11px] ml-auto px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas-bg)', color: 'var(--node-meta)' }}>
                    {lvl.count} jugement{lvl.count > 1 ? 's' : ''}
                  </span>
                </div>

                {/* Signaux nourris par les trades notés */}
                {hasData && (
                  <div className="space-y-2.5 mb-3">
                    {causeEntries.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {causeEntries.map(([k, v]) => (
                          <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `${col.color}18`, color: 'var(--node-title)' }}>{CAUSE_LABEL[k] ?? k} · {v}</span>
                        ))}
                      </div>
                    )}
                    {lvl.signals.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--node-meta)' }}>Ressenti / erreurs (cooldown)</p>
                        <div className="flex flex-wrap gap-1">
                          {[...new Set(lvl.signals)].slice(0, 6).map((s, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: 'var(--canvas-bg)', color: 'var(--node-meta)' }}>{s}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {lvl.phrases.length > 0 && (
                      <div className="space-y-1">
                        {lvl.phrases.slice(0, 4).map((p, i) => (
                          <p key={i} className="text-[11px] italic leading-snug flex gap-1" style={{ color: 'var(--node-meta)' }}>
                            <Quote size={10} className="flex-shrink-0 mt-0.5 opacity-50" /> {p}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Réflexion vivante — ce que l'élève synthétise (persisté) */}
                <div className="mt-auto">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[11px] font-medium" style={{ color: 'var(--node-title)' }}>Ce qui caractérise mon {col.title}</span>
                    {saved === col.key && <span className="text-[10px]" style={{ color: '#22c55e' }}>✓</span>}
                  </div>
                  <textarea
                    defaultValue={data.reflection[col.key]}
                    onBlur={e => save(col.key, e.target.value)}
                    placeholder={col.prompt}
                    rows={4}
                    className="w-full resize-y rounded-lg px-3 py-2 text-[13px] outline-none focus:border-primary"
                    style={{ background: 'var(--canvas-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)', minHeight: 90 }}
                  />
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
