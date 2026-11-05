// Le curseur des cartes de trade : « Curseur 2 » du labo 2 (LABO-MES-TRADES-V2,
// choisi par Brice le 05/11), le chemin du stop au TP. Tout est en R du risque
// prévu, donc un short se lit comme un long : une piste du stop (8 %) au TP
// (92 %), l'entrée marquée, le trajet du trade de l'entrée à la dernière sortie
// (vert en gain, rouge en perte), un point par sortie (petit pour les
// partielles, plus gros pour la dernière), les partielles prévues en
// pointillés, les repères « Stop », « Entrée », « TP » sous la piste et le R
// obtenu au-dessus de la dernière sortie. Un stop dépassé sort de la piste à
// gauche en pointillés rouges. Sans broker ou sans plan : une piste vide en
// pointillés. La géométrie vit dans geometrieCurseur (mes-trades-pur.ts).

import type { Sens, SortieVsPlan } from '@/lib/synthese-trades-pur'
import { formatRSigne, geometrieCurseur } from '@/lib/mes-trades-pur'
import { TEINTES } from './commun'

export interface CurseurSortieProps {
  sens: Sens | null
  entree: number | null
  stop: number | null
  tp: number | null
  /** Les sorties du broker, dans l'ordre (vide sans trade du broker). */
  sorties: number[]
  /** Les sorties partielles prévues (hors TP). */
  partiels: number[]
  sortieVsPlan: SortieVsPlan | null
  /** Le R du trade (sorties moyennes) ; à défaut, celui de la dernière sortie. */
  rReel?: number | null
}

const MOTS: Record<SortieVsPlan, string> = {
  'tp': 'au TP',
  'avant-tp': 'avant le TP',
  'stop': 'au stop',
  'avant-stop': 'avant le stop',
  'au-dela-stop': 'au-delà du stop',
}

export default function CurseurSortie(props: CurseurSortieProps) {
  const g = geometrieCurseur(props)
  if (!g) {
    return <span className="col-span-full mb-1.5 mt-3 block h-0 border-t-2 border-dashed" style={{ borderColor: 'var(--trade-piste)' }} aria-hidden="true" />
  }
  const couleur = g.gain ? TEINTES.vert : TEINTES.rouge
  const repere = (x: number, fond: string, texte: string) => (
    <>
      <span className="absolute top-[14px] block h-[14px] w-[2px] -translate-x-px rounded-[1px]" style={{ left: `${x}%`, background: fond }} />
      <span className="absolute top-[29px] block -translate-x-1/2 whitespace-nowrap text-[10px] leading-[1.2]" style={{ left: `${x}%`, color: 'var(--node-meta)' }}>{texte}</span>
    </>
  )
  const derniere = g.sorties.length - 1
  const ou = props.sortieVsPlan ? ` ${MOTS[props.sortieVsPlan]}` : ''

  return (
    <span className="relative col-span-full block h-[42px]" role="img" aria-label={`Stop, entrée, TP ; sortie${ou} à ${formatRSigne(g.rObtenu)}`}>
      <span className="absolute top-[19px] block h-1 rounded-full" style={{ left: `${g.stop}%`, width: `${g.tp - g.stop}%`, background: 'var(--trade-piste)' }} />
      {g.deborde && (
        <span className="absolute top-[20px] block h-0 border-t-2 border-dashed" style={{ left: `${g.deborde.de}%`, width: `${g.deborde.a - g.deborde.de}%`, borderColor: TEINTES.rouge }} />
      )}
      <span className="absolute top-[19px] block h-1 rounded-full" style={{ left: `${g.trajet.de}%`, width: `${g.trajet.a - g.trajet.de}%`, background: couleur }} />
      {repere(g.stop, TEINTES.rouge, 'Stop')}
      {repere(g.entree, 'var(--node-title)', 'Entrée')}
      {repere(g.tp, TEINTES.vert, 'TP')}
      {g.partiels.map((x, i) => (
        <span key={`p${i}`} title="Sortie partielle prévue" className="absolute top-[15px] block h-3 -translate-x-px border-l-2 border-dotted opacity-80" style={{ left: `${x}%`, borderColor: 'var(--node-meta)' }} />
      ))}
      {g.sorties.map((x, i) => (
        <span
          key={`s${i}`}
          className={`absolute block rounded-full ${i < derniere ? 'top-[17px] size-2 -translate-x-1' : 'top-[15px] size-3 -translate-x-1.5'}`}
          style={{ left: `${x}%`, background: couleur, boxShadow: '0 0 0 2px var(--node-bg)' }}
        />
      ))}
      <span className="absolute top-0 block -translate-x-1/2 whitespace-nowrap text-[11px] font-bold tabular-nums" style={{ left: `${g.val}%`, color: couleur }}>
        {formatRSigne(g.rObtenu)}
      </span>
    </span>
  )
}
