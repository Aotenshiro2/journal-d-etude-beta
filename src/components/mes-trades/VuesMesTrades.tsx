'use client'

// Comment les trois vues de « Mes trades » vivent ensemble : « Vues 4 » du
// labo 2 (LABO-MES-TRADES-V2, choisi par Brice le 05/11). Sous la barre, les
// six chiffres en bandeau de pastilles (VuePanneaux) ; dessous, deux colonnes :
// le calendrier du mois et sa légende (VueCalendrier), et les cartes du jour
// choisi (VueFile), titrées « mar. 03/11, 3 trades ». Une pastille remplace la
// colonne de droite par la liste de son panneau ; la recliquer revient au jour ;
// choisir un jour enlève la pastille. Par défaut, le dernier jour de la période
// qui a des trades. Sous 760 px, les colonnes s'empilent : calendrier, puis
// liste. Le jour et la pastille vivent dans l'URL (?jour=, ?liste=, voir MesTrades).

import { useMemo } from 'react'
import type { Synthese, TradeSynthese } from '@/lib/synthese-trades-pur'
import {
  TITRES_LISTES, dernierJourAvecTrades, elementsDe, elementsDeLaListe, libelleJour, parJour, texteEntree, texteR,
  type CleListe, type Periode,
} from '@/lib/mes-trades-pur'
import VuePanneaux from './VuePanneaux'
import VueCalendrier from './VueCalendrier'
import VueFile from './VueFile'

export interface VuesMesTradesProps {
  synthese: Synthese
  periode: Periode
  maintenant: Date
  /** Le jour choisi (AAAA-MM-JJ), null = le dernier jour de la période qui a des trades. */
  jour: string | null
  /** La pastille active, ou null. */
  liste: CleListe | null
  choisirJour: (jour: string) => void
  /** Cliquer une pastille : la même pastille revient au jour (à l'appelant de basculer). */
  choisirPanneau: (cle: CleListe) => void
  ouvrirTrade: (segmentId: string) => void
}

const MESURES: Partial<Record<CleListe, (t: TradeSynthese) => string | null>> = {
  'entree': t => { const x = texteEntree(t); return x ? `Entrée : ${x}` : null },
  'r': t => { const x = texteR(t); return x ? `R : ${x}` : null },
}

export default function VuesMesTrades({ synthese, periode, maintenant, jour, liste, choisirJour, choisirPanneau, ouvrirTrade }: VuesMesTradesProps) {
  const elements = useMemo(() => elementsDe(synthese), [synthese])
  const jourVise = jour ?? dernierJourAvecTrades(elements)
  const duJour = useMemo(() => (jourVise ? [...(parJour(elements).get(jourVise) ?? [])].reverse() : []), [elements, jourVise])

  return (
    <div className="grid gap-3.5">
      <VuePanneaux synthese={synthese} choisi={liste} choisir={choisirPanneau} />
      <div className="grid items-start gap-3 min-[761px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <VueCalendrier
          synthese={synthese}
          periode={periode}
          maintenant={maintenant}
          jour={jourVise}
          cercle={liste === null}
          choisirJour={choisirJour}
        />
        {liste ? (
          <VueFile
            titre={TITRES_LISTES[liste]}
            elements={elementsDeLaListe(liste, synthese)}
            ouvrirTrade={ouvrirTrade}
            mesure={MESURES[liste]}
            vide="Aucun trade ici sur cette période."
          />
        ) : (
          <VueFile
            titre={jourVise ? libelleJour(jourVise) : 'Aucun jour'}
            elements={duJour}
            ouvrirTrade={ouvrirTrade}
            vide="Aucun trade ce jour-là sur cette période."
          />
        )}
      </div>
    </div>
  )
}
