'use client'

// Le détail d'un trade (fiche 1 du labo, brief J2) : le tableau Prévu (toi) /
// Effectif (broker) / Écart, comme le panneau du Carnet, pour l'ordre et le
// risque quand le Carnet 1.8.14 les a saisis, entrée, stop, TP, taille, chaque
// sortie et R ; puis le ressenti, le jugement et la capture en
// blocs. Les écarts de prix suivent UNE convention, celle du panneau « Ton
// entrée » : orientés par le sens, positif = moins bien (texteEcart) ; vert
// quand c'est mieux, ambre quand c'est moins bien au-delà d'un dixième du
// risque, rouge pour un stop dépassé.

import type { ReactNode } from 'react'
import { Heart, Image as ImageIcon, PenLine } from 'lucide-react'
import type { TradeSynthese } from '@/lib/synthese-trades-pur'
import {
  formatNombre, formatPrix, formatR, lignesDeSortie, orienteSortie, sensDe, texteEcart, texteOrdrePrevu, texteRisquePrevu, texteSensBroker,
} from '@/lib/mes-trades-pur'
import { SURFACE, TEINTES, TeteBloc } from './commun'
import { ContenuCaptures, ContenuJugement, ContenuRessenti } from './fiche-commun'

interface Ligne { libelle: string; prevu: ReactNode; effectif: ReactNode; ecart: ReactNode; couleur?: string }

const absent = (texte = '-') => <span style={{ color: 'var(--node-meta)' }}>{texte}</span>
// Un nombre ne se coupe jamais en deux (l'espace des milliers est une espace simple).
const Nb = ({ children }: { children: ReactNode }) => <span className="whitespace-nowrap">{children}</span>

/** L'écart orienté (positif = moins bien) en mots : « +0,25 pt, moins bien que prévu », « au prix prévu ». */
function ecartOriente(oriente: number | null, proche: boolean, suite?: string | null): { ecart: ReactNode; couleur?: string } {
  if (oriente === null) return { ecart: '' }
  const [chiffre, ...mots] = texteEcart(oriente, suite).split(', ')
  const couleur = oriente < 0 ? TEINTES.vert : oriente > 0 && !proche ? (suite === 'stop dépassé' ? TEINTES.rouge : TEINTES.ambre) : undefined
  return { ecart: mots.length > 0 ? <><Nb>{chiffre}</Nb>, {mots.join(', ')}</> : chiffre, couleur }
}

