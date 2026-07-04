'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, SkipForward, ArrowRight } from 'lucide-react'
import { AnnotationData } from '@/types'

// Un élément à relire = une annotation A/B/C + le contexte minimal (sa note)
export type ReviewItem = AnnotationData & {
  note?: { id: string; title: string; favicon: string | null } | null
}

const GRADE_CLASS: Record<string, string> = {
  A: 'bg-green-400/10 text-green-500 border-green-500/30',
  B: 'bg-amber-400/10 text-amber-500 border-amber-500/30',
  C: 'bg-red-400/10 text-red-500 border-red-500/30',
}
const GRADES = ['A', 'B', 'C'] as const
const CAUSES: { key: string; label: string }[] = [
  { key: 'technique', label: 'Technique' },
  { key: 'connaissance', label: 'Connaissance' },
  { key: 'emotionnel', label: 'Émotionnel' },
]

// Une carte de relecture : re-juger vite (garder ou requalifier) + une phrase.
function ReviewCard({ item, onReviewed, onSkip }: {
  item: ReviewItem
  onReviewed: (grade: string) => void
  onSkip: () => void
}) {
  const [grade, setGrade] = useState<string>(item.grade)
  const [phrase, setPhrase] = useState<string>(item.phrase)
  const [cause, setCause] = useState<string | null>(item.causeCategory ?? null)
  const [saving, setSaving] = useState(false)

  const changed = grade !== item.grade || phrase.trim() !== item.phrase || (cause ?? null) !== (item.causeCategory ?? null)

  const submit = async () => {
    if (saving) return
    setSaving(true)
    try {
      await fetch('/api/annotations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, grade, phrase: phrase.trim() || item.phrase, causeCategory: cause, reviewed: true }),
      })
      onReviewed(grade)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="w-full rounded-2xl"
      style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', boxShadow: 'var(--node-shadow)', padding: 24 }}
    >
      {/* Contexte : la note d'où vient le jugement */}
      <div className="flex items-center gap-2 mb-5" style={{ color: 'var(--node-meta)' }}>
        {item.note?.favicon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.note.favicon} alt="" style={{ width: 14, height: 14, borderRadius: 3 }} />
        )}
        {item.note ? (
          <Link href={`/notes/${item.note.id}`} className="text-xs hover:underline truncate" style={{ color: 'var(--node-meta)' }}>
            {item.note.title}
          </Link>
        ) : (
          <span className="text-xs">Sans note</span>
        )}
        {item.tradeRef && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas-bg)' }}>trade</span>}
      </div>

      {/* Ce que tu avais écrit — le rappel */}
      <p className="text-[15px] leading-relaxed mb-6" style={{ color: 'var(--node-title)' }}>
        « {item.phrase} »
      </p>

      {/* Re-juger : garder ou requalifier */}
      <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--node-meta)' }}>Ton verdict aujourd&apos;hui</p>
      <div className="flex gap-2 mb-5">
        {GRADES.map(g => (
          <button
            key={g}
            onClick={() => setGrade(g)}
            className={`flex-1 h-11 rounded-xl border text-lg font-semibold transition-all ${grade === g ? GRADE_CLASS[g] : ''}`}
            style={grade === g ? undefined : { borderColor: 'var(--node-border)', color: 'var(--node-meta)' }}
          >
            {g}
          </button>
        ))}
      </div>

      {/* Cause (optionnelle) */}
      <div className="flex flex-wrap gap-2 mb-5">
        {CAUSES.map(c => (
          <button
            key={c.key}
            onClick={() => setCause(cause === c.key ? null : c.key)}
            className="text-xs px-2.5 py-1 rounded-full border transition-colors"
            style={cause === c.key
              ? { borderColor: 'var(--node-title)', color: 'var(--node-title)', background: 'var(--canvas-bg)' }
              : { borderColor: 'var(--node-border)', color: 'var(--node-meta)' }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Phrase — la reformuler si le regard a changé */}
      <textarea
        value={phrase}
        onChange={e => setPhrase(e.target.value)}
        rows={2}
        placeholder="Une phrase : pourquoi cette note aujourd'hui…"
        className="w-full resize-none rounded-xl px-3 py-2 text-sm outline-none mb-5"
        style={{ background: 'var(--canvas-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)' }}
      />

      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onSkip}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg transition-colors"
          style={{ color: 'var(--node-meta)' }}
        >
          <SkipForward size={13} /> Passer
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="flex items-center gap-2 text-sm font-medium px-5 py-2.5 rounded-xl text-white disabled:opacity-50"
          style={{ background: '#3b82f6' }}
        >
          <Check size={15} /> {changed ? 'Requalifier et continuer' : 'Garder et continuer'}
        </button>
      </div>
    </div>
  )
}

