'use client'

// La fiche d'un trade, en échelle (fiche 2 du labo, brief J2) : l'en-tête
// (instrument, sens, date et heure, note de séance, note A/B/C, comptes copiés,
// « Ouvrir la note » toujours visible), l'échelle des prix (niveaux prévus en
// pointillés, exécutions du broker en points pleins, zones de risque et de gain,
// l'écart de sortie fléché), quatre écarts en une ligne chacun, puis le
// ressenti, le jugement et la capture, repliés. « Simple, on est quand même
// dans le journal » (Brice, 05/11).

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ChartLine, Clock, Crosshair, FileText, Heart, Image as ImageIcon, LogOut, PenLine, Scale } from 'lucide-react'
import type { SortieVsPlan, TradeSynthese } from '@/lib/synthese-trades-pur'
import {
  dateCourte, domaineEchelle, etalerLibelles, formatPrix, formatPts, heureDe, libelleSens, ordinal, sensDe,
  sortiesEffectives, sortiesPrevues, texteEntree, texteR, texteSortie, texteTaille,
} from '@/lib/mes-trades-pur'
import { FOCUS, Note, SURFACE, TEINTES } from './commun'
import { ContenuCaptures, ContenuJugement, ContenuRessenti } from './fiche-commun'

const COULEUR_SORTIE: Record<SortieVsPlan, string> = {
  'tp': TEINTES.vert,
  'avant-tp': TEINTES.ambre,
  'stop': 'var(--node-title)',
  'avant-stop': TEINTES.ambre,
  'au-dela-stop': TEINTES.rouge,
}

// -- L'échelle ----------------------------------------------------------------
//
// Dessinée à la largeur réelle de sa colonne (1 unité = 1 px, mesurée) : le
// texte garde sa taille au téléphone comme au bureau. En étroit, les libellés
// raccourcissent (« TP 20 140 » au lieu de « TP prévu 20 140 ») et la légende
// dessous dit ce que sont les pointillés et les points.

interface Niveau { prix: number; libelle: string; court: string; couleur: string }
interface Fait { prix: number; libelle: string; court: string; couleur: string; grand: boolean }

