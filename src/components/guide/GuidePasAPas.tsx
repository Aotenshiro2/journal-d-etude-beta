'use client'

// Le guide sur une page (guide 2 du labo, brief J2) : les neuf étapes
// numérotées, une vignette et deux lignes chacune, en trois temps (noter,
// étudier, vérifier). C'est la page /guide après la première ouverture : elle
// « récape facilement » (Brice, 05/11). Un bouton discret relance le carrousel.
// Puis « Aller plus loin » : ce que les neuf étapes ne couvrent pas.

import Link from 'next/link'
import { ArrowRight, ExternalLink, Play } from 'lucide-react'
import { ALLER_PLUS_LOIN, BLOCS_NOTE, ETAPES_GUIDE, TEMPS, type LienGuide, type Temps } from '@/lib/guide-journal'
import Vignette from './Vignette'

const SURFACE = { background: 'var(--node-bg)', border: '1px solid var(--node-border)', boxShadow: 'var(--node-shadow)' }

function LienEtape({ lien, teinte }: { lien: LienGuide; teinte: string }) {
  return lien.externe ? (
    <a href={lien.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: teinte }}>
      {lien.libelle}<ExternalLink className="size-3" aria-hidden="true" />
    </a>
  ) : (
    <Link href={lien.href} className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: teinte }}>
      {lien.libelle}<ArrowRight className="size-3" aria-hidden="true" />
    </Link>
  )
}

function Piste({ libelle, teinte }: { libelle: string; teinte: string }) {
  return (
    <h2 className="mt-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: teinte }}>
      <i className="block size-2 rounded-full" style={{ background: teinte }} />{libelle}
    </h2>
  )
}

export default function GuidePasAPas({ onRevoir }: { onRevoir: () => void }) {
  let dernier: Temps | null = null
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <h1 className="text-lg font-bold" style={{ color: 'var(--node-title)' }}>Le Journal, pas à pas</h1>
        <button
          type="button"
          onClick={onRevoir}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-xs hover:text-[var(--node-title)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--trade-bleu)]"
          style={{ color: 'var(--node-meta)' }}
        >
          <Play className="size-3" aria-hidden="true" />Revoir pas à pas
        </button>
      </div>
      <p className="-mt-1 text-[13px]" style={{ color: 'var(--node-meta)' }}>
        De ta note de séance à ce que ton broker a vraiment exécuté. Neuf étapes, dans l&apos;ordre.
      </p>

      <ol className="grid gap-3">
        {ETAPES_GUIDE.map((e, i) => {
          const temps = TEMPS[e.temps]
          const piste = e.temps !== dernier ? <Piste libelle={temps.libelle} teinte={temps.teinte} /> : null
          dernier = e.temps
          return (
            <li key={e.image} className="grid gap-3">
              {piste}
              <div className="grid items-center gap-3.5 rounded-2xl p-3 min-[761px]:grid-cols-[150px_minmax(0,1fr)]" style={SURFACE}>
                <div className="max-w-[260px] min-[761px]:max-w-none"><Vignette etape={e} /></div>
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--node-title)' }}>
                    <span className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold" style={{ background: 'var(--case-bg)', color: temps.teinte }}>{i + 1}</span>
                    {e.titre}
                  </h3>
                  <p className="mt-1 text-[12.5px]" style={{ color: 'var(--node-preview)' }}>{e.texte}</p>
                  {e.blocs && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {BLOCS_NOTE.map(b => (
                        <span key={b} className="rounded-full px-2.5 py-[3px] text-[11.5px] font-medium" style={{ background: 'var(--action-doux-bg)', color: 'var(--node-title)' }}>{b}</span>
                      ))}
                    </div>
                  )}
                  {e.lien && <div className="mt-2"><LienEtape lien={e.lien} teinte={temps.teinte} /></div>}
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      <section className="mt-6 grid gap-3" aria-labelledby="aller-plus-loin">
        <h2 id="aller-plus-loin" className="text-base font-bold" style={{ color: 'var(--node-title)' }}>Aller plus loin</h2>
        {ALLER_PLUS_LOIN.map(groupe => (
          <div key={groupe.titre} className="grid gap-2">
            <Piste libelle={groupe.titre} teinte={groupe.teinte} />
            {groupe.items.map(item => (
              <div key={item.titre} className="rounded-2xl px-4 py-3" style={SURFACE}>
                <h3 className="text-[13.5px] font-semibold" style={{ color: 'var(--node-title)' }}>{item.titre}</h3>
                <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--node-preview)' }}>{item.texte}</p>
                <div className="mt-1.5 flex flex-wrap gap-4">
                  {item.liens.map(l => <LienEtape key={l.href} lien={l} teinte={groupe.teinte} />)}
                </div>
              </div>
            ))}
          </div>
        ))}
      </section>

      <p className="mt-6 text-center text-[11px]" style={{ color: 'var(--node-meta)', opacity: 0.7 }}>
        Reviens ici quand tu veux resituer une étape.
      </p>
    </div>
  )
}