export default function ReviewDeck({ items }: { items: ReviewItem[] }) {
  const [idx, setIdx] = useState(0)
  const [tally, setTally] = useState<Record<string, number>>({ A: 0, B: 0, C: 0 })
  const [reviewedCount, setReviewedCount] = useState(0)
  const [skipped, setSkipped] = useState(0)

  const total = items.length
  const done = idx >= total

  const advance = () => setIdx(i => i + 1)
  const onReviewed = (grade: string) => {
    setTally(t => ({ ...t, [grade]: (t[grade] ?? 0) + 1 }))
    setReviewedCount(c => c + 1)
    advance()
  }
  const onSkip = () => { setSkipped(s => s + 1); advance() }

  if (total === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 opacity-30">🌱</div>
          <p className="text-sm mb-1" style={{ color: 'var(--node-title)' }}>Rien à relire pour l&apos;instant</p>
          <p className="text-xs mb-5" style={{ color: 'var(--node-meta)' }}>Tes jugements A/B/C reviennent ici deux semaines après avoir été posés.</p>
          <Link href="/" className="text-sm hover:underline" style={{ color: '#3b82f6' }}>← Retour à la carte</Link>
        </div>
      </div>
    )
  }

  if (done) {
    const maxTally = Math.max(1, tally.A, tally.B, tally.C)
    return (
      <div className="flex-1 flex items-center justify-center px-5">
        <div className="w-full max-w-md text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--node-title)' }}>Session de relecture terminée</h2>
          <p className="text-xs mb-7" style={{ color: 'var(--node-meta)' }}>
            {reviewedCount} relu{reviewedCount > 1 ? 's' : ''}{skipped > 0 ? ` · ${skipped} passé${skipped > 1 ? 's' : ''}` : ''}
          </p>

          {/* Répartition A/B/C de la session */}
          <div className="space-y-2.5 mb-8 text-left">
            {GRADES.map(g => (
              <div key={g} className="flex items-center gap-3">
                <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold ${GRADE_CLASS[g]}`}>{g}</span>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--canvas-bg)' }}>
                  <div className="h-full rounded-full" style={{ width: `${(tally[g] / maxTally) * 100}%`, background: g === 'A' ? '#22c55e' : g === 'B' ? '#f59e0b' : '#ef4444', transition: 'width 0.4s' }} />
                </div>
                <span className="text-xs w-5 text-right" style={{ color: 'var(--node-meta)' }}>{tally[g]}</span>
              </div>
            ))}
          </div>

          <Link href="/" className="inline-block text-sm font-medium px-5 py-2.5 rounded-xl text-white" style={{ background: '#3b82f6' }}>
            Retour à la carte
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-lg mx-auto px-5 py-10">
        {/* Progression */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--canvas-bg)' }}>
            <div className="h-full rounded-full" style={{ width: `${(idx / total) * 100}%`, background: '#3b82f6', transition: 'width 0.3s' }} />
          </div>
          <span className="text-xs flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--node-meta)' }}>
            {idx + 1} <ArrowRight size={11} className="opacity-40" /> {total}
          </span>
        </div>

        <ReviewCard key={items[idx].id} item={items[idx]} onReviewed={onReviewed} onSkip={onSkip} />

        <p className="text-center text-[11px] mt-5" style={{ color: 'var(--node-meta)', opacity: 0.7 }}>
          Une lettre, une phrase — le regard qui compte, pas le résultat.
        </p>
      </div>
    </div>
  )
}
