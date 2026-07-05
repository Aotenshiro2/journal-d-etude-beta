import { Lightbulb } from 'lucide-react'

export type ConceptStat = {
  id: string
  name: string
  color: string
  category: string | null
  noteCount: number
  blockCount: number
  grades: Record<string, number>
  related: { name: string; color: string; shared: number }[]
}

const GRADE_COLOR: Record<string, string> = { A: '#22c55e', B: '#f59e0b', C: '#ef4444' }

// Barre de tendance A/B/C d'un concept (se remplit à mesure que tu juges)
function GradeLean({ grades }: { grades: Record<string, number> }) {
  const total = grades.A + grades.B + grades.C
  if (total === 0) {
    return (
      <p className="text-[11px]" style={{ color: 'var(--node-meta)', opacity: 0.8 }}>
        Tendance à révéler — note des trades/notes portant ce concept
      </p>
    )
  }
  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden" style={{ background: 'var(--canvas-bg)' }}>
        {(['A', 'B', 'C'] as const).map(g => grades[g] > 0 && (
          <div key={g} style={{ width: `${(grades[g] / total) * 100}%`, background: GRADE_COLOR[g] }} title={`${grades[g]} ${g}`} />
        ))}
      </div>
      <div className="flex gap-3 mt-1.5">
        {(['A', 'B', 'C'] as const).map(g => (
          <span key={g} className="text-[10px] flex items-center gap-1" style={{ color: 'var(--node-meta)' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: GRADE_COLOR[g] }} />{g} {grades[g]}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function ConceptsEmergence({ concepts, totalJudged }: { concepts: ConceptStat[]; totalJudged: number }) {
  if (concepts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 opacity-30">🏷️</div>
          <p className="text-sm mb-1" style={{ color: 'var(--node-title)' }}>Aucun concept pour l&apos;instant</p>
          <p className="text-xs max-w-xs mx-auto" style={{ color: 'var(--node-meta)' }}>Tague tes blocs et tes notes (market shift, IOF, session…) : les contextes récurrents apparaîtront ici.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Intention */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Lightbulb size={18} style={{ color: 'var(--node-title)' }} />
            <h1 className="text-xl font-bold" style={{ color: 'var(--node-title)' }}>Ce qui revient dans tes notes</h1>
          </div>
          <p className="text-sm" style={{ color: 'var(--node-meta)' }}>
            Les contextes et variantes qui reviennent le plus. À mesure que tu juges A/B/C, chacun révèle s&apos;il te mène plutôt vers du A ou du C — <span style={{ color: 'var(--node-title)' }}>pas ceux que tu penses, ceux que tes notes confirment.</span>
          </p>
        </div>

        {/* Réalité des données : la tendance a besoin de jugements */}
        {totalJudged < 15 && (
          <div className="mb-6 rounded-xl px-4 py-3 text-xs" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-meta)' }}>
            {concepts.length} concept{concepts.length > 1 ? 's' : ''} · seulement <span style={{ color: '#f59e0b' }}>{totalJudged} jugement{totalJudged > 1 ? 's' : ''}</span> A/B/C posé{totalJudged > 1 ? 's' : ''}.
            La tendance par concept est encore vide — l&apos;exercice « 30 trades, une lettre, une phrase » la fera émerger. En attendant, tu vois déjà tes contextes récurrents et leurs liens.
          </div>
        )}

        {/* Concepts classés */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {concepts.map(c => (
            <div key={c.id} className="rounded-2xl p-4" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', boxShadow: 'var(--node-shadow)' }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
                <h2 className="text-sm font-semibold truncate" style={{ color: 'var(--node-title)' }}>{c.name}</h2>
                {c.category && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: 'var(--canvas-bg)', color: 'var(--node-meta)' }}>{c.category}</span>
                )}
                <span className="text-[11px] ml-auto flex-shrink-0" style={{ color: 'var(--node-meta)' }}>
                  {c.noteCount} note{c.noteCount > 1 ? 's' : ''} · {c.blockCount} bloc{c.blockCount > 1 ? 's' : ''}
                </span>
              </div>

              <div className="my-3">
                <GradeLean grades={c.grades} />
              </div>

              {c.related.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] uppercase tracking-wide mr-1" style={{ color: 'var(--node-meta)', opacity: 0.7 }}>va avec</span>
                  {c.related.map(r => (
                    <span key={r.name} className="text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'var(--canvas-bg)', color: 'var(--node-preview)' }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: r.color }} />{r.name}
                      <span style={{ color: 'var(--node-meta)' }}>·{r.shared}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
