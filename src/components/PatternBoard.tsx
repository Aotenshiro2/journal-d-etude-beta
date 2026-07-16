'use client'

import { useState } from 'react'
import { Plus, Trash2, Shield, ChevronDown, Compass } from 'lucide-react'

export type PatternData = {
  id: string
  name: string
  area: string | null
  trigger: string | null
  thoughts: string | null
  emotions: string | null
  behaviors: string | null
  actions: string | null
  decisionShift: string | null
  perceptionShift: string | null
  mistake: string | null
  correction: string | null
}

type RungKey = 'trigger' | 'thoughts' | 'emotions' | 'behaviors' | 'actions' | 'decisionShift' | 'perceptionShift' | 'mistake'

// L'escalade du déclencheur (calme) à l'erreur (à chaud) — couleurs qui montent
const RUNGS: { key: RungKey; label: string; hint: string; color: string }[] = [
  { key: 'trigger', label: 'Déclencheur', hint: 'Le détonateur : un SL, un trade raté, une grosse perte…', color: '#3b82f6' },
  { key: 'thoughts', label: 'Pensées', hint: 'Les pensées automatiques (« je peux pas rater ça »…)', color: '#60a5fa' },
  { key: 'emotions', label: 'Émotions', hint: 'L\'escalade : frustration → colère, doute → anxiété', color: '#fbbf24' },
  { key: 'behaviors', label: 'Comportements', hint: 'Le corps, l\'attention (penché sur l\'écran, mâchoire serrée…)', color: '#f59e0b' },
  { key: 'actions', label: 'Actions', hint: 'Ce que tu fais (checker le PnL sans arrêt…)', color: '#fb923c' },
  { key: 'decisionShift', label: 'Décision', hint: 'Comment ta prise de décision se déforme', color: '#f97316' },
  { key: 'perceptionShift', label: 'Perception du marché', hint: 'Ta lecture qui dérape (tu lis trop dans le prix…)', color: '#ef4444' },
  { key: 'mistake', label: 'L\'erreur', hint: 'L\'erreur d\'exécution finale', color: '#dc2626' },
]
const AREAS = ['avidité', 'peur', 'tilt', 'confiance', 'discipline']

function patch(id: string, field: string, value: string) {
  return fetch('/api/patterns', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, [field]: value }),
  })
}

