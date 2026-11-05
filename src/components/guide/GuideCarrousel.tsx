'use client'

// Le guide, une étape par écran (guide 3 du labo, brief J2) : grande vignette,
// Précédent / Suivant, points cliquables, Terminer. Il s'affiche à la première
// ouverture de /guide ; « Revoir pas à pas » le relance. Flèches du clavier pour
// changer d'étape, Échap pour fermer.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, X } from 'lucide-react'
import { BLOCS_NOTE, ETAPES_GUIDE, TEMPS } from '@/lib/guide-journal'
import Vignette from './Vignette'

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-[var(--trade-bleu)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--node-bg)]'

export default function GuideCarrousel({ onFermer }: { onFermer: () => void }) {
  const [cur, setCur] = useState(0)
  const etape = ETAPES_GUIDE[cur]
  const temps = TEMPS[etape.temps]
  const derniere = cur === ETAPES_GUIDE.length - 1

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement | null
      if (cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA' || cible.isContentEditable)) return
      if (e.key === 'ArrowRight') setCur(c => Math.min(ETAPES_GUIDE.length - 1, c + 1))
      else if (e.key === 'ArrowLeft') setCur(c => Math.max(0, c - 1))
      else if (e.key === 'Escape') onFermer()
    }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [onFermer])

  return (
    <section
      aria-roledescription="carrousel"
      aria-label="Le Journal, pas à pas"
      className="grid gap-3.5 rounded-2xl p-[18px]"
      style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', boxShadow: 'var(--node-shadow)' }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: temps.teinte }}>
          <i className="block size-2 rounded-full" style={{ background: temps.teinte }} />
          {temps.libelle}, étape {cur + 1} sur {ETAPES_GUIDE.length}
        </div>
        <button
          type="button"
          onClick={onFermer}
          aria-label="Fermer le guide"
          className={`grid size-8 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-[var(--case-bg)] ${FOCUS}`}
          style={{ color: 'var(--node-meta)' }}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="grid gap-3.5" aria-live="polite">
        <Vignette key={etape.image} etape={etape} grande />
        <h2 className="text-[17px] font-bold" style={{ color: 'var(--node-title)' }}>{etape.titre}</h2>
        <p className="max-w-[60ch] text-[13.5px]" style={{ color: 'var(--node-preview)' }}>{etape.texte}</p>
        {etape.blocs && (
          <div className="flex flex-wrap gap-1.5">
            {BLOCS_NOTE.map(b => (
              <span key={b} className="rounded-full px-2.5 py-[3px] text-[11.5px] font-medium" style={{ background: 'var(--action-doux-bg)', color: 'var(--node-title)' }}>{b}</span>
            ))}
          </div>
        )}
        {etape.lien && (
          <Link href={etape.lien.href} className="inline-flex items-center gap-1 justify-self-start text-xs font-medium" style={{ color: temps.teinte }}>
            {etape.lien.libelle}<ArrowRight className="size-3" aria-hidden="true" />
          </Link>
        )}
      </div>

      {/* Au téléphone, les points passent au-dessus des deux boutons. */}
      <div className="grid grid-cols-2 items-center gap-2.5 sm:grid-cols-[auto_1fr_auto]">
        <button
          type="button"
          onClick={() => setCur(c => Math.max(0, c - 1))}
          disabled={cur === 0}
          className={`cursor-pointer justify-self-start rounded-full px-3.5 py-[7px] text-[12.5px] font-semibold disabled:cursor-default disabled:opacity-40 ${FOCUS}`}
          style={{ background: 'var(--action-doux-bg)', color: 'var(--action-doux-fg)' }}
        >
          Précédent
        </button>
        <div className="col-span-2 row-start-1 flex justify-center gap-1.5 sm:col-span-1 sm:col-start-2">

          {ETAPES_GUIDE.map((e, i) => (
            <button
              key={e.image}
              type="button"
              onClick={() => setCur(i)}
              aria-label={`Étape ${i + 1} : ${e.titre}`}
              aria-current={i === cur ? 'step' : undefined}
              className={`size-[9px] cursor-pointer rounded-full p-0 ${FOCUS}`}
              style={{ background: i === cur ? 'var(--trade-bleu)' : 'var(--trade-gris)', opacity: i === cur ? 1 : 0.45 }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => (derniere ? onFermer() : setCur(c => c + 1))}
          className={`cursor-pointer justify-self-end rounded-full px-3.5 py-[7px] text-[12.5px] font-semibold ${FOCUS}`}
          style={{ background: 'var(--action-plein-bg)', color: 'var(--action-plein-fg)' }}
        >
          {derniere ? 'Terminer' : 'Suivant'}
        </button>
      </div>
    </section>
  )
}
