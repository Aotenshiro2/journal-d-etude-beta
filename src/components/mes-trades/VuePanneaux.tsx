'use client'

// Les six panneaux, en bandeau de pastilles (« Vues 4 » du labo 2, choisi par
// Brice le 05/11) : une icône, le chiffre, un mot court. Une pastille remplace
// la colonne des trades par la liste de son panneau ; la recliquer revient au
// jour choisi. « La meilleure vue pour se repérer par action » (Brice, 05/11).

import type { ReactNode } from 'react'
import { ChartLine, Crosshair, Link2, LogOut, NotebookPen, Scale } from 'lucide-react'
import type { Synthese } from '@/lib/synthese-trades-pur'
import { COURTS_LISTES, TITRES_LISTES, chiffresPanneaux, formatPtsSigne, formatR, type CleListe } from '@/lib/mes-trades-pur'
import { FOCUS, TEINTES } from './commun'

export default function VuePanneaux({ synthese, choisi, choisir }: {
  synthese: Synthese
  /** La pastille active, ou null (la colonne montre le jour choisi). */
  choisi: CleListe | null
  choisir: (cle: CleListe) => void
}) {
  const c = chiffresPanneaux(synthese)
  const ic = 'size-3.5 shrink-0'
  const pastilles: { cle: CleListe; icone: ReactNode; chiffre: ReactNode; detail: string }[] = [
    { cle: 'lies', icone: <Link2 className={ic} style={{ color: TEINTES.vert }} aria-hidden="true" />, chiffre: c.lies.n, detail: `${c.lies.n} sur ${c.lies.sur} notés` },
    {
      cle: 'entree', icone: <Crosshair className={ic} style={{ color: TEINTES.bleu }} aria-hidden="true" />,
      chiffre: c.entree.moyenne === null ? '-' : formatPtsSigne(c.entree.moyenne),
      detail: c.entree.moyenne === null ? 'rien à comparer'
        : `${formatPtsSigne(c.entree.moyenne)} ${c.entree.moyenne > 0 ? 'plus loin que' : c.entree.moyenne < 0 ? 'mieux que' : 'pile à'} ton prix prévu, en moyenne${c.entree.instrument ? ` sur ${c.entree.instrument}` : ''}`,
    },
    { cle: 'avant-plan', icone: <LogOut className={ic} style={{ color: TEINTES.ambre }} aria-hidden="true" />, chiffre: c.avantPlan.n, detail: `${c.avantPlan.n} sur ${c.avantPlan.sur}` },
    {
      cle: 'r', icone: <Scale className={ic} style={{ color: TEINTES.violet }} aria-hidden="true" />,
      chiffre: c.r.n > 0 && c.r.prevu !== null && c.r.reel !== null ? `${formatR(c.r.prevu)} / ${formatR(c.r.reel)}` : '-',
      detail: c.r.n > 0 && c.r.prevu !== null && c.r.reel !== null ? `${formatR(c.r.prevu)} prévu contre ${formatR(c.r.reel)} réel` : 'il faut ton stop et un trade du broker',
    },
    { cle: 'sans-broker', icone: <NotebookPen className={ic} aria-hidden="true" />, chiffre: c.sansBroker, detail: c.sansBroker > 0 ? `${c.sansBroker}, importe l'export de ces jours dans le Carnet` : '0' },
    { cle: 'sans-note', icone: <ChartLine className={ic} aria-hidden="true" />, chiffre: c.sansNote, detail: `${c.sansNote}` },
  ]
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Les six chiffres de la période">
      {pastilles.map(p => (
        <button
          key={p.cle}
          type="button"
          onClick={() => choisir(p.cle)}
          aria-pressed={choisi === p.cle}
          title={`${TITRES_LISTES[p.cle]} : ${p.detail}`}
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs ${FOCUS}`}
          style={{
            background: 'var(--node-bg)',
            border: '1px solid var(--node-border)',
            color: 'var(--node-meta)',
            outline: choisi === p.cle ? `2px solid ${TEINTES.bleu}` : undefined,
          }}
        >
          {p.icone}
          <b className="font-bold tabular-nums" style={{ color: 'var(--node-title)' }}>{p.chiffre}</b>
          {COURTS_LISTES[p.cle]}
        </button>
      ))}
    </div>
  )
}
