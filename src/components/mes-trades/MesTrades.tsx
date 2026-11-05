'use client'

// L'écran « Mes trades » du Journal (brief J2, 05/11/2026), à la place de
// « Documenter mes trades » : ce que le membre avait prévu dans le Carnet face
// à ce que le broker a exécuté. Données : GET /api/trades/synthese (lecture
// seule) pour la période choisie dans la barre (Ce mois, 3 mois, Tout).
//
// Tout se dit dans l'URL, pour que le retour du navigateur marche et qu'une
// fiche se partage : /journal (les vues, labo 2 « Vues 4 » : pastilles,
// calendrier, trades du jour), ?jour=AAAA-MM-JJ (le jour choisi), ?liste=<panneau>
// (la pastille active), ?trade=<segmentId> (la fiche d'un trade, cherchée dans
// « Tout » si elle n'est pas dans la période).

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ExternalLink, LoaderCircle, NotebookPen, TriangleAlert } from 'lucide-react'
import type { Synthese, TradeSynthese } from '@/lib/synthese-trades-pur'
import { PERIODES, estCleListe, estPeriode, urlSynthese, type CleListe, type Periode } from '@/lib/mes-trades-pur'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import VuesMesTrades from './VuesMesTrades'
import FicheTrade from './FicheTrade'
import { FOCUS } from './commun'

export type ChargerSynthese = (periode: Periode) => Promise<Synthese>

type Etat = { statut: 'chargement' } | { statut: 'ok'; synthese: Synthese } | { statut: 'erreur'; message: string }

const JOUR = /^\d{4}-\d{2}-\d{2}$/
const PAGE_CARNET = 'https://aoknowledge.com/library/extension'

function chargeurParDefaut(maintenant: Date): ChargerSynthese {
  return async periode => {
    const res = await fetch(urlSynthese(periode, maintenant), { cache: 'no-store' })
    if (!res.ok) {
      let message = `Erreur ${res.status}`
      try {
        const corps = await res.json()
        if (corps && typeof corps.error === 'string') message = corps.error
      } catch {
        // corps illisible : le code suffit
      }
      throw new Error(message)
    }
    return res.json() as Promise<Synthese>
  }
}

export interface MesTradesProps {
  /** D'où viennent les données (par défaut, la route de synthèse) : un essai sans base passe ses exemples ici. */
  charger?: ChargerSynthese
  /** Le « maintenant » des périodes et du calendrier (par défaut, l'heure du navigateur). */
  maintenant?: Date
}

export default function MesTrades(props: MesTradesProps) {
  return (
    <Suspense fallback={<Attente />}>
      <MesTradesContenu {...props} />
    </Suspense>
  )
}