function PatternCard({ p, onDelete }: { p: PatternData; onDelete: () => void }) {
  const [area, setArea] = useState(p.area ?? '')
  const [open, setOpen] = useState(true)

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', boxShadow: 'var(--node-shadow)' }}>
      {/* En-tête */}
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: open ? '1px solid var(--float-border)' : 'none' }}>
        <button onClick={() => setOpen(o => !o)} className="flex-shrink-0" style={{ color: 'var(--node-meta)' }} title={open ? 'Replier' : 'Déplier'}>
          <ChevronDown size={16} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.2s' }} />
        </button>
        <input
          defaultValue={p.name}
          onBlur={e => { if (e.target.value.trim() && e.target.value !== p.name) patch(p.id, 'name', e.target.value.trim()) }}
          className="flex-1 min-w-0 bg-transparent text-sm font-semibold outline-none"
          style={{ color: 'var(--node-title)' }}
        />
        <div className="flex items-center gap-1 flex-shrink-0">
          {AREAS.map(a => (
            <button
              key={a}
              onClick={() => { const next = area === a ? '' : a; setArea(next); patch(p.id, 'area', next) }}
              className="text-[10px] px-1.5 py-0.5 rounded-full border transition-colors"
              style={area === a ? { borderColor: 'var(--node-title)', color: 'var(--node-title)' } : { borderColor: 'var(--node-border)', color: 'var(--node-meta)' }}
            >
              {a}
            </button>
          ))}
        </div>
        <button onClick={onDelete} className="flex-shrink-0 p-1 rounded-md" style={{ color: 'var(--node-meta)' }} title="Supprimer cette fiche"
          onMouseEnter={e => { e.currentTarget.style.color = '#ef4444' }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--node-meta)' }}>
          <Trash2 size={14} />
        </button>
      </div>

      {open && (
        <div className="px-4 py-3">
          {/* L'escalier */}
          <div className="space-y-2">
            {RUNGS.map((r, i) => (
              <div key={r.key} className="flex gap-2.5">
                <div className="flex flex-col items-center flex-shrink-0 pt-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />
                  {i < RUNGS.length - 1 && <span className="w-px flex-1 mt-1" style={{ background: 'var(--node-border)' }} />}
                </div>
                <div className="flex-1 min-w-0 pb-1">
                  <div className="text-[11px] font-medium mb-0.5" style={{ color: r.color }}>{r.label}</div>
                  <textarea
                    defaultValue={p[r.key] ?? ''}
                    onBlur={e => { if (e.target.value !== (p[r.key] ?? '')) patch(p.id, r.key, e.target.value) }}
                    placeholder={r.hint}
                    rows={1}
                    className="w-full resize-y rounded-lg px-2.5 py-1.5 text-[13px] outline-none"
                    style={{ background: 'var(--canvas-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)', minHeight: 34 }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Garde-fou : la phrase corrective à injecter tôt */}
          <div className="mt-3 rounded-xl p-3" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.3)' }}>
            <div className="flex items-center gap-1.5 mb-1">
              <Shield size={13} style={{ color: '#22c55e' }} />
              <span className="text-[11px] font-medium" style={{ color: '#22c55e' }}>Garde-fou — la phrase à te dire au déclencheur</span>
            </div>
            <textarea
              defaultValue={p.correction ?? ''}
              onBlur={e => { if (e.target.value !== (p.correction ?? '')) patch(p.id, 'correction', e.target.value) }}
              placeholder="« Respire, observe, exécute le plan. » — ta logique de correction en temps réel"
              rows={1}
              className="w-full resize-y rounded-lg px-2.5 py-1.5 text-[13px] outline-none"
              style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)', minHeight: 34 }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default function PatternBoard({ initial }: { initial: PatternData[] }) {
  const [patterns, setPatterns] = useState<PatternData[]>(initial)
  const [creating, setCreating] = useState(false)

  const create = async () => {
    if (creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/patterns', { method: 'POST' })
      if (res.ok) { const p = await res.json(); setPatterns(prev => [p, ...prev]) }
    } finally { setCreating(false) }
  }

  const remove = async (id: string) => {
    if (!window.confirm('Supprimer cette fiche pattern ?')) return
    await fetch(`/api/patterns?id=${id}`, { method: 'DELETE' })
    setPatterns(prev => prev.filter(p => p.id !== id))
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-5 py-8">
        {/* Intention */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Compass size={18} style={{ color: 'var(--node-title)' }} />
            <h1 className="text-xl font-bold" style={{ color: 'var(--node-title)' }}>Ton point de bascule, avant qu&apos;il n&apos;explose</h1>
          </div>
          <p className="text-sm" style={{ color: 'var(--node-meta)' }}>
            Une fiche par problème récurrent (tilt, FOMO, revenge…). Cartographie l&apos;escalade — du <span style={{ color: '#3b82f6' }}>déclencheur</span> à <span style={{ color: '#dc2626' }}>l&apos;erreur</span>. Relis-les à ton warmup. <span className="italic">Le déclencheur est le détonateur ; la vraie faille est la bombe.</span>
          </p>
        </div>

        <button
          onClick={create}
          disabled={creating}
          className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl text-white mb-5 disabled:opacity-50"
          style={{ background: '#3b82f6' }}
        >
          <Plus size={16} /> Nouvelle fiche pattern
        </button>

        {patterns.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4 opacity-30">🧭</div>
            <p className="text-sm mb-1" style={{ color: 'var(--node-title)' }}>Aucune fiche pour l&apos;instant</p>
            <p className="text-xs max-w-sm mx-auto" style={{ color: 'var(--node-meta)' }}>Crée ta première carte pour un problème que tu connais (ex. « revenge après deux SL »).</p>
          </div>
        ) : (
          <div className="space-y-4">
            {patterns.map(p => <PatternCard key={p.id} p={p} onDelete={() => remove(p.id)} />)}
          </div>
        )}
      </div>
    </div>
  )
}
