'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, SkipForward, ArrowRight, ExternalLink, TrendingUp, BookOpen, CalendarDays, Plus, FolderPlus, ChevronRight, ChevronDown, RotateCcw, Layers } from 'lucide-react'
import { AnnotationData, MessageData, CanvasNodeData } from '@/types'
import DocumentView from './DocumentView'
import { TradeMeta } from './StudyCanvas'

// Une note à relire = une note réorganisée. On relit d'abord la réorganisation
// (structure, blocs, images en grand) ; le verdict A/B/C n'est central que pour
// un trade / journal de journée. Une note de cours se relit, elle ne se note pas.
export type ReviewNote = {
  canvasId: string
  note: { id: string; title: string; favicon: string | null }
  type: 'trade' | 'day' | 'course'
  nodes: CanvasNodeData[]
  messages: MessageData[]
  verdicts: AnnotationData[]
  trades: { id: string; outcome: string | null; startedAt: number | null }[]
}

// Une note de cours pas encore triée : on rappelle à l'élève de faire ce travail.
export type ReorganizeItem = { id: string; title: string; favicon: string | null; folder: string | null }

// Note minimale (déjà relue) — pour la rouvrir à la demande.
export type SimpleNote = { id: string; title: string; favicon: string | null }

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
const TYPE_META: Record<ReviewNote['type'], { label: string; color: string; Icon: React.ElementType }> = {
  trade: { label: 'Positions / trades', color: '#f59e0b', Icon: TrendingUp },
  day: { label: 'Journée / réflexion', color: '#a78bfa', Icon: CalendarDays },
  course: { label: 'Note de cours', color: 'var(--node-meta)', Icon: BookOpen },
}
const OUTCOME: Record<string, { label: string; color: string }> = {
  gain: { label: 'Gain', color: '#22c55e' },
  perte: { label: 'Perte', color: '#ef4444' },
  be: { label: 'BE', color: 'var(--node-meta)' },
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Re-jugement d'un verdict — compact. `label`/`dot` situent le verdict (trade, note entière…).
function VerdictRow({ v, onJudged, label, dot }: { v: AnnotationData; onJudged: (grade: string) => void; label?: string; dot?: string }) {
  const [grade, setGrade] = useState<string>(v.grade)
  const [phrase, setPhrase] = useState<string>(v.phrase)
  const [cause, setCause] = useState<string | null>(v.causeCategory ?? null)
  const [saved, setSaved] = useState(!!v.reviewedAt)
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
    <div className="rounded-xl p-3" style={{ background: 'var(--canvas-bg)', border: '1px solid var(--node-border)', opacity: saved ? 0.7 : 1 }}>
      {label && (
        <div className="flex items-center gap-1.5 mb-2">
          {dot && <span className="w-2 h-2 rounded-full" style={{ background: dot }} />}
          <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--node-meta)' }}>{label}</span>
        </div>
      )}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {GRADES.map(g => (
          <button key={g} disabled={saved} onClick={() => setGrade(g)}
            className={`w-8 h-8 rounded-lg border text-sm font-semibold transition-all ${grade === g ? GRADE_CLASS[g] : ''}`}
            style={grade === g ? undefined : { borderColor: 'var(--node-border)', color: 'var(--node-meta)' }}>
            {g}
          </button>
        ))}
        <div className="flex flex-wrap gap-1 ml-1">
          {CAUSES.map(c => (
            <button key={c.key} disabled={saved} onClick={() => setCause(cause === c.key ? null : c.key)}
              className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
              style={cause === c.key ? { borderColor: 'var(--node-title)', color: 'var(--node-title)' } : { borderColor: 'var(--node-border)', color: 'var(--node-meta)' }}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <textarea value={phrase} disabled={saved} onChange={e => setPhrase(e.target.value)} rows={2}
        className="w-full resize-none rounded-lg px-2.5 py-1.5 text-[13px] outline-none mb-2"
        style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)' }} />
      <div className="flex justify-end">
        <button onClick={submit} disabled={saved || saving}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
          style={{ background: saved ? '#22c55e' : '#3b82f6' }}>
          <Check size={13} /> {saved ? 'Relu' : changed ? 'Requalifier' : 'Confirmer'}
        </button>
      </div>
    </div>
  )
}

function RelectureCard({ item, onRead, onRemind, onSkip, onJudged }: {
  item: ReviewNote
  onRead: () => void
  onRemind: (days: number) => void
  onSkip: () => void
  onJudged: (grade: string) => void
}) {
  const [thought, setThought] = useState('')
  const [added, setAdded] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const meta = TYPE_META[item.type]

  const tradeById = useMemo(() => new Map(item.trades.map(t => [t.id, t])), [item.trades])
  const globalVerdicts = item.verdicts.filter(v => v.tradeRef == null && v.messageRef == null)
  const tradeVerdicts = item.verdicts.filter(v => v.tradeRef != null)

  // Métadonnées de trade pour badger les blocs dans la relecture (comme sur le canvas)
  const tradeMeta = useMemo<Record<string, TradeMeta>>(() => {
    const gradeByTrade = new Map<string, string>()
    for (const v of item.verdicts) if (v.tradeRef) gradeByTrade.set(v.tradeRef, v.grade)
    const map: Record<string, TradeMeta> = {}
    item.trades.forEach((t, i) => { map[t.id] = { index: i + 1, outcome: t.outcome, startedAt: t.startedAt, grade: gradeByTrade.get(t.id) ?? null } })
    return map
  }, [item.trades, item.verdicts])

  const addThought = async () => {
    const t = thought.trim()
    if (!t || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/canvas/${item.canvasId}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'text', content: `<p>${esc(t)}</p>`, x: 40, y: 40 }),
      })
      if (res.ok) { setAdded(a => [...a, t]); setThought('') }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full rounded-2xl overflow-hidden" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', boxShadow: 'var(--node-shadow)' }}>
      {/* En-tête : la note + son type */}
      <div className="flex items-center gap-2.5 px-5 py-3.5" style={{ borderBottom: '1px solid var(--float-border)' }}>
        {item.note.favicon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.note.favicon} alt="" style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0 }} />
        )}
        <h2 className="flex-1 min-w-0 text-sm font-semibold truncate" style={{ color: 'var(--node-title)' }}>{item.note.title}</h2>
        <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full flex-shrink-0" style={{ color: meta.color, background: 'var(--canvas-bg)' }}>
          <meta.Icon size={11} /> {meta.label}
        </span>
        <Link href={`/notes/${item.note.id}`} title="Ouvrir pour ré-organiser" className="flex-shrink-0 p-1 rounded-md" style={{ color: 'var(--node-meta)' }}>
          <ExternalLink size={14} />
        </Link>
      </div>

      {/* La réorganisation, relue (lecture seule, images cliquables en grand) */}
      <div className="px-5 py-4 overflow-y-auto" style={{ maxHeight: '48vh' }}>
        <DocumentView nodes={item.nodes} messages={item.messages} readOnly embedded tradeMeta={tradeMeta} />
      </div>

      {/* Verdicts — seulement pour un trade / journée */}
      {item.type !== 'course' && (globalVerdicts.length > 0 || tradeVerdicts.length > 0) && (
        <div className="px-5 py-4 space-y-3" style={{ borderTop: '1px solid var(--float-border)', background: 'var(--canvas-bg)' }}>
          {globalVerdicts.length > 0 && (
            <div className="space-y-2.5">
              {globalVerdicts.map(v => (
                <VerdictRow key={v.id} v={v} onJudged={onJudged} label={item.type === 'day' ? 'Verdict de la journée' : 'Verdict de la note'} />
              ))}
            </div>
          )}
          {tradeVerdicts.length > 0 && (
            <div className="space-y-2.5">
              <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--node-meta)' }}>Trades notés</p>
              {tradeVerdicts.map(v => {
                const t = v.tradeRef ? tradeById.get(v.tradeRef) : null
                const info = t?.outcome ? OUTCOME[t.outcome] : null
                const time = t?.startedAt ? new Date(t.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null
                const label = ['Trade', time, info?.label].filter(Boolean).join(' · ')
                return (
                  <VerdictRow key={v.id} v={v} onJudged={onJudged} label={label} dot={info?.color} />
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Capture d'une idée qui vient en relisant — sans friction, atterrit dans « À trier » */}
      <div className="px-5 py-3.5" style={{ borderTop: '1px solid var(--float-border)' }}>
        <div className="flex items-center gap-2">
          <input
            value={thought}
            onChange={e => setThought(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addThought() } }}
            placeholder="Une idée en relisant ? (ajoutée à la note)"
            className="flex-1 rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{ background: 'var(--canvas-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)' }}
          />
          <button onClick={addThought} disabled={!thought.trim() || saving}
            className="flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-lg disabled:opacity-40"
            style={{ border: '1px solid var(--node-border)', color: 'var(--node-title)' }}>
            <Plus size={13} /> Ajouter
          </button>
        </div>
        {added.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {added.map((t, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
                <Check size={10} /> {t.length > 40 ? t.slice(0, 40) + '…' : t}
              </span>
            ))}
            <span className="text-[10px] self-center" style={{ color: 'var(--node-meta)' }}>→ dans « À trier », à replacer à la prochaine réorganisation</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-5 py-3.5" style={{ borderTop: '1px solid var(--float-border)' }}>
        <div className="flex items-center justify-between gap-3">
          <button onClick={onSkip} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg" style={{ color: 'var(--node-meta)' }}>
            <SkipForward size={13} /> Passer
          </button>
          <button onClick={onRead} className="flex items-center gap-2 text-sm font-medium px-5 py-2.5 rounded-xl text-white" style={{ background: '#3b82f6' }}>
            <Check size={15} /> J&apos;ai relu
          </button>
        </div>
        <p className="text-center text-[11px] mt-2.5" style={{ color: 'var(--node-meta)', opacity: 0.8 }}>
          Pas encore ancrée ? Me la reproposer dans{' '}
          <button onClick={() => onRemind(7)} className="underline" style={{ color: 'var(--node-meta)' }}>7 j</button>
          {' · '}
          <button onClick={() => onRemind(30)} className="underline" style={{ color: 'var(--node-meta)' }}>30 j</button>
        </p>
      </div>
    </div>
  )
}

// Repliable (replié par défaut) pour ne pas écraser la relecture ; groupé par dossier.
function ReorganizeSection({ items }: { items: ReorganizeItem[] }) {
  const [open, setOpen] = useState(false)

  const groups = useMemo(() => {
    const byFolder = new Map<string, ReorganizeItem[]>()
    for (const it of items) {
      const key = it.folder ?? '￿Sans dossier' // ￿ : trie « Sans dossier » en dernier
      if (!byFolder.has(key)) byFolder.set(key, [])
      byFolder.get(key)!.push(it)
    }
    return [...byFolder.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [items])

  return (
    <section className="mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 rounded-xl px-3.5 py-2.5"
        style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)' }}
      >
        <FolderPlus size={15} style={{ color: 'var(--node-title)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--node-title)' }}>À réorganiser d&apos;abord</span>
        <span className="text-[11px] px-1.5 rounded-full" style={{ background: 'var(--canvas-bg)', color: 'var(--node-meta)' }}>{items.length}</span>
        <span className="flex-1" />
        {open ? <ChevronDown size={15} style={{ color: 'var(--node-meta)' }} /> : <ChevronRight size={15} style={{ color: 'var(--node-meta)' }} />}
      </button>

      {open && (
        <>
          <p className="text-xs mt-2 mb-2 px-1" style={{ color: 'var(--node-meta)' }}>
            Ces notes de cours ne sont pas encore triées — c&apos;est l&apos;étape qui ancre la connaissance, avant de pouvoir les relire.
          </p>
          <div className="space-y-3 pr-1" style={{ maxHeight: 300, overflowY: 'auto' }}>
            {groups.map(([key, notes]) => (
              <div key={key}>
                <p className="text-[11px] uppercase tracking-wide mb-1.5 px-1 flex items-center gap-1.5" style={{ color: 'var(--node-meta)' }}>
                  <span>{key.startsWith('￿') ? 'Sans dossier' : `📁 ${key}`}</span>
                  <span style={{ opacity: 0.6 }}>· {notes.length}</span>
                </p>
                <div className="space-y-1.5">
                  {notes.map(n => (
                    <div key={n.id} className="flex items-center gap-2.5 rounded-xl px-3.5 py-2" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)' }}>
                      {n.favicon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={n.favicon} alt="" style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} />
                      )}
                      <span className="flex-1 min-w-0 text-sm truncate" style={{ color: 'var(--node-title)' }}>{n.title}</span>
                      <Link href={`/notes/${n.id}`} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-white flex-shrink-0" style={{ background: '#3b82f6' }}>
                        <FolderPlus size={13} /> Réorganiser
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

// Repliable : les notes déjà relues, pour en rouvrir une à la demande (mode focus ?note=).
function ReviewedSection({ items }: { items: SimpleNote[] }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="mt-8">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 rounded-xl px-3.5 py-2.5"
        style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)' }}>
        <BookOpen size={15} style={{ color: 'var(--node-meta)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--node-title)' }}>Déjà relues</span>
        <span className="text-[11px] px-1.5 rounded-full" style={{ background: 'var(--canvas-bg)', color: 'var(--node-meta)' }}>{items.length}</span>
        <span className="flex-1" />
        {open ? <ChevronDown size={15} style={{ color: 'var(--node-meta)' }} /> : <ChevronRight size={15} style={{ color: 'var(--node-meta)' }} />}
      </button>
      {open && (
        <div className="space-y-1.5 mt-2 pr-1" style={{ maxHeight: 300, overflowY: 'auto' }}>
          {items.map(n => (
            <div key={n.id} className="flex items-center gap-2.5 rounded-xl px-3.5 py-2" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)' }}>
              {n.favicon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={n.favicon} alt="" style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} />
              )}
              <span className="flex-1 min-w-0 text-sm truncate" style={{ color: 'var(--node-title)' }}>{n.title}</span>
              <Link href={`/review?note=${n.id}`} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg flex-shrink-0" style={{ border: '1px solid var(--node-border)', color: 'var(--node-title)' }}>
                <RotateCcw size={12} /> Relire
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// 0.1.5c — collections mappées (groupes de notes travaillés ensemble) : elles
// entrent dans le flux de relecture, avec leur propre porte d'entrée.
export type CollectionItem = { canvasId: string; sourceGroupId: string; title: string; noteCount: number; reviewed: boolean }

function CollectionsSection({ items }: { items: CollectionItem[] }) {
  return (
    <section className="mt-8">
      <div className="flex items-center gap-2 px-1 mb-2">
        <Layers size={15} style={{ color: 'var(--node-meta)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--node-title)' }}>Collections mappées</span>
        <span className="text-[11px] px-1.5 rounded-full" style={{ background: 'var(--node-bg)', color: 'var(--node-meta)' }}>{items.length}</span>
      </div>
      <div className="space-y-1.5 pr-1">
        {items.map(c => (
          <div key={c.canvasId} className="flex items-center gap-2.5 rounded-xl px-3.5 py-2" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)' }}>
            <Layers size={13} style={{ color: 'var(--node-meta)', flexShrink: 0 }} />
            <span className="flex-1 min-w-0 text-sm truncate" style={{ color: 'var(--node-title)' }}>{c.title}</span>
            <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--node-meta)' }}>{c.noteCount} note{c.noteCount > 1 ? 's' : ''}</span>
            {c.reviewed && <span className="text-[11px] flex-shrink-0 text-green-500">relue ✓</span>}
            <Link href={`/collection/${c.sourceGroupId}`} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg flex-shrink-0" style={{ border: '1px solid var(--node-border)', color: 'var(--node-title)' }}>
              <RotateCcw size={12} /> Ouvrir
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function ReviewDeck({ toRelire, toReorganize, reviewedNotes = [], collections = [], focus = false }: {
  toRelire: ReviewNote[]; toReorganize: ReorganizeItem[]; reviewedNotes?: SimpleNote[]; collections?: CollectionItem[]; focus?: boolean
}) {
  const router = useRouter()
  // On fige la file à l'ouverture : un router.refresh() (pour rafraîchir le badge home
  // + les autres sections) ne doit PAS réordonner le parcours en cours.
  const [queue] = useState(toRelire)
  const [idx, setIdx] = useState(0)
  const [tally, setTally] = useState<Record<string, number>>({ A: 0, B: 0, C: 0 })
  const [readCount, setReadCount] = useState(0)
  const [skipped, setSkipped] = useState(0)

  const total = queue.length
  const done = idx >= total
  const current = queue[idx]

  const advance = () => setIdx(i => i + 1)
  const onSkip = () => { setSkipped(s => s + 1); advance() }
  const onJudged = (grade: string) => setTally(t => ({ ...t, [grade]: (t[grade] ?? 0) + 1 }))

  const onRead = async () => {
    if (current) await fetch(`/api/canvas/${current.canvasId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewed: true }) })
    setReadCount(c => c + 1)
    advance()
    router.refresh() // badge home + « déjà relues » à jour, sans toucher la file figée
  }
  const onRemind = async (days: number) => {
    if (current) await fetch(`/api/canvas/${current.canvasId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reminderDays: days }) })
    advance()
    router.refresh()
  }

  const judgedTotal = tally.A + tally.B + tally.C
  const maxTally = Math.max(1, tally.A, tally.B, tally.C)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-5 py-8">
        {!focus && toReorganize.length > 0 && <ReorganizeSection items={toReorganize} />}

        {total === 0 ? (
          toReorganize.length > 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--node-meta)' }}>✅ Rien à relire — tes notes réorganisées sont à jour.</p>
          ) : (
            <div className="text-center py-20">
              <div className="text-5xl mb-4 opacity-30">🌱</div>
              <p className="text-sm mb-1" style={{ color: 'var(--node-title)' }}>Rien à relire pour l&apos;instant</p>
              <p className="text-xs mb-5 max-w-xs mx-auto" style={{ color: 'var(--node-meta)' }}>Réorganise une note (ouvre-la, trie les blocs en groupes) : elle apparaîtra ici pour la relecture.</p>
              <Link href="/" className="text-sm hover:underline" style={{ color: '#3b82f6' }}>← Retour à la carte</Link>
            </div>
          )
        ) : done ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-4">✅</div>
            <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--node-title)' }}>Relecture terminée</h2>
            <p className="text-xs mb-7" style={{ color: 'var(--node-meta)' }}>
              {readCount} note{readCount > 1 ? 's' : ''} relue{readCount > 1 ? 's' : ''}{skipped > 0 ? ` · ${skipped} passée${skipped > 1 ? 's' : ''}` : ''}
              {judgedTotal > 0 ? ` · ${judgedTotal} verdict${judgedTotal > 1 ? 's' : ''} re-jugé${judgedTotal > 1 ? 's' : ''}` : ''}
            </p>
            {judgedTotal > 0 && (
              <div className="space-y-2.5 mb-8 text-left max-w-md mx-auto">
                {GRADES.map(g => (
                  <div key={g} className="flex items-center gap-3">
                    <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold ${GRADE_CLASS[g]}`}>{g}</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--node-bg)' }}>
                      <div className="h-full rounded-full" style={{ width: `${(tally[g] / maxTally) * 100}%`, background: g === 'A' ? '#22c55e' : g === 'B' ? '#f59e0b' : '#ef4444' }} />
                    </div>
                    <span className="text-xs w-5 text-right" style={{ color: 'var(--node-meta)' }}>{tally[g]}</span>
                  </div>
                ))}
              </div>
            )}
            <Link href="/" className="inline-block text-sm font-medium px-5 py-2.5 rounded-xl text-white" style={{ background: '#3b82f6' }}>Retour à la carte</Link>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--node-bg)' }}>
                <div className="h-full rounded-full" style={{ width: `${(idx / total) * 100}%`, background: '#3b82f6', transition: 'width 0.3s' }} />
              </div>
              <span className="text-xs flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--node-meta)' }}>
                {idx + 1} <ArrowRight size={11} className="opacity-40" /> {total}
              </span>
            </div>
            <RelectureCard key={current.canvasId} item={current} onRead={onRead} onRemind={onRemind} onSkip={onSkip} onJudged={onJudged} />
            <p className="text-center text-[11px] mt-5" style={{ color: 'var(--node-meta)', opacity: 0.7 }}>
              Relis ta réorganisation — c&apos;est là que la rétention se joue.
            </p>
          </>
        )}
        {!focus && collections.length > 0 && <CollectionsSection items={collections} />}
        {!focus && reviewedNotes.length > 0 && <ReviewedSection items={reviewedNotes} />}
      </div>
    </div>
  )
}