function Echelle({ trade }: { trade: TradeSynthese }) {
  const boite = useRef<HTMLDivElement>(null)
  const [largeur, setLargeur] = useState(420)
  useEffect(() => {
    const el = boite.current
    if (!el) return
    const maj = () => setLargeur(Math.max(260, Math.round(el.clientWidth)))
    maj()
    const ro = new ResizeObserver(maj)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={boite} className="grid min-w-0 gap-1.5">
      <DessinEchelle trade={trade} L={largeur} />
    </div>
  )
}

function DessinEchelle({ trade, L }: { trade: TradeSynthese; L: number }) {
  const sens = sensDe(trade)
  const p = trade.prevu
  const e = trade.effectif
  const stopBroker = p.stop === null ? e?.stop ?? null : null
  const couleurSortie = trade.ecarts?.sortieVsPlan ? COULEUR_SORTIE[trade.ecarts.sortieVsPlan] : 'var(--node-title)'

  const niveaux: Niveau[] = []
  if (p.tp !== null) niveaux.push({ prix: p.tp, libelle: `TP prévu ${formatPrix(p.tp)}`, court: `TP ${formatPrix(p.tp)}`, couleur: TEINTES.vert })
  const prevues = sortiesPrevues(trade, sens)
  prevues.forEach((s, i) => {
    if (s.estTp) return
    const nom = prevues.length > 1 ? `${ordinal(i + 1)} sortie` : 'Sortie'
    niveaux.push({ prix: s.prix, libelle: `${nom} prévue ${formatPrix(s.prix)}`, court: `${nom} ${formatPrix(s.prix)}`, couleur: 'var(--node-meta)' })
  })
  if (p.entree !== null) niveaux.push({ prix: p.entree, libelle: `Entrée prévue ${formatPrix(p.entree)}`, court: `Entrée ${formatPrix(p.entree)}`, couleur: TEINTES.bleu })
  if (p.stop !== null) niveaux.push({ prix: p.stop, libelle: `Stop ${formatPrix(p.stop)}`, court: `Stop ${formatPrix(p.stop)}`, couleur: TEINTES.rouge })
  else if (stopBroker !== null) niveaux.push({ prix: stopBroker, libelle: `Stop du broker ${formatPrix(stopBroker)}`, court: `Stop broker ${formatPrix(stopBroker)}`, couleur: TEINTES.rouge })

  const sorties = sortiesEffectives(trade)
  const faits: Fait[] = []
  if (e?.entree != null) faits.push({ prix: e.entree, libelle: `entrée ${formatPrix(e.entree)}`, court: formatPrix(e.entree), couleur: TEINTES.bleu, grand: false })
  sorties.forEach((s, i) => faits.push({
    prix: s.prix, libelle: `sortie ${formatPrix(s.prix)}`, court: formatPrix(s.prix),
    couleur: i === sorties.length - 1 ? couleurSortie : 'var(--node-title)', grand: i === sorties.length - 1,
  }))

  const domaine = domaineEchelle([...niveaux.map(n => n.prix), ...faits.map(f => f.prix)])
  if (!domaine) {
    return (
      <p className="rounded-xl p-4 text-[12.5px]" style={{ background: 'var(--case-bg)', color: 'var(--node-meta)' }}>
        Pas de prix tapé dans le Carnet ni de trade du broker : rien à placer sur l&apos;échelle.
      </p>
    )
  }

  // La géométrie, à la largeur mesurée.
  const etroit = L < 420
  const H = etroit ? 260 : 300
  const HAUT = 22
  const BAS = H - 22
  const taille = etroit ? 10.5 : 11.5
  const tailleFait = etroit ? 10 : 10.5
  const xLigne = etroit ? Math.min(118, Math.round(L * 0.4)) : Math.min(190, Math.max(160, Math.round(L * 0.34)))
  const largeurZone = etroit ? 40 : 70
  const xFleche = L - 22
  const xEntree = xLigne + largeurZone + (etroit ? 26 : 34)
  const pas = sorties.length > 0 ? Math.min(etroit ? 48 : 64, (xFleche - 24 - xEntree) / sorties.length) : 0

  const [min, max] = domaine
  const y = (prix: number) => HAUT + ((max - prix) / (max - min)) * (BAS - HAUT)
  const yLibelles = etalerLibelles(niveaux.map(n => y(n.prix) + 4), taille + 3, HAUT - 6, BAS + 10)

  const entreeRef = p.entree ?? e?.entree ?? null
  const stopRef = p.stop ?? stopBroker
  const zone = (a: number, b: number, couleur: string, cle: string) => (
    <rect key={cle} x={xLigne} y={Math.min(y(a), y(b))} width={largeurZone} height={Math.abs(y(a) - y(b))} style={{ fill: couleur }} opacity={0.12} />
  )

  // Les points du broker : l'entrée, puis chaque sortie un peu plus à droite.
  const xFait = (i: number) => (e?.entree != null ? xEntree + pas * i : xEntree + pas * (i + 1))
  const placements = faits.map((f, i) => ({ ...f, texte: etroit ? f.court : f.libelle, x: xFait(i), y: y(f.prix) }))
  // Un libellé au-dessus du point ; dessous pour l'entrée, pour une sortie trop
  // proche d'un voisin libellé au-dessus, ou quand un niveau prévu passerait dessus.
  const lignesY = niveaux.map(n => y(n.prix))
  const gene = (base: number) => lignesY.some(l => l > base - taille - 1 && l < base + 4)
  const dessous: boolean[] = []
  placements.forEach((f, i) => {
    if (i === 0 && e?.entree != null) { dessous.push(true); return }
    const voisin = i > 0 && !dessous[i - 1] && Math.abs(f.y - placements[i - 1].y) < 16
    dessous.push(voisin || (gene(f.y - 11) && !gene(f.y + 18)))
  })
  // Un libellé qui sortirait à droite s'aligne sur le point.
  const ancre = (f: (typeof placements)[number]) => (f.x + (f.texte.length * tailleFait * 0.56) / 2 > L - 4 ? 'end' : 'middle')

  // L'écart de sortie fléché : la dernière sortie face au TP ou au stop.
  let fleche: { de: number; a: number; texte: string; couleur: string } | null = null
  const derniere = sorties.length > 0 ? sorties[sorties.length - 1].prix : null
  const vs = trade.ecarts?.sortieVsPlan
  if (derniere !== null && vs === 'avant-tp' && p.tp !== null) fleche = { de: derniere, a: p.tp, texte: formatPts(p.tp - derniere), couleur: TEINTES.ambre }
  else if (derniere !== null && vs === 'au-dela-stop' && stopRef !== null) fleche = { de: stopRef, a: derniere, texte: formatPts(derniere - stopRef), couleur: TEINTES.rouge }
  else if (derniere !== null && vs === 'avant-stop' && stopRef !== null) fleche = { de: derniere, a: stopRef, texte: formatPts(derniere - stopRef), couleur: TEINTES.ambre }

  const resume = [
    stopRef !== null ? `stop ${formatPrix(stopRef)}` : 'pas de stop',
    p.entree !== null ? `entrée prévue ${formatPrix(p.entree)}` : null,
    e?.entree != null ? `exécutée ${formatPrix(e.entree)}` : 'pas de trade du broker',
    sorties.length > 0 ? `sorties à ${sorties.map(s => formatPrix(s.prix)).join(' et ')}` : null,
    p.tp !== null ? `TP prévu ${formatPrix(p.tp)}` : 'pas de TP',
  ].filter(Boolean).join(', ')

  return (
    <>
      <svg width={L} height={H} viewBox={`0 0 ${L} ${H}`} className="block h-auto w-full" role="img" aria-label={`Échelle des prix : ${resume}`}>
        {entreeRef !== null && p.tp !== null && zone(entreeRef, p.tp, TEINTES.vert, 'gain')}
        {entreeRef !== null && stopRef !== null && zone(entreeRef, stopRef, TEINTES.rouge, 'risque')}
        {niveaux.map((n, i) => (
          <g key={`n${i}`}>
            <line x1={xLigne} x2={L - 8} y1={y(n.prix)} y2={y(n.prix)} style={{ stroke: n.couleur }} strokeWidth={1.5} strokeDasharray="5 4" />
            <text x={xLigne - 8} y={yLibelles[i]} textAnchor="end" fontSize={taille} style={{ fill: n.couleur }}>{etroit ? n.court : n.libelle}</text>
          </g>
        ))}
        {fleche && (
          <g style={{ stroke: fleche.couleur }} fill="none" strokeWidth={1.5}>
            <path d={`M ${placements[placements.length - 1].x + 8} ${y(derniere as number)} L ${xFleche} ${y(derniere as number)}`} strokeDasharray="2 3" />
            <path d={`M ${xFleche} ${y(fleche.de)} L ${xFleche} ${y(fleche.a)}`} />
            <path d={`M ${xFleche - 4} ${y(fleche.a) + (y(fleche.a) > y(fleche.de) ? -6 : 6)} L ${xFleche} ${y(fleche.a)} L ${xFleche + 4} ${y(fleche.a) + (y(fleche.a) > y(fleche.de) ? -6 : 6)}`} />
            <text
              x={xFleche + 11} y={(y(fleche.de) + y(fleche.a)) / 2} fontSize={tailleFait} textAnchor="middle" stroke="none"
              transform={`rotate(-90 ${xFleche + 11} ${(y(fleche.de) + y(fleche.a)) / 2})`} style={{ fill: fleche.couleur }}
            >
              {fleche.texte}
            </text>
          </g>
        )}
        {placements.map((f, i) => (
          <g key={`f${i}`}>
            <circle cx={f.x} cy={f.y} r={f.grand ? 7 : 6} style={{ fill: f.couleur, stroke: 'var(--node-bg)' }} strokeWidth={f.grand ? 2 : 0} />
            <text
              x={ancre(f) === 'end' ? f.x + 8 : f.x} y={dessous[i] ? f.y + 19 : f.y - 11}
              textAnchor={ancre(f)} fontSize={tailleFait} style={{ fill: 'var(--node-preview)' }}
            >
              {f.texte}
            </text>
          </g>
        ))}
      </svg>
      <p className="text-[11px]" style={{ color: 'var(--node-meta)' }}>
        Pointillés : ton plan dans le Carnet.{e ? ' Points : ce que le broker a exécuté (un compte).' : ''}
      </p>
    </>
  )
}

// -- Les écarts et le repli ---------------------------------------------------

function Ecart({ icone, question, reponse }: { icone: ReactNode; question: string; reponse: string | null }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl px-3 py-2.5" style={{ background: 'var(--case-bg)' }}>
      <span className="mt-0.5">{icone}</span>
      <span className="grid min-w-0">
        <span className="text-[11.5px]" style={{ color: 'var(--node-meta)' }}>{question}</span>
        <span className="text-sm font-semibold" style={{ color: reponse ? 'var(--node-title)' : 'var(--node-meta)' }}>{reponse ?? 'Rien à comparer'}</span>
      </span>
    </div>
  )
}

