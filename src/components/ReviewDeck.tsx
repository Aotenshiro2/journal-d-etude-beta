'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, SkipForward, ArrowRight, ExternalLink, TrendingUp, BookOpen } from 'lucide-react'
import { AnnotationData, MessageData, CanvasNodeData } from '@/types'
import DocumentView from './DocumentView'

// Un élément de relecture = UNE note réorganisée. On relit d'abord la réorganisation
// (structure, blocs, images en grand) ; le verdict A/B/C n'est central que pour un
// trade / journal de journée. Une note de cours se relit, elle ne se « note » pas.
export type ReviewNote = {
  note: { id: string; title: string; favicon: string | null }
  isTradeMaterial: boolean
  nodes: CanvasNodeData[]
  messages: MessageData[]
  verdicts: AnnotationData[]
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

// Re-jugement d'un verdict (trade / journal) — compact, sous la relecture.
function VerdictRow({ v, onJudged }: { v: AnnotationData; onJudged: (grade: string) => void }) {
  const [grade, setGrade] = useState<string>(v.grade)
  const [phrase, setPhrase] = useState<string>(v.phrase)
  const [cause, setCause] = useState<string | null>(v.causeCategory ?? null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const changed = grade !== v.grade || phrase.trim() !== v.phrase || (cause ?? null) !== (v.causeCategory ?? null)

  const submit = async () => {
    if (saving) return
    setSaving(true)
    try {
      await fetch('/api/annotations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id, grade, phrase: phrase.trim() || v.phrase, causeCategory: cause, reviewed: true }),
      })
      setSaved(true)
      onJudged(grade)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--canvas-bg)', border: '1px solid var(--node-border)', opacity: saved ? 0.6 : 1 }}>
      <div className="flex items-center gap-1.5 mb-2">
        {GRADES.map(g => (
          <button
            key={g}
            disabled={saved}
            onClick={() => setGrade(g)}
            className={`w-8 h-8 rounded-lg border text-sm font-semibold transition-all ${grade === g ? GRADE_CLASS[g] : ''}`}
            style={grade === g ? undefined : { borderColor: 'var(--node-border)', color: 'var(--node-meta)' }}
          >
            {g}
          </button>
        ))}
        <div className="flex flex-wrap gap-1 ml-1">
          {CAUSES.map(c => (
            <button
              key={c.key}
              disabled={saved}
              onClick={() => setCause(cause === c.key ? null : c.key)}
              className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
              style={cause === c.key
                ? { borderColor: 'var(--node-title)', color: 'var(--node-title)' }
                : { borderColor: 'var(--node-border)', color: 'var(--node-meta)' }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <textarea
        value={phrase}
        disabled={saved}
        onChange={e => setPhrase(e.target.value)}
        rows={2}
        className="w-full resize-none rounded-lg px-2.5 py-1.5 text-[13px] outline-none mb-2"
        style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)' }}
      />
      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={saved || saving}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
          style={{ background: saved ? '#22c55e' : '#3b82f6' }}
        >
          <Check size={13} /> {saved ? 'Relu' : changed ? 'Requalifier' : 'Confirmer'}
        </button>
      </div>
    </div>
  )
}

function RelectureCard({ item, onRead, onSkip, onJudged }: {
  item: ReviewNote
  onRead: () => void
  onSkip: () => void
  onJudged: (grade: string) => void
}) {
  return (
    <div className="w-full rounded-2xl overflow-hidden" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', boxShadow: 'var(--node-shadow)' }}>
      {/* En-tête : la note + son type */}
      <div className="flex items-center gap-2.5 px-5 py-3.5" style={{ borderBottom: '1px solid var(--float-border)' }}>
        {item.note.favicon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.note.favicon} alt="" style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0 }} />
        )}
        <h2 className="flex-1 min-w-0 text-sm font-semibold truncate" style={{ color: 'var(--node-title)' }}>{item.note.title}</h2>
        <span
          className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full flex-shrink-0"
          style={item.isTradeMaterial
            ? { color: '#f59e0b', background: 'rgba(245,158,11,0.1)' }
            : { color: 'var(--node-meta)', background: 'var(--canvas-bg)' }}
        >
          {item.isTradeMaterial ? <><TrendingUp size={11} /> Trade / journal</> : <><BookOpen size={11} /> Note de cours</>}
        </span>
        <Link href={`/notes/${item.note.id}`} title="Ouvrir pour ré-organiser" className="flex-shrink-0 p-1 rounded-md" style={{ color: 'var(--node-meta)' }}>
          <ExternalLink size={14} />
        </Link>
      </div>

      {/* La réorganisation, relue (lecture seule, images cliquables en grand) */}
      <div className="px-5 py-4 overflow-y-auto" style={{ maxHeight: '52vh' }}>
        <DocumentView nodes={item.nodes} messages={item.messages} readOnly embedded />
      </div>

      {/* Verdict — seulement pour un trade / journal */}
      {item.isTradeMaterial && item.verdicts.length > 0 && (
        <div className="px-5 py-4 space-y-2.5" style={{ borderTop: '1px solid var(--float-border)', background: 'var(--canvas-bg)' }}>
          <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--node-meta)' }}>
            {item.verdicts.length} verdict{item.verdicts.length > 1 ? 's' : ''} — garder ou requalifier
          </p>
          {item.verdicts.map(v => <VerdictRow key={v.id} v={v} onJudged={onJudged} />)}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderTop: '1px solid var(--float-border)' }}>
        <button onClick={onSkip} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg" style={{ color: 'var(--node-meta)' }}>
          <SkipForward size={13} /> Passer
        </button>
        <button onClick={onRead} className="flex items-center gap-2 text-sm font-medium px-5 py-2.5 rounded-xl text-white" style={{ background: '#3b82f6' }}>
          <Check size={15} /> J&apos;ai relu
        </button>
      </div>
    </div>
  )
}