function MesTradesContenu({ charger: chargerDonne, maintenant: maintenantDonne }: MesTradesProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [maintenant] = useState(() => maintenantDonne ?? new Date())
  const charger = useMemo(() => chargerDonne ?? chargeurParDefaut(maintenant), [chargerDonne, maintenant])
  const [periode, setPeriode] = useState<Periode>('mois')
  const [etats, setEtats] = useState<Partial<Record<Periode, Etat>>>({})
  const enCours = useRef(new Set<Periode>())

  const lancer = useCallback((p: Periode) => {
    if (enCours.current.has(p)) return
    enCours.current.add(p)
    setEtats(e => ({ ...e, [p]: { statut: 'chargement' } }))
    charger(p)
      .then(
        synthese => setEtats(e => ({ ...e, [p]: { statut: 'ok', synthese } })),
        (err: unknown) => setEtats(e => ({ ...e, [p]: { statut: 'erreur', message: err instanceof Error ? err.message : 'Erreur inconnue' } })),
      )
      .finally(() => enCours.current.delete(p))
  }, [charger])

  useEffect(() => { if (!etats[periode]) lancer(periode) }, [periode, etats, lancer])

  const tradeId = params.get('trade')
  const listeBrute = params.get('liste')
  const liste: CleListe | null = estCleListe(listeBrute) ? listeBrute : null
  const jourBrut = params.get('jour')
  const jour = jourBrut && JOUR.test(jourBrut) ? jourBrut : null

  const etat = etats[periode]
  const synthese = etat?.statut === 'ok' ? etat.synthese : null
  const etatTout = etats.tout
  const syntheseTout = etatTout?.statut === 'ok' ? etatTout.synthese : null

  // La fiche : dans la période affichée, sinon dans « Tout » (lien partagé, badge d'une note).
  const trouver = (s: Synthese | null): TradeSynthese | null => (tradeId && s ? s.trades.find(t => t.segmentId === tradeId) ?? null : null)
  const trade = trouver(synthese) ?? trouver(syntheseTout)
  const chercherDansTout = !!tradeId && !trade && etat?.statut === 'ok' && periode !== 'tout' && !etatTout
  useEffect(() => { if (chercherDansTout) lancer('tout') }, [chercherDansTout, lancer])

  // Navigation. Le jour et la pastille changent la colonne de droite sans
  // empiler l'historique (replace) ; ouvrir une fiche pousse une entrée, que le
  // retour du navigateur défait. « Retour » revient en arrière quand on est
  // venu d'ici, sinon remonte au jour ou à la pastille de la fiche.
  const profondeur = useRef(0)
  useEffect(() => {
    const surRetour = () => { profondeur.current = Math.max(0, profondeur.current - 1) }
    window.addEventListener('popstate', surRetour)
    return () => window.removeEventListener('popstate', surRetour)
  }, [])
  const adresse = (q: Record<string, string | null>) => {
    const s = new URLSearchParams()
    for (const [k, v] of Object.entries(q)) if (v) s.set(k, v)
    const texte = s.toString()
    return texte ? `${pathname}?${texte}` : pathname
  }
  const remplacer = (q: Record<string, string | null>) => router.replace(adresse(q), { scroll: false })
  const retour = () => {
    if (profondeur.current > 0) router.back()
    else remplacer({ liste, jour })
  }
  const ouvrirTrade = (segmentId: string) => {
    profondeur.current += 1
    router.push(adresse({ liste, jour, trade: segmentId }), { scroll: false })
  }
  // Choisir un jour enlève la pastille ; recliquer la pastille active revient au jour.
  const choisirJour = (j: string) => remplacer({ jour: j })
  const choisirPanneau = (cle: CleListe) => remplacer({ jour, liste: liste === cle ? null : cle })
  // Une autre période : le jour par défaut (le dernier qui a des trades), la pastille reste.
  const changerPeriode = (p: Periode) => {
    setPeriode(p)
    if (jour) remplacer({ liste })
  }

  // La fiche repart du haut, et le retour retrouve la liste en haut aussi.
  const defilement = useRef<HTMLDivElement>(null)
  useEffect(() => { defilement.current?.scrollTo({ top: 0 }) }, [tradeId])

  let contenu: ReactNode
  if (tradeId) {
    if (trade) {
      contenu = <><BoutonRetour onClick={retour} /><FicheTrade trade={trade} /></>
    } else if (etat?.statut === 'erreur') {
      contenu = <><BoutonRetour onClick={retour} /><Erreur message={etat.message} reessayer={() => { setEtats(e => ({ ...e, [periode]: undefined })) }} /></>
    } else if (!etat || etat.statut === 'chargement' || chercherDansTout || etatTout?.statut === 'chargement') {
      contenu = <Attente />
    } else {
      contenu = (
        <>
          <BoutonRetour onClick={retour} />
          <p className="py-10 text-center text-sm" style={{ color: 'var(--node-meta)' }}>
            Ce trade est introuvable : sa note a peut-être été supprimée.
          </p>
        </>
      )
    }
  } else if (!etat || etat.statut === 'chargement') {
    contenu = <Attente />
  } else if (etat.statut === 'erreur') {
    contenu = <Erreur message={etat.message} reessayer={() => setEtats(e => ({ ...e, [periode]: undefined }))} />
  } else if (etat.synthese.trades.length === 0 && etat.synthese.positionsSansNote.length === 0) {
    contenu = <Vide periode={periode} voirTout={() => changerPeriode('tout')} />
  } else {
    contenu = (
      <VuesMesTrades
        synthese={etat.synthese}
        periode={periode}
        maintenant={maintenant}
        jour={jour}
        liste={liste}
        choisirJour={choisirJour}
        choisirPanneau={choisirPanneau}
        ouvrirTrade={ouvrirTrade}
      />
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {!tradeId && <ChoixPeriode periode={periode} onChange={changerPeriode} />}
      <div ref={defilement} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1080px] content-start gap-3.5 px-4 pb-28 pt-2">
          {contenu}
        </div>
      </div>
    </div>
  )
}

