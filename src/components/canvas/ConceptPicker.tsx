'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   Choisir ou créer le concept à poser sur le canvas.

   Ce composant ne fait QUE le choix du tag : il charge la liste, sait en créer
   un nouveau, et rend le tag choisi. Il ne pose PAS le nœud, volontairement,
   parce que les deux canvas n'ont pas le même modèle de propriété de l'état :

   - l'accueil calcule ses nœuds une seule fois et peut donc ajouter le sien
     directement ;
   - le canvas d'une note resynchronise ses nœuds depuis ses props à chaque
     changement, donc un nœud ajouté seulement en local y serait effacé au
     prochain recalcul. Il doit passer par son layout.

   Extrait de NoteMapCanvas au 0.1.7.
   ───────────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from 'react'
import { Hash } from 'lucide-react'

export type Concept = { id: string; name: string; color: string }

export function ConceptPicker({
  ouvert,
  onFermer,
  onChoisi,
}: {
  ouvert: boolean
  onFermer: () => void
  /** Le canvas décide où et comment poser le nœud. */
  onChoisi: (tag: Concept) => void | Promise<void>
}) {
  const [tags, setTags] = useState<Concept[] | null>(null)
  const [recherche, setRecherche] = useState('')

  // Chargé une seule fois, à la première ouverture.
  useEffect(() => {
    if (!ouvert || tags !== null) return
    fetch('/api/tags')
      .then(r => (r.ok ? r.json() : []))
      .then(setTags)
      .catch(() => setTags([]))
  }, [ouvert, tags])

  useEffect(() => { if (ouvert) setRecherche('') }, [ouvert])

  const creerEtPoser = useCallback(async () => {
    const name = recherche.trim()
    if (!name) return
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) return
    const tag: Concept = await res.json()
    setTags(prev => (prev ? [...prev.filter(t => t.id !== tag.id), tag] : [tag]))
    await onChoisi(tag)
  }, [recherche, onChoisi])

  if (!ouvert) return null

  const q = recherche.trim().toLowerCase()
  const filtres = (tags ?? []).filter(t => t.name.toLowerCase().includes(q)).slice(0, 12)
  const dejaPresent = (tags ?? []).some(t => t.name.toLowerCase() === q)

  return (
    <div
      className="canvas-float-pill"
      style={{
        position: 'absolute', right: 58, top: '50%', transform: 'translateY(-50%)',
        zIndex: 45, width: 230, padding: 8, display: 'flex', flexDirection: 'column', gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Hash size={12} style={{ color: 'var(--node-meta)', flexShrink: 0 }} />
        <input
          autoFocus
          value={recherche}
          onChange={e => setRecherche(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onFermer() }}
          placeholder="Chercher ou créer un concept…"
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
            fontSize: 12, color: 'var(--node-title)',
          }}
        />
        <button
          onClick={onFermer}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--node-meta)', fontSize: 13, padding: 0 }}
        >×</button>
      </div>

      <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {filtres.map(t => (
          <button
            key={t.id}
            onClick={() => onChoisi(t)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
              borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left',
              background: 'none', color: 'var(--node-title)', fontSize: 12,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--canvas-bg)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
            {t.name}
          </button>
        ))}

        {q && !dejaPresent && (
          <button
            onClick={creerEtPoser}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
              borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left',
              background: 'var(--tool-active-bg)', color: '#3b82f6', fontSize: 12,
            }}
          >
            <Hash size={11} style={{ flexShrink: 0 }} />
            Créer « {recherche.trim()} »
          </button>
        )}

        {tags === null && (
          <p style={{ fontSize: 11, color: 'var(--node-meta)', textAlign: 'center', padding: 8 }}>Chargement…</p>
        )}
      </div>
    </div>
  )
}
