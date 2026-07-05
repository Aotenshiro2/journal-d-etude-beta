'use client'

import { useState } from 'react'
import { Plus, Trash2, Sunrise, Moon, CheckCircle2 } from 'lucide-react'

export type RitualData = {
  id: string
  physical: string | null
  emotional: string | null
  dominantThought: string | null
  objective: string | null
  emotionLevel: number | null
  errors: string | null
  lesson: string | null
  recenter: string | null
  closed: boolean
  createdAt: string | Date
}

type TextKey = 'physical' | 'emotional' | 'dominantThought' | 'objective' | 'errors' | 'lesson' | 'recenter'

const WARMUP: { key: TextKey; label: string; hint: string }[] = [
  { key: 'physical', label: 'État physique', hint: 'Fatigué ? En forme ? Tendu ? Bien dormi ?' },
  { key: 'emotional', label: 'État émotionnel', hint: 'Anxieux, excité, détendu, irritable…' },
  { key: 'dominantThought', label: 'Pensée dominante', hint: 'Performance ? Un objectif à atteindre ? Une peur ? Une attente ?' },
  { key: 'objective', label: 'Objectif du jour (qualitatif)', hint: 'Respecter mon plan, exécuter, journaler — pas un chiffre.' },
]
const COOLDOWN: { key: TextKey; label: string; hint: string }[] = [
  { key: 'errors', label: 'Erreurs repérées', hint: 'Overtrading, non-respect du plan, revenge…' },
  { key: 'lesson', label: 'Leçon — ce que je retiens', hint: 'Qu\'aurais-je fait autrement ? Un pattern repéré (ex. tilt après 2 SL) ?' },
  { key: 'recenter', label: 'Comment je me recentre', hint: 'Douche, sport, marche, respiration…' },
]

function patch(id: string, field: string, value: string | number | boolean) {
  return fetch('/api/rituals', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, [field]: value }),
  })
}

function Field({ id, field, def, label, hint, tint }: { id: string; field: TextKey; def: string; label: string; hint: string; tint: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium mb-0.5" style={{ color: tint }}>{label}</div>
      <textarea
        defaultValue={def}
        onBlur={e => { if (e.target.value !== def) patch(id, field, e.target.value) }}
        placeholder={hint}
        rows={1}
        className="w-full resize-y rounded-lg px-2.5 py-1.5 text-[13px] outline-none"
        style={{ background: 'var(--canvas-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)', minHeight: 34 }}
      />
    </div>
  )
}

function EmotionGauge({ id, initial }: { id: string; initial: number | null }) {
  const [level, setLevel] = useState<number>(initial ?? 0)
  const color = level < 34 ? '#22c55e' : level < 67 ? '#f59e0b' : '#ef4444'
  const label = level < 34 ? 'Calme' : level < 67 ? 'Modéré' : 'Chargé'
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium" style={{ color: '#3b82f6' }}>Émotion accumulée au démarrage</span>
        <span className="text-[11px] font-semibold" style={{ color }}>{level} · {label}</span>
      </div>
      <input
        type="range" min={0} max={100} value={level}
        onChange={e => setLevel(Number(e.target.value))}
        onPointerUp={() => patch(id, 'emotionLevel', level)}
        onBlur={() => patch(id, 'emotionLevel', level)}
        className="w-full"
        style={{ accentColor: color }}
      />
      <p className="text-[10px] mt-0.5" style={{ color: 'var(--node-meta)', opacity: 0.8 }}>Tu ne repars pas de zéro : ce que tu portes d’hier pèse sur aujourd’hui.</p>
    </div>
  )
}