/** @param integre déplié dans la carte de la fiche (FicheTrade) : sans carte à lui. */
export default function FicheDetail({ trade, integre = false }: { trade: TradeSynthese; integre?: boolean }) {
  const sens = sensDe(trade)
  const p = trade.prevu
  const e = trade.effectif
  const risque = trade.ecarts?.risque ?? null
  const lignes: Ligne[] = []

  // Un écart d'un dixième du risque au plus reste neutre.
  const proche = (x: number) => risque !== null && Math.abs(x) <= risque / 10 + 1e-9
  // Carnet 1.8.14 : le sens et le type d'ordre prévus face au sens exécuté, puis le risque tapé.
  // Seulement quand le membre les a saisis : les trades d'avant gardent leur tableau.
  const ordrePrevu = texteOrdrePrevu(p)
  if (ordrePrevu) {
    const sensBroker = texteSensBroker(trade)
    const inverse = p.sens !== null && sensBroker !== null && sensBroker !== (p.sens === 'achat' ? 'Achat' : 'Vente')
    lignes.push({
      libelle: 'Ordre', prevu: ordrePrevu, effectif: sensBroker ?? absent(),
      ecart: inverse ? 'sens inverse' : '', couleur: inverse ? TEINTES.ambre : undefined,
    })
  }
  const risquePrevu = texteRisquePrevu(p)
  if (risquePrevu) lignes.push({ libelle: 'Risque', prevu: <Nb>{risquePrevu}</Nb>, effectif: absent(), ecart: '' })
  {
    const oriente = trade.ecarts?.entree ?? (p.entree !== null && e?.entree != null ? orienteSortie(e.entree, p.entree, sens) : null)
    lignes.push({
      libelle: 'Entrée', prevu: p.entree !== null ? <Nb>{formatPrix(p.entree)}</Nb> : absent(), effectif: e?.entree != null ? <Nb>{formatPrix(e.entree)}</Nb> : absent(),
      ...ecartOriente(oriente, oriente !== null && proche(oriente)),
    })
  }
  {
    // Un stop plus loin que prévu (plus de risque) est moins bien.
    const oriente = p.stop !== null && e?.stop != null ? orienteSortie(p.stop, e.stop, sens) : null
    lignes.push({
      libelle: 'Stop', prevu: p.stop !== null ? <Nb>{formatPrix(p.stop)}</Nb> : absent(),
      effectif: e ? (e.stop !== null ? <Nb>{formatPrix(e.stop)}</Nb> : absent('non exporté')) : absent(),
      ...ecartOriente(oriente, oriente !== null && proche(oriente)),
    })
  }
  lignes.push({ libelle: 'TP', prevu: p.tp !== null ? <Nb>{formatPrix(p.tp)}</Nb> : absent(), effectif: e ? absent('non exporté') : absent(), ecart: '' })
  {
    const diff = p.taille !== null && e?.taille != null ? Math.round((e.taille - p.taille) * 1e8) / 1e8 : null
    lignes.push({
      libelle: 'Taille', prevu: p.taille !== null ? formatNombre(p.taille) : absent(),
      effectif: e?.taille != null ? (
        <>
          {formatNombre(e.taille)}
          {e.comptes > 1 && <span className="ml-1 whitespace-nowrap text-xs" style={{ color: 'var(--node-meta)' }}>(x{e.comptes} comptes)</span>}
        </>
      ) : absent(),
      ecart: diff === null ? '' : diff === 0 ? '=' : `${diff > 0 ? '+' : ''}${formatNombre(diff)}`,
      couleur: diff ? TEINTES.ambre : undefined,
    })
  }
  for (const s of lignesDeSortie(trade, sens)) {
    lignes.push({
      libelle: s.libelle,
      prevu: s.prevu ? <><Nb>{formatPrix(s.prevu.prix)}</Nb>{s.prevu.estTp ? ' (TP)' : s.prevu.estStop ? ' (stop)' : ''}</> : absent(),
      effectif: s.effectif !== null ? <Nb>{formatPrix(s.effectif)}</Nb> : absent(),
      ...ecartOriente(s.oriente, s.proche, s.suite),
    })
  }
  {
    const rp = p.rPrevu
    const rr = trade.ecarts?.rReel ?? null
    const diff = rp !== null && rr !== null ? Math.round((rr - rp) * 10) / 10 : null
    lignes.push({
      libelle: 'R', prevu: rp !== null ? formatR(rp) : absent(), effectif: rr !== null ? formatR(rr) : absent(),
      ecart: diff === null ? '' : diff === 0 ? '=' : `${diff > 0 ? '+' : ''}${formatR(diff)}`,
      couleur: diff === null || diff === 0 ? undefined : diff > 0 ? TEINTES.vert : TEINTES.ambre,
    })
  }

  const th = 'px-2 py-1.5 text-left align-bottom text-[11.5px] font-medium max-[480px]:px-1'
  return (
    <section className={integre ? 'grid gap-3.5' : 'grid gap-3.5 rounded-2xl p-4'} style={integre ? undefined : SURFACE} aria-label="Le détail du trade">
      {!e && (
        <p className="text-[12.5px]" style={{ color: 'var(--node-meta)' }}>
          Pas de trade du broker lié : seul ton prévu s&apos;affiche. Importe l&apos;export du jour dans le Carnet, puis « Lier ».
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px] tabular-nums max-[480px]:text-xs">
          <thead>
            <tr style={{ color: 'var(--node-meta)', borderBottom: '1px solid var(--node-border)' }}>
              <th className={th}><span className="sr-only">Ligne</span></th>
              <th className={th}>Prévu (toi)</th>
              <th className={th}>Effectif (broker)</th>
              <th className={th}>Écart</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map(l => (
              <tr key={l.libelle} style={{ borderBottom: '1px solid var(--node-border)' }}>
                <th scope="row" className="whitespace-nowrap px-2 py-[7px] text-left font-normal max-[480px]:px-1" style={{ color: 'var(--node-meta)' }}>{l.libelle}</th>
                <td className="px-2 py-[7px] max-[480px]:px-1" style={{ color: 'var(--node-title)' }}>{l.prevu}</td>
                <td className="px-2 py-[7px] max-[480px]:px-1" style={{ color: 'var(--node-title)' }}>{l.effectif}</td>
                <td className="px-2 py-[7px] font-semibold max-[480px]:px-1" style={{ color: l.couleur ?? 'var(--node-title)' }}>{l.ecart}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2.5 min-[761px]:grid-cols-3">
        <div className="grid min-w-0 content-start gap-1.5 rounded-xl p-3" style={{ background: 'var(--case-bg)' }}>
          <TeteBloc icone={<Heart className="size-3.5" aria-hidden="true" />}>Ressenti</TeteBloc>
          <ContenuRessenti trade={trade} />
        </div>
        <div className="grid min-w-0 content-start gap-1.5 rounded-xl p-3" style={{ background: 'var(--case-bg)' }}>
          <TeteBloc icone={<PenLine className="size-3.5" aria-hidden="true" />}>Jugement</TeteBloc>
          <ContenuJugement trade={trade} />
        </div>
        <div className="grid min-w-0 content-start gap-1.5 rounded-xl p-3" style={{ background: 'var(--case-bg)' }}>
          <TeteBloc icone={<ImageIcon className="size-3.5" aria-hidden="true" />}>Capture</TeteBloc>
          <ContenuCaptures trade={trade} />
        </div>
      </div>
    </section>
  )
}
