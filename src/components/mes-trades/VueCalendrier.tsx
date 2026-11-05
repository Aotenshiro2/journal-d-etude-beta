'use client'

// Le mois en calendrier (écran 2 du labo 1, brief J2) : les jours de bourse, un
// point par trade (vert : lié, ambre : noté sans broker, gris : broker sans
// note), la légende, le mois précédent ou suivant dans la période choisie. Dans
// les « Vues 4 » du labo 2, c'est la colonne de gauche : choisir un jour montre
// ses trades à droite (le jour choisi est cerclé de bleu). « La personne sait de
// mémoire ce qu'elle cherche » (Brice, 05/11). Un samedi ou un dimanche
// n'apparaît que s'il porte un trade.

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Synthese } from '@/lib/synthese-trades-pur'
import {
  MOIS, elementsDe, estWeekend, jourDe, jourElement, moisDeLaPeriode, parJour, pointDe, semainesDuMois,
  type Periode, type Point,
} from '@/lib/mes-trades-pur'
import { FOCUS, SURFACE, TEINTES } from './commun'

const COULEUR_POINT: Record<Point, string> = { lie: TEINTES.vert, sans: TEINTES.ambre, broker: TEINTES.gris }
const MOT_POINT: Record<Point, [string, string]> = {
  lie: ['lié au broker', 'liés au broker'],
  sans: ['noté sans trade du broker', 'notés sans trade du broker'],
  broker: ['trade du broker sans note', 'trades du broker sans note'],
}
const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const POINTS_MAX = 8

export default function VueCalendrier({ synthese, periode, maintenant, jour, cercle, choisirJour }: {
  synthese: Synthese
  periode: Periode
  maintenant: Date
  /** Le jour choisi (AAAA-MM-JJ) : le calendrier montre son mois. */
  jour: string | null
  /** Le cercler (faux quand une pastille remplace le jour à droite). */
  cercle: boolean
  choisirJour: (jour: string) => void
}) {
  const elements = useMemo(() => elementsDe(synthese), [synthese])
  const jours = useMemo(() => parJour(elements), [elements])
  const plusAncien = elements.length > 0 ? jourElement(elements[elements.length - 1]) : null
  const mois = useMemo(() => moisDeLaPeriode(periode, maintenant, plusAncien), [periode, maintenant, plusAncien])
  const indexDuJour = jour ? mois.findIndex(m => jour.startsWith(`${m.annee}-${String(m.mois + 1).padStart(2, '0')}-`)) : -1
  const [index, setIndex] = useState(indexDuJour >= 0 ? indexDuJour : mois.length - 1)
  // Le mois suit le jour choisi (et la période) ; sans jour, le mois en cours.
  useEffect(() => { setIndex(indexDuJour >= 0 ? indexDuJour : mois.length - 1) }, [indexDuJour, mois.length])
  const m = mois[Math.min(index, mois.length - 1)]
  const prefixe = `${m.annee}-${String(m.mois + 1).padStart(2, '0')}-`
  const weekend = [...jours.keys()].some(j => j.startsWith(prefixe) && estWeekend(j))
  const semaines = useMemo(() => semainesDuMois(m.annee, m.mois, weekend), [m.annee, m.mois, weekend])
  const aujourdhui = jourDe(maintenant.toISOString())
  const colonnes = weekend ? 7 : 5

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 rounded-2xl p-3" style={SURFACE}>
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index <= 0}
            className={`grid size-8 place-items-center rounded-full enabled:cursor-pointer enabled:hover:bg-[var(--case-bg)] disabled:opacity-30 ${FOCUS}`}
            aria-label="Mois précédent" style={{ color: 'var(--node-title)' }}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <span className="text-sm font-semibold capitalize" style={{ color: 'var(--node-title)' }} aria-live="polite">{MOIS[m.mois]} {m.annee}</span>
          <button type="button" onClick={() => setIndex(i => Math.min(mois.length - 1, i + 1))} disabled={index >= mois.length - 1}
            className={`grid size-8 place-items-center rounded-full enabled:cursor-pointer enabled:hover:bg-[var(--case-bg)] disabled:opacity-30 ${FOCUS}`}
            aria-label="Mois suivant" style={{ color: 'var(--node-title)' }}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colonnes}, minmax(0, 1fr))` }} aria-hidden="true">
          {JOURS_COURTS.slice(0, colonnes).map(j => <span key={j} className="text-center text-[11px]" style={{ color: 'var(--node-meta)' }}>{j}</span>)}
        </div>
        {semaines.map((semaine, s) => (
          <div key={s} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colonnes}, minmax(0, 1fr))` }}>
            {semaine.map((j, i) => {
              if (!j) return <span key={i} aria-hidden="true" />
              const ici = jours.get(j) ?? []
              const numero = Number(j.slice(8))
              const estAujourdhui = j === aujourdhui
              const choisi = cercle && j === jour
              const contenu = (
                <>
                  <b className="text-[11px] font-semibold" style={{ color: estAujourdhui ? TEINTES.bleu : 'var(--node-meta)' }}>{numero}</b>
                  <span className="flex flex-wrap gap-[3px]">
                    {ici.slice(0, POINTS_MAX).map(e => <i key={e.cle} className="block size-2 rounded-full" style={{ background: COULEUR_POINT[pointDe(e)] }} />)}
                    {ici.length > POINTS_MAX && <span className="text-[10px] leading-none" style={{ color: 'var(--node-meta)' }}>+{ici.length - POINTS_MAX}</span>}
                  </span>
                </>
              )
              const classe = 'grid min-h-14 content-between rounded-[10px] p-1.5 text-left'
              if (ici.length === 0) {
                return <div key={j} className={classe} style={{ background: 'var(--case-bg)', opacity: 0.55 }}>{contenu}</div>
              }
              return (
                <button key={j} type="button" onClick={() => choisirJour(j)}
                  aria-pressed={choisi}
                  className={`${classe} cursor-pointer hover:outline-2 hover:outline-[var(--float-border)] ${FOCUS}`}
                  style={{ background: 'var(--case-bg)', outline: choisi ? `2px solid ${TEINTES.bleu}` : undefined }}
                  aria-label={libelleJour(j, ici.map(pointDe))}>
                  {contenu}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[11.5px]" style={{ color: 'var(--node-meta)' }}>
        <span className="inline-flex items-center gap-1.5"><i className="block size-2 rounded-full" style={{ background: TEINTES.vert }} />Lié au broker</span>
        <span className="inline-flex items-center gap-1.5"><i className="block size-2 rounded-full" style={{ background: TEINTES.ambre }} />Noté, sans trade du broker</span>
        <span className="inline-flex items-center gap-1.5"><i className="block size-2 rounded-full" style={{ background: TEINTES.gris }} />Trade du broker sans note</span>
      </div>
    </div>
  )
}

function libelleJour(jour: string, points: Point[]): string {
  const [a, m, j] = jour.split('-').map(Number)
  const date = new Date(a, m - 1, j).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const parts = (['lie', 'sans', 'broker'] as Point[])
    .map(p => ({ p, n: points.filter(x => x === p).length }))
    .filter(x => x.n > 0)
    .map(x => `${x.n} ${MOT_POINT[x.p][x.n > 1 ? 1 : 0]}`)
  return `${date} : ${points.length} trade${points.length > 1 ? 's' : ''} (${parts.join(', ')}). Ouvrir le jour`
}
