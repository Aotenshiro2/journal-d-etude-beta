'use client'

// La fiche d'un trade : « Fiche 1 » du labo 2 (LABO-MES-TRADES-V2, choisie par
// Brice le 05/11). L'échelle (FicheEchelle), puis, dans la même carte, le
// bouton « Voir le détail » qui déplie le tableau Prévu / Effectif / Écart, le
// ressenti, le jugement et la capture (FicheDetail). Ouvert, la rangée repliée
// de l'échelle se cache. L'état déplié est retenu dans le navigateur. « Simple
// comme la fiche 2, avec le détail de la fiche 1 » (Brice, 05/11). Le bouton a
// le fond en creux de la carte (--case-bg) : --action-doux-bg se confond avec
// --node-bg en clair.

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { TradeSynthese } from '@/lib/synthese-trades-pur'
import FicheEchelle from './FicheEchelle'
import FicheDetail from './FicheDetail'
import { FOCUS } from './commun'

const CLE_STOCKAGE = 'journal-mes-trades-detail'

export default function FicheTrade({ trade }: { trade: TradeSynthese }) {
  const [detail, setDetail] = useState(false)

  useEffect(() => {
    try {
      setDetail(window.localStorage.getItem(CLE_STOCKAGE) === '1')
    } catch {
      // stockage refusé : replié par défaut
    }
  }, [])

  const basculer = () => {
    const suivant = !detail
    setDetail(suivant)
    try { window.localStorage.setItem(CLE_STOCKAGE, suivant ? '1' : '0') } catch { /* rien à garder */ }
  }

  return (
    <FicheEchelle trade={trade} sansRepli={detail}>
      <button
        type="button"
        onClick={basculer}
        aria-expanded={detail}
        aria-controls="fiche-detail"
        className={`inline-flex cursor-pointer items-center gap-1.5 justify-self-start rounded-full px-3.5 py-[7px] text-[12.5px] font-semibold ${FOCUS}`}
        style={{ background: 'var(--case-bg)', color: 'var(--node-title)' }}
      >
        {detail ? 'Masquer le détail' : 'Voir le détail'}
        <ChevronDown className="size-3.5 transition-transform motion-reduce:transition-none" style={{ transform: detail ? 'rotate(180deg)' : undefined }} aria-hidden="true" />
      </button>
      {detail && <div id="fiche-detail"><FicheDetail trade={trade} integre /></div>}
    </FicheEchelle>
  )
}