type Pli = 'ressenti' | 'jugement' | 'capture'

export function texteComptes(trade: TradeSynthese): string {
  if (!trade.effectif) return 'pas de trade du broker lié'
  return trade.effectif.comptes > 1 ? `lié à ${trade.effectif.comptes} comptes copiés` : 'lié au broker'
}

/**
 * @param sansRepli le détail est déplié dessous (FicheTrade) : la rangée repliée
 *   (ressenti, jugement, capture, note) se cache, comme dans la fiche 1 du labo 2.
 * @param children ce qui suit dans la même carte (le bouton « Voir le détail » et le détail).
 */
export default function FicheEchelle({ trade, sansRepli = false, children }: { trade: TradeSynthese; sansRepli?: boolean; children?: ReactNode }) {
  const [ouvertBrut, setOuvert] = useState<Pli | null>(null)
  const ouvert = sansRepli ? null : ouvertBrut
  const sens = libelleSens(sensDe(trade))
  const titre = `Trade ${trade.ordre} : ${[trade.instrument ?? 'trade', sens].filter(Boolean).join(' ')}`
  const incertaine = trade.ecarts?.heureIncertaine ?? false
  const ic = 'size-[18px] shrink-0'
  const resumeRessenti = trade.ressenti.emotion ?? (trade.ressenti.emotionDepart !== null ? `${trade.ressenti.emotionDepart} / 100` : null)

  const pli = (cle: Pli, icone: ReactNode, libelle: string) => (
    <button
      type="button"
      onClick={() => setOuvert(o => (o === cle ? null : cle))}
      aria-expanded={ouvert === cle}
      aria-controls={`pli-${cle}`}
      className={`inline-flex max-w-full cursor-pointer items-center gap-1.5 truncate rounded-full px-2.5 py-1.5 text-xs ${FOCUS}`}
      style={{ background: ouvert === cle ? 'var(--action-doux-bg)' : 'var(--case-bg)', color: ouvert === cle ? 'var(--node-title)' : 'var(--node-meta)' }}
    >
      {icone}<span className="truncate">{libelle}</span>
    </button>
  )

  return (
    <article className="grid gap-3.5 rounded-2xl p-4" style={SURFACE} aria-labelledby="fiche-titre">
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          {trade.noteTitle && <p className="truncate text-[11.5px]" style={{ color: 'var(--node-meta)' }}>{trade.noteTitle}</p>}
          <h1 id="fiche-titre" className="text-[15px] font-bold" style={{ color: 'var(--node-title)' }}>{titre}</h1>
          <p className="text-xs" style={{ color: 'var(--node-meta)' }}>
            {dateCourte(trade.startedAt, false, true)} à {heureDe(trade.startedAt)}, {texteComptes(trade)}
          </p>
          {incertaine && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs" style={{ color: TEINTES.ambre }}>
              <Clock className="size-3.5 shrink-0" aria-hidden="true" />
              Heure du broker incertaine : son fichier ne disait pas le fuseau.
            </p>
          )}
        </div>
        {/* « Ouvrir la note » vit dans l'en-tête, près du grade : il reste là quand le détail est déplié. */}
        <div className="flex items-center gap-2">
          {trade.jugement && <Note grade={trade.jugement.grade} />}
          <Link
            href={`/notes/${encodeURIComponent(trade.noteId)}`}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium hover:text-[var(--node-title)] ${FOCUS}`}
            style={{ background: 'var(--case-bg)', color: 'var(--node-meta)' }}
            title={trade.noteTitle ?? undefined}
          >
            <FileText className="size-3.5 shrink-0" aria-hidden="true" />Ouvrir la note
          </Link>
        </div>
      </header>

      <div className="grid items-start gap-4 min-[761px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Echelle trade={trade} />
        <div className="grid gap-2">
          <Ecart icone={<Crosshair className={ic} style={{ color: TEINTES.bleu }} aria-hidden="true" />} question="Entrée" reponse={texteEntree(trade)} />
          <Ecart icone={<LogOut className={ic} style={{ color: TEINTES.ambre }} aria-hidden="true" />} question="Sortie" reponse={texteSortie(trade)} />
          <Ecart icone={<Scale className={ic} style={{ color: 'var(--node-meta)' }} aria-hidden="true" />} question="Taille" reponse={texteTaille(trade)} />
          <Ecart icone={<ChartLine className={ic} style={{ color: TEINTES.violet }} aria-hidden="true" />} question="R" reponse={texteR(trade)} />
        </div>
      </div>

      {!sansRepli && <div className="flex flex-wrap gap-2">
        {pli('ressenti', <Heart className="size-3.5 shrink-0" aria-hidden="true" />, resumeRessenti ? `Ressenti : ${resumeRessenti}` : 'Ressenti')}
        {pli('jugement', <PenLine className="size-3.5 shrink-0" aria-hidden="true" />, trade.jugement ? `Jugement ${trade.jugement.grade}` : 'Jugement')}
        {pli('capture', <ImageIcon className="size-3.5 shrink-0" aria-hidden="true" />, trade.captures.length > 1 ? `Captures (${trade.captures.length})` : 'Capture')}
      </div>}
      {ouvert && (
        <div id={`pli-${ouvert}`} className="rounded-xl p-3" style={{ background: 'var(--case-bg)' }}>
          {ouvert === 'ressenti' && <ContenuRessenti trade={trade} />}
          {ouvert === 'jugement' && <ContenuJugement trade={trade} />}
          {ouvert === 'capture' && <ContenuCaptures trade={trade} />}
        </div>
      )}
      {children}
    </article>
  )
}