export default function ReviewDeck({ items }: { items: ReviewNote[] }) {
  const [idx, setIdx] = useState(0)
  const [tally, setTally] = useState<Record<string, number>>({ A: 0, B: 0, C: 0 })
  const [readCount, setReadCount] = useState(0)
  const [skipped, setSkipped] = useState(0)

  const total = items.length
  const done = idx >= total

  const advance = () => setIdx(i => i + 1)
  const onRead = () => { setReadCount(c => c + 1); advance() }
  const onSkip = () => { setSkipped(s => s + 1); advance() }
  const onJudged = (grade: string) => setTally(t => ({ ...t, [grade]: (t[grade] ?? 0) + 1 }))

  const judgedTotal = tally.A + tally.B + tally.C

  if (total === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 opacity-30">🌱</div>
          <p className="text-sm mb-1" style={{ color: 'var(--node-title)' }}>Rien à relire pour l&apos;instant</p>
          <p className="text-xs mb-5 max-w-xs" style={{ color: 'var(--node-meta)' }}>Réorganise une note (ouvre-la, trie les blocs en groupes) : elle apparaîtra ici pour la relecture.</p>
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
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--node-title)' }}>Relecture terminée</h2>
          <p className="text-xs mb-7" style={{ color: 'var(--node-meta)' }}>
            {readCount} note{readCount > 1 ? 's' : ''} relue{readCount > 1 ? 's' : ''}{skipped > 0 ? ` · ${skipped} passée${skipped > 1 ? 's' : ''}` : ''}
            {judgedTotal > 0 ? ` · ${judgedTotal} verdict${judgedTotal > 1 ? 's' : ''} re-jugé${judgedTotal > 1 ? 's' : ''}` : ''}
          </p>

          {judgedTotal > 0 && (
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
          )}

          <Link href="/" className="inline-block text-sm font-medium px-5 py-2.5 rounded-xl text-white" style={{ background: '#3b82f6' }}>
            Retour à la carte
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-5 py-8">
        {/* Progression */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--canvas-bg)' }}>
            <div className="h-full rounded-full" style={{ width: `${(idx / total) * 100}%`, background: '#3b82f6', transition: 'width 0.3s' }} />
          </div>
          <span className="text-xs flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--node-meta)' }}>
            {idx + 1} <ArrowRight size={11} className="opacity-40" /> {total}
          </span>
        </div>

        <RelectureCard key={items[idx].note.id} item={items[idx]} onRead={onRead} onSkip={onSkip} onJudged={onJudged} />

        <p className="text-center text-[11px] mt-5" style={{ color: 'var(--node-meta)', opacity: 0.7 }}>
          Relis ta réorganisation — c&apos;est là que la rétention se joue.
        </p>
      </div>
    </div>
  )
}
