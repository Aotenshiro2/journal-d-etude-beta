'use client'

// La file des trades (écran 3 du labo 1, brief J2) : une carte par trade, la
// pastille de sortie en mots simples et le curseur (curseur 2 du labo 2). Dans
// les « Vues 4 » du labo 2, c'est la colonne de droite : les trades du jour
// choisi, ou la liste d'une pastille.

import type { TradeSynthese } from '@/lib/synthese-trades-pur'
import type { VuePosition } from '@/lib/positions'
import {
  PASTILLE_SANS_NOTE, dateCourte, formatNombre, heureDe, libelleSens, pastilleDuTrade, sensDe,
  sortiesEffectives, sortiesPrevues, type Element,
} from '@/lib/mes-trades-pur'
import CurseurSortie from './CurseurSortie'
import { FOCUS, PastilleEcart, SURFACE } from './commun'

/** Les props du curseur, tirées d'un trade. */
export function propsCurseur(t: TradeSynthese) {
  const sens = sensDe(t)
  return {
    sens,
    entree: t.prevu.entree ?? t.effectif?.entree ?? null,
    stop: t.prevu.stop ?? t.effectif?.stop ?? null,
    tp: t.prevu.tp,
    sorties: sortiesEffectives(t).map(s => s.prix),
    partiels: sortiesPrevues(t, sens).filter(p => !p.estTp).map(p => p.prix),
    sortieVsPlan: t.ecarts?.sortieVsPlan ?? null,
    rReel: t.ecarts?.rReel ?? null,
  }
}

/** « NQ long, Trade 1 » */
export function titreDuTrade(t: TradeSynthese) {
  return [t.instrument ?? 'Trade', libelleSens(sensDe(t))].filter(Boolean).join(' ') + `, Trade ${t.ordre}`
}

export function CarteTrade({ trade, ouvrir, mesure }: { trade: TradeSynthese; ouvrir: (segmentId: string) => void; mesure?: string | null }) {
  const comptes = trade.effectif && trade.effectif.comptes > 1 ? `${trade.effectif.comptes} comptes` : null
  const meta = [`${dateCourte(trade.startedAt)} ${heureDe(trade.startedAt)}`, trade.jugement?.grade ?? null, comptes].filter(Boolean).join(', ')
  return (
    <button
      type="button"
      onClick={() => ouvrir(trade.segmentId)}
      className={`grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-2xl px-3.5 py-3 text-left transition-[outline-color] hover:outline-2 hover:outline-[var(--float-border)] ${FOCUS}`}
      style={SURFACE}
      aria-label={`${titreDuTrade(trade)}, ${meta}, ${pastilleDuTrade(trade).texte}. Ouvrir la fiche`}
    >
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold" style={{ color: 'var(--node-title)' }}>{titreDuTrade(trade)}</span>
        <span className="block text-xs" style={{ color: 'var(--node-meta)' }}>{meta}</span>
        {mesure && <span className="block truncate text-xs font-medium" style={{ color: 'var(--node-preview)' }}>{mesure}</span>}
      </span>
      <PastilleEcart pastille={pastilleDuTrade(trade)} />
      <CurseurSortie {...propsCurseur(trade)} />
    </button>
  )
}

/** Une position du broker sans note : pas de fiche à ouvrir, une piste vide (pas de plan). */
export function CartePosition({ position }: { position: VuePosition }) {
  const incertaine = !position.fuseau
  const pnl = `${position.pnl > 0 ? '+' : ''}${formatNombre(position.pnl)} ${position.devise}`
  const sens = position.direction === 'long' || position.direction === 'short' ? ` ${position.direction}` : ''
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-2xl px-3.5 py-3"
      style={SURFACE}
      title="Lie-le à sa note depuis le Carnet, bouton « Lier »."
    >
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold" style={{ color: 'var(--node-title)' }}>{position.symbole}{sens}, trade du broker</div>
        <div className="text-xs" style={{ color: 'var(--node-meta)' }}>
          {dateCourte(position.entreLe, incertaine)} {heureDe(position.entreLe, incertaine)}{incertaine ? ' (heure du broker)' : ''}, {pnl}
        </div>
      </div>
      <PastilleEcart pastille={PASTILLE_SANS_NOTE} />
      <CurseurSortie sens={null} entree={null} stop={null} tp={null} sorties={[]} partiels={[]} sortieVsPlan={null} sansNote />
    </div>
  )
}

export function ListeElements({ elements, ouvrirTrade, mesure, vide }: {
  elements: Element[]
  ouvrirTrade: (segmentId: string) => void
  mesure?: (t: TradeSynthese) => string | null
  vide?: string
}) {
  if (elements.length === 0) {
    return <p className="py-6 text-center text-sm" style={{ color: 'var(--node-meta)' }}>{vide ?? 'Aucun trade ici.'}</p>
  }
  return (
    <ul className="grid gap-2" role="list">
      {elements.map(e => (
        <li key={e.cle}>
          {e.type === 'trade'
            ? <CarteTrade trade={e.trade} ouvrir={ouvrirTrade} mesure={mesure?.(e.trade)} />
            : <CartePosition position={e.position} />}
        </li>
      ))}
    </ul>
  )
}

/** La colonne des trades : un titre (« mar. 03/11, 3 trades » ou le nom du panneau), puis les cartes. */
export default function VueFile({ titre, elements, ouvrirTrade, mesure, vide }: {
  titre: string
  elements: Element[]
  ouvrirTrade: (segmentId: string) => void
  mesure?: (t: TradeSynthese) => string | null
  vide?: string
}) {
  return (
    <section className="grid min-w-0 content-start gap-2.5" aria-label={titre}>
      <h2 className="text-xs font-semibold" style={{ color: 'var(--node-meta)' }} aria-live="polite">
        {titre}, {elements.length} trade{elements.length > 1 ? 's' : ''}
      </h2>
      <ListeElements elements={elements} ouvrirTrade={ouvrirTrade} mesure={mesure} vide={vide} />
    </section>
  )
}