function RitualCard({ r, onDelete }: { r: RitualData; onDelete: () => void }) {
  const [closed, setClosed] = useState(r.closed)
  const date = new Date(r.createdAt).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  const toggleClosed = () => { const v = !closed; setClosed(v); patch(r.id, 'closed', v) }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', boxShadow: 'var(--node-shadow)' }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--float-border)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--node-title)' }}>Séance</span>
        <span className="text-[11px]" style={{ color: 'var(--node-meta)' }}>{date}</span>
        {closed && <span className="text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}><CheckCircle2 size={11} /> Clôturée</span>}
        <span className="flex-1" />
        <button onClick={onDelete} className="p-1 rounded-md" style={{ color: 'var(--node-meta)' }} title="Supprimer"
          onMouseEnter={e => { e.currentTarget.style.color = '#ef4444' }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--node-meta)' }}>
          <Trash2 size={14} />
        </button>
      </div>

      {/* Warmup */}
      <div className="px-4 py-3.5">
        <div className="flex items-center gap-1.5 mb-2.5">
          <Sunrise size={14} style={{ color: '#3b82f6' }} />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#3b82f6' }}>Avant la séance</span>
        </div>
        <div className="space-y-2.5">
          {WARMUP.map(f => <Field key={f.key} id={r.id} field={f.key} def={(r[f.key] as string) ?? ''} label={f.label} hint={f.hint} tint="#3b82f6" />)}
          <EmotionGauge id={r.id} initial={r.emotionLevel} />
        </div>
      </div>

      {/* Cooldown */}
      <div className="px-4 py-3.5" style={{ borderTop: '1px solid var(--float-border)', background: 'var(--canvas-bg)' }}>
        <div className="flex items-center gap-1.5 mb-2.5">
          <Moon size={14} style={{ color: '#f59e0b' }} />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#f59e0b' }}>Après la séance</span>
        </div>
        <div className="space-y-2.5">
          {COOLDOWN.map(f => <Field key={f.key} id={r.id} field={f.key} def={(r[f.key] as string) ?? ''} label={f.label} hint={f.hint} tint="#f59e0b" />)}
        </div>
        <button onClick={toggleClosed}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg mt-3"
          style={closed ? { color: 'var(--node-meta)', border: '1px solid var(--node-border)' } : { background: '#22c55e', color: '#fff' }}>
          <CheckCircle2 size={13} /> {closed ? 'Rouvrir la séance' : 'Clôturer la séance'}
        </button>
      </div>
    </div>
  )
}

export default function RitualBoard({ initial }: { initial: RitualData[] }) {
  const [rituals, setRituals] = useState<RitualData[]>(initial)
  const [creating, setCreating] = useState(false)

  const create = async () => {
    if (creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/rituals', { method: 'POST' })
      if (res.ok) { const r = await res.json(); setRituals(prev => [r, ...prev]) }
    } finally { setCreating(false) }
  }

  const remove = async (id: string) => {
    if (!window.confirm('Supprimer cette séance ?')) return
    await fetch(`/api/rituals?id=${id}`, { method: 'DELETE' })
    setRituals(prev => prev.filter(r => r.id !== id))
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-5 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--node-title)' }}>Rituel de séance</h1>
          <p className="text-sm" style={{ color: 'var(--node-meta)' }}>
            Un <span style={{ color: '#3b82f6' }}>warmup</span> avant (ton état, ta pensée dominante, ton objectif du jour) et un <span style={{ color: '#f59e0b' }}>cooldown</span> après (tes erreurs, ta leçon, comment tu te recentres). Le trading est un métier de performance, et cette performance dépend de ton état.
          </p>
        </div>

        <button onClick={create} disabled={creating}
          className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl text-white mb-5 disabled:opacity-50"
          style={{ background: '#3b82f6' }}>
          <Plus size={16} /> Démarrer une séance
        </button>

        {rituals.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4 opacity-30">🌅</div>
            <p className="text-sm mb-1" style={{ color: 'var(--node-title)' }}>Aucune séance pour l&apos;instant</p>
            <p className="text-xs max-w-sm mx-auto" style={{ color: 'var(--node-meta)' }}>Démarre ta séance avant de trader : quelques secondes pour te situer changent tout.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {rituals.map(r => <RitualCard key={r.id} r={r} onDelete={() => remove(r.id)} />)}
          </div>
        )}
      </div>
    </div>
  )
}