/** La période, dans la barre du haut, à côté du titre « Mes trades ». */
function ChoixPeriode({ periode, onChange }: { periode: Periode; onChange: (p: Periode) => void }) {
  return (
    <div className="fixed right-[56px] top-[14px] z-20 max-[400px]:right-[52px]">
      <ToggleGroup
        value={[periode]}
        onValueChange={(v: string[]) => { if (estPeriode(v[0])) onChange(v[0]) }}
        size="sm"
        spacing={0}
        aria-label="Période"
        className="canvas-float-pill gap-0.5 p-[3px]"
        style={{ borderRadius: 999 }}
      >
        {PERIODES.map(p => (
          <ToggleGroupItem
            key={p.cle}
            value={p.cle}
            className="h-6 min-w-0 cursor-pointer rounded-full px-2.5 text-[11.5px] text-[var(--node-meta)] hover:bg-transparent hover:text-[var(--node-title)] aria-pressed:bg-[var(--action-plein-bg)] aria-pressed:text-[var(--action-plein-fg)] data-[pressed]:bg-[var(--action-plein-bg)] data-[pressed]:text-[var(--action-plein-fg)] max-[400px]:px-1.5"
          >
            {p.libelle}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

function BoutonRetour({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`canvas-float-pill inline-flex cursor-pointer items-center gap-1.5 justify-self-start px-3 py-1.5 text-xs font-medium ${FOCUS}`}
      style={{ color: 'var(--node-title)', borderRadius: 999 }}
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" />Retour
    </button>
  )
}

function Attente() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm" style={{ color: 'var(--node-meta)' }} role="status">
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Chargement de tes trades
    </div>
  )
}

function Erreur({ message, reessayer }: { message: string; reessayer: () => void }) {
  return (
    <div className="grid justify-items-center gap-2.5 py-14 text-center" role="alert">
      <TriangleAlert className="size-7" style={{ color: 'var(--trade-ambre)' }} aria-hidden="true" />
      <p className="text-sm font-semibold" style={{ color: 'var(--node-title)' }}>Tes trades n&apos;ont pas pu se charger.</p>
      <p className="max-w-sm text-xs" style={{ color: 'var(--node-meta)' }}>{message}</p>
      <button
        type="button"
        onClick={reessayer}
        className={`mt-1 cursor-pointer rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${FOCUS}`}
        style={{ background: 'var(--action-plein-bg)', color: 'var(--action-plein-fg)' }}
      >
        Réessayer
      </button>
    </div>
  )
}

function Vide({ periode, voirTout }: { periode: Periode; voirTout: () => void }) {
  return (
    <div className="grid justify-items-center gap-2.5 py-14 text-center">
      <NotebookPen className="size-8" style={{ color: 'var(--node-meta)', opacity: 0.6 }} aria-hidden="true" />
      <p className="text-sm font-semibold" style={{ color: 'var(--node-title)' }}>
        {periode === 'tout' ? 'Aucun trade pour l\'instant.' : 'Aucun trade sur cette période.'}
      </p>
      <p className="max-w-sm text-[13px]" style={{ color: 'var(--node-meta)' }}>
        Dans le Carnet, « Lancer un trade » quand tu entres et tape ton plan, puis importe l&apos;export de ton broker par le menu de la roue.
      </p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <a
          href={PAGE_CARNET}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${FOCUS}`}
          style={{ background: 'var(--action-plein-bg)', color: 'var(--action-plein-fg)' }}
        >
          Le Carnet du Trader<ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
        {periode !== 'tout' && (
          <button
            type="button"
            onClick={voirTout}
            className={`cursor-pointer rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${FOCUS}`}
            style={{ background: 'var(--action-doux-bg)', color: 'var(--action-doux-fg)' }}
          >
            Voir tout
          </button>
        )}
      </div>
    </div>
  )
}
