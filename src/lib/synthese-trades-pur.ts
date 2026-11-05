// La synthèse des trades d'un membre (brief J1, J4, 05/11/2026) : le « prévu »
// tapé dans le Carnet (Note.trades[].prix) face à l'« effectif » du broker
// (positions de TradeImport liées par segmentRef), avec le ressenti, le
// jugement A/B/C et les captures. Données propres, lisibles par API
// (GET /api/trades/synthese) ; aucun écran ici, aucun assistant.
//
// Module PUR (n'importe que des modules purs) : la route lit la base, ici on
// calcule. scripts/verifier-synthese-trades.mjs le charge tel quel.
//
// Conventions :
// - sens : direction de la position, sinon déduit du stop (stop sous l'entrée =
//   long, au-dessus = short), sinon inconnu (écarts orientés à null) ;
// - écarts d'entrée et de sortie orientés par le sens, POSITIF = moins bon
//   (long payé plus cher ou vendu plus bas, short vendu plus bas ou racheté plus haut) ;
// - risque = |entrée prévue - stop| (stop tapé, sinon celui du broker ;
//   entrée tapée, sinon l'effective) ; rPrevu et rReel en R, deux décimales ;
// - les montants restent dans leur devise : aucune conversion, et des positions
//   en deux devises ne s'additionnent pas (pnl et frais à null) ;
// - une position sans `fuseau` porte l'heure affichée stockée comme de l'UTC :
//   son délai d'entrée est marqué `heureIncertaine`.

import {
  derniersJugements, emotionAuDepart, segmentsLus,
  type CauseCarnet, type IssueCarnet, type JugementCarnet, type NoteDuCarnet, type PeriodeCarnet,
} from './carnet-sur-positions'
import { nettoyerInstrument, nettoyerPrix } from './prix-carnet'
import { positionDe, type Execution, type VuePosition } from './positions'

export type Sens = 1 | -1

/** Ce que le membre a tapé dans le Carnet. */
export interface Prevu {
  entree: number | null
  stop: number | null
  tp: number | null
  taille: number | null
  sortie: number | null
  partiels: { prix: number; taille: number | null }[]
  /** |tp - entrée| / |entrée - stop|, les trois tapés ; null sinon. */
  rPrevu: number | null
}

/** Ce que le broker a exécuté : les positions liées au trade du Carnet (les copies comprises). */
export interface Effectif {
  /** Les positions liées, de la plus ancienne entrée à la plus récente. */
  positions: VuePosition[]
  /** Moyennes pondérées par la quantité, sur toutes les positions liées. */
  entree: number | null
  sortie: number | null
  /** La taille d'UN compte : celle de la première position (les copies ne s'additionnent pas). */
  taille: number | null
  /** Somme des positions quand elles sont dans une seule devise, sinon null. */
  pnl: number | null
  devise: string | null
  frais: number | null
  /** Le premier stop exporté par le broker, sinon null. */
  stop: number | null
  /** De la première entrée à la dernière sortie ; null si une position est encore ouverte. */
  dureeSec: number | null
  executions: number
  /** Le nombre de comptes (compte Pilotage et compte du broker) qui portent le trade. */
  comptes: number
  /**
   * Les exécutions de la PREMIÈRE position (un compte, comme `taille` : les
   * copies ont les mêmes), dans l'ordre de leur sortie : chacune porte son prix
   * d'entrée et son prix de sortie, d'où les sorties partielles (brief J2,
   * l'échelle de la fiche). Vide quand l'appelant n'a pas fourni les exécutions.
   */
  sorties: SortieBroker[]
}

/** Une exécution du broker (un aller-retour apparié par la plateforme). */
export interface SortieBroker {
  entree: number | null
  /** null tant que l'exécution est ouverte. */
  prix: number | null
  quantite: number
  /** Instant ISO de la sortie, null si ouverte. */
  le: string | null
}

/** Ce qu'il faut d'une exécution pour lire les sorties d'une position. */
export type ExecutionSortie = Pick<Execution, 'id' | 'positionId' | 'prixEntree' | 'prixSortie' | 'quantite' | 'sortiLe'>

export type SortieVsPlan = 'tp' | 'avant-tp' | 'stop' | 'avant-stop' | 'au-dela-stop'

export interface Ecarts {
  /** (entrée effective - entrée prévue) x sens, POSITIF = moins bon. */
  entree: number | null
  /** (sortie prévue - sortie effective) x sens, POSITIF = moins bon. */
  sortie: number | null
  /** Taille effective - taille prévue. */
  taille: number | null
  /** Le risque en prix qui sert d'unité (voir l'en-tête). */
  risque: number | null
  /** (sortie effective - entrée effective) x sens / risque. */
  rReel: number | null
  sortieVsPlan: SortieVsPlan | null
  /** Entrée de la première position - début du trade dans le Carnet, en minutes (une décimale). */
  delaiEntreeMin: number | null
  /** Une position liée sans fuseau : son heure est l'heure affichée stockée comme de l'UTC. */
  heureIncertaine: boolean
}

export interface TradeSynthese {
  segmentId: string
  noteId: string
  noteTitle: string | null
  /** Sa place dans Note.trades, à partir de 1 (« Trade 2 » sur le badge de la note). */
  ordre: number
  /** Tapé dans le Carnet, sinon le symbole du broker de la première position liée. */
  instrument: string | null
  /** Instants ISO. */
  startedAt: string
  closedAt: string | null
  outcome: IssueCarnet | null
  r: number | null
  prevu: Prevu
  effectif: Effectif | null
  ecarts: Ecarts | null
  ressenti: { emotionDepart: number | null; emotion: string | null; erreur: string | null; lecon: string | null }
  jugement: { grade: string; phrase: string | null; cause: CauseCarnet | null } | null
  captures: { url: string; messageId: string }[]
}

export interface ResumeSynthese {
  /** Trades du Carnet de la période. */
  trades: number
  /** Trades du Carnet liés à au moins une position du broker. */
  lies: number
  prevusSansBroker: number
  /** Positions du broker de la période sans trade du Carnet. */
  brokerSansNote: number
  /** Positions liées aux trades de la période (les copies comptent chacune). */
  positionsLiees: number
  /** Moyenne des écarts d'entrée EN R (écart / risque), comparable entre instruments ; null sans donnée. */
  ecartEntreeMoyen: number | null
  /** Moyenne des écarts d'entrée en prix, par instrument (on ne moyenne pas des points de NQ et d'EURUSD). */
  ecartEntreeParInstrument: { instrument: string; n: number; moyenne: number }[]
  /** Sorties avant le TP ou avant le stop. */
  sortiesAvantPlan: number
  sorties: { tp: number; avantTp: number; stop: number; avantStop: number; auDelaStop: number; sansPlan: number }
  heuresIncertaines: number
}

export interface Synthese {
  trades: TradeSynthese[]
  positionsSansNote: VuePosition[]
  resume: ResumeSynthese
}

type Objet = Record<string, unknown>
const objet = (x: unknown): Objet | null => (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Objet) : null)
const fini = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const nombre = (x: unknown) => (fini(x) ? x : null)
const texte = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null)
const estCause = (c: unknown): c is CauseCarnet => c === 'technique' || c === 'connaissance' || c === 'emotionnel'
const estIssue = (o: unknown): o is IssueCarnet => o === 'gain' || o === 'perte' || o === 'be'
// Les sommes de flottants laissent des traînes (0.1 + 0.2) : coupées à 1e-8, comme positions.ts.
const arrondi = (x: number) => Math.round(x * 1e8) / 1e8
const enR = (x: number) => Math.round(x * 100) / 100
// Une sortie « au stop » ou « au TP » à un dixième du risque près ; 1e-9 pour les flottants.
const EPS = 1e-9

const JOUR_MS = 86_400_000

/**
 * Une borne de période : null si absente, NaN si illisible. Date seule
 * (« 2026-10-01 ») ou instant ISO ; `fin` : la borne (exclue) qui suit, le jour
 * donné compris. Comme GET /api/pilotage/trades/positions.
 */
export function lireBorne(brut: string | null, fin: boolean): number | null {
  if (!brut) return null
  const jourSeul = /^\d{4}-\d{2}-\d{2}$/.test(brut)
  const t = Date.parse(jourSeul ? `${brut}T00:00:00Z` : brut)
  if (Number.isNaN(t)) return NaN
  return fin ? t + (jourSeul ? JOUR_MS : 1) : t
}

/** |tp - entrée| / |entrée - stop| ; null s'il manque l'un des trois ou si le risque est nul. */
export function calculerRPrevu(entree: number | null, stop: number | null, tp: number | null): number | null {
  if (entree === null || stop === null || tp === null) return null
  const risque = Math.abs(entree - stop)
  return risque > 0 ? enR(Math.abs(tp - entree) / risque) : null
}

/** Le prévu d'un segment de Note.trades (prix nettoyés comme à l'écriture). */
export function lirePrevu(segment: unknown): Prevu {
  const p = nettoyerPrix(objet(segment)?.prix) ?? {}
  const entree = nombre(p.entree)
  const stop = nombre(p.stop)
  const tp = nombre(p.tp)
  return {
    entree, stop, tp,
    taille: nombre(p.taille),
    sortie: nombre(p.sortie),
    partiels: (p.partiels ?? []).map(q => ({ prix: q.prix, taille: q.taille ?? null })),
    rPrevu: calculerRPrevu(entree, stop, tp),
  }
}

/** Le sens : la direction de la position, sinon le stop par rapport à l'entrée, sinon null. */
export function sensDuTrade(direction: string | null | undefined, entree: number | null, stop: number | null): Sens | null {
  if (direction === 'long') return 1
  if (direction === 'short') return -1
  if (entree !== null && stop !== null && stop !== entree) return stop < entree ? 1 : -1
  return null
}

/** Moyenne pondérée par la quantité, sur les positions qui ont ce prix. */
function ponderee(positions: VuePosition[], champ: 'prixEntree' | 'prixSortie'): number | null {
  let somme = 0, poids = 0
  for (const p of positions) {
    const prix = p[champ]
    if (prix === null) continue
    somme += prix * p.quantite
    poids += p.quantite
  }
  return poids > 0 ? arrondi(somme / poids) : null
}

const parEntree = (a: VuePosition, b: VuePosition) =>
  (a.entreLe < b.entreLe ? -1 : a.entreLe > b.entreLe ? 1 : 0) || (a.positionId < b.positionId ? -1 : a.positionId > b.positionId ? 1 : 0)

/**
 * Les sorties d'une position : ses exécutions, de la première sortie à la
 * dernière (les ouvertes à la fin), à égalité par id. Aucune exécution
 * fournie = liste vide.
 */
export function sortiesDeLaPosition(positionId: string, executions: readonly ExecutionSortie[]): SortieBroker[] {
  const instant = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY)
  return executions
    .filter(e => positionDe(e) === positionId)
    .sort((a, b) => instant(a.sortiLe) - instant(b.sortiLe) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(e => ({ entree: e.prixEntree, prix: e.prixSortie, quantite: e.quantite, le: e.sortiLe ? e.sortiLe.toISOString() : null }))
}

/**
 * L'effectif des positions liées à un trade du Carnet ; null sans position.
 * @param executions les exécutions du membre (ou au moins celles de ces
 *   positions), pour les sorties partielles ; sans elles, `sorties` est vide.
 */
export function effectifDesPositions(liees: VuePosition[], executions: readonly ExecutionSortie[] = []): Effectif | null {
  if (liees.length === 0) return null
  const positions = [...liees].sort(parEntree)
  const devises = new Set(positions.map(p => p.devise))
  const devise = devises.size === 1 ? positions[0].devise : null
  const avecFrais = positions.filter(p => p.frais !== null)
  const ouverte = positions.some(p => p.sortiLe === null)
  const debut = Math.min(...positions.map(p => Date.parse(p.entreLe)))
  const fin = ouverte ? NaN : Math.max(...positions.map(p => Date.parse(p.sortiLe!)))
  return {
    positions,
    entree: ponderee(positions, 'prixEntree'),
    sortie: ponderee(positions, 'prixSortie'),
    taille: positions[0].quantite,
    pnl: devise ? arrondi(positions.reduce((s, p) => s + p.pnl, 0)) : null,
    devise,
    frais: devise && avecFrais.length > 0 ? arrondi(avecFrais.reduce((s, p) => s + (p.frais ?? 0), 0)) : null,
    stop: positions.find(p => p.stopPrix !== null)?.stopPrix ?? null,
    dureeSec: Number.isFinite(fin) && Number.isFinite(debut) ? Math.round((fin - debut) / 1000) : null,
    executions: positions.reduce((s, p) => s + p.executions, 0),
    comptes: new Set(positions.map(p => JSON.stringify([p.compteId, p.compte]))).size,
    sorties: sortiesDeLaPosition(positions[0].positionId, executions),
  }
}

/**
 * Où la sortie est tombée par rapport au plan, à un dixième du risque près
 * (sans stop : un dixième de la distance au TP). Dans l'ordre : au stop
 * ('stop'), pire que le stop ('au-dela-stop'), au TP ou au-delà ('tp'), en
 * gain avant le TP ('avant-tp', TP connu), sinon avant le stop ('avant-stop',
 * stop connu ; un BE, sortie au prix d'entrée, y tombe). null sans stop ni TP,
 * sans sens ou sans prix.
 */
export function sortieVsPlan(o: {
  sens: Sens | null; entree: number | null; sortie: number | null; stop: number | null; tp: number | null; entreePrevue?: number | null
}): SortieVsPlan | null {
  const { sens, entree, sortie, stop, tp } = o
  if (sens === null || entree === null || sortie === null) return null
  if (stop === null && tp === null) return null
  const base = o.entreePrevue ?? entree
  const tolerance = (stop !== null ? Math.abs(base - stop) : Math.abs(tp! - base)) / 10 + EPS
  if (stop !== null && Math.abs(sortie - stop) <= tolerance) return 'stop'
  if (stop !== null && (sortie - stop) * sens < -tolerance) return 'au-dela-stop'
  if (tp !== null && (sortie - tp) * sens >= -tolerance) return 'tp'
  if ((sortie - entree) * sens > 0) return tp !== null ? 'avant-tp' : null
  return stop !== null ? 'avant-stop' : null
}

/** Les écarts entre le prévu et l'effectif. */
export function ecartsDuTrade(prevu: Prevu, effectif: Effectif, startedAt: number): Ecarts {
  const premiere = effectif.positions[0]
  const stop = prevu.stop ?? effectif.stop
  const entreeRef = prevu.entree ?? effectif.entree
  const sens = sensDuTrade(premiere.direction, entreeRef, stop)
  const risque = entreeRef !== null && stop !== null && Math.abs(entreeRef - stop) > 0 ? arrondi(Math.abs(entreeRef - stop)) : null
  const { entree, sortie } = effectif
  const entreeMs = Date.parse(premiere.entreLe)
  return {
    entree: sens !== null && prevu.entree !== null && entree !== null ? arrondi((entree - prevu.entree) * sens) : null,
    sortie: sens !== null && prevu.sortie !== null && sortie !== null ? arrondi((prevu.sortie - sortie) * sens) : null,
    taille: prevu.taille !== null && effectif.taille !== null ? arrondi(effectif.taille - prevu.taille) : null,
    risque,
    rReel: sens !== null && risque !== null && entree !== null && sortie !== null ? enR(((sortie - entree) * sens) / risque) : null,
    sortieVsPlan: sortieVsPlan({ sens, entree, sortie, stop, tp: prevu.tp, entreePrevue: prevu.entree }),
    delaiEntreeMin: Number.isFinite(entreeMs) ? Math.round((entreeMs - startedAt) / 6000) / 10 : null,
    heureIncertaine: effectif.positions.some(p => !p.fuseau),
  }
}

/** L'adresse d'une capture (bloc image du Carnet) : une URL http(s) nue ou dans une balise <img>, sinon null (data: écartées). */
export function urlDeCapture(contenu: string): string | null {
  const s = contenu.trim()
  const img = /<img[^>]*src=["']([^"']+)["']/i.exec(s)
  const url = (img ? img[1] : s).trim()
  return /^https?:\/\/\S+$/i.test(url) ? url : null
}

export interface EntreeSynthese {
  /** Les notes du membre (non supprimées) : trades et warmups en JSON. */
  notes: NoteDuCarnet[]
  /** TOUTES les positions du membre (une position liée hors période reste liée). */
  positions: VuePosition[]
  /** Les jugements des segments, dans n'importe quel ordre (le plus récent gagne). */
  jugements: JugementCarnet[]
  /** Les blocs image des notes rattachés à un segment, dans l'ordre de la note. */
  captures: { messageId: string; tradeRef: string | null; contenu: string }[]
  periode: PeriodeCarnet
  /** Les exécutions du membre, pour les sorties partielles (Effectif.sorties) ; absentes = sorties vides. */
  executions?: readonly ExecutionSortie[]
}

/**
 * La synthèse de la période : un trade par segment du Carnet dont le
 * startedAt tombe dans [depuis, jusqu[ (du plus récent au plus ancien), les
 * positions du broker entrées dans la période sans trade du Carnet (sans lien,
 * ou liées à un segment disparu), et le résumé.
 */
export function synthetiser({ notes, positions, jugements, captures, periode, executions = [] }: EntreeSynthese): Synthese {
  const segments = segmentsLus(notes)
  const dans = (t: number) => (periode.depuis === null || t >= periode.depuis) && (periode.jusqu === null || t < periode.jusqu)
  const liees = new Map<string, VuePosition[]>()
  for (const p of positions) {
    if (!p.segmentRef || !segments.has(p.segmentRef)) continue
    const l = liees.get(p.segmentRef)
    if (l) l.push(p)
    else liees.set(p.segmentRef, [p])
  }
  // Les exécutions rangées par position : chaque trade ne lit que les siennes.
  const parPosition = new Map<string, ExecutionSortie[]>()
  for (const e of executions) {
    const l = parPosition.get(positionDe(e))
    if (l) l.push(e)
    else parPosition.set(positionDe(e), [e])
  }
  const executionsDe = (ps: VuePosition[]) => ps.flatMap(p => parPosition.get(p.positionId) ?? [])
  const derniers = derniersJugements(jugements)
  const images = new Map<string, { url: string; messageId: string }[]>()
  for (const c of captures) {
    const url = c.tradeRef ? urlDeCapture(c.contenu) : null
    if (!url || !c.tradeRef) continue
    const l = images.get(c.tradeRef)
    if (l) l.push({ url, messageId: c.messageId })
    else images.set(c.tradeRef, [{ url, messageId: c.messageId }])
  }

  const trades: TradeSynthese[] = []
  for (const s of segments.values()) {
    if (!dans(s.startedAt)) continue
    const prevu = lirePrevu(s.segment)
    const lieesIci = liees.get(s.segmentRef) ?? []
    const effectif = effectifDesPositions(lieesIci, executionsDe(lieesIci))
    const cooldown = objet(s.segment.cooldown) ?? {}
    const closedAt = nombre(s.segment.closedAt)
    const j = derniers.get(s.segmentRef)
    trades.push({
      segmentId: s.segmentRef,
      noteId: s.noteId,
      noteTitle: s.noteTitle,
      ordre: s.ordre,
      instrument: nettoyerInstrument(s.segment.instrument) ?? effectif?.positions[0].symbole ?? null,
      startedAt: new Date(s.startedAt).toISOString(),
      closedAt: closedAt !== null && Number.isFinite(new Date(closedAt).getTime()) ? new Date(closedAt).toISOString() : null,
      outcome: estIssue(s.segment.outcome) ? s.segment.outcome : null,
      r: nombre(s.segment.r),
      prevu,
      effectif,
      ecarts: effectif ? ecartsDuTrade(prevu, effectif, s.startedAt) : null,
      ressenti: {
        emotionDepart: emotionAuDepart(s.warmups, s.startedAt),
        emotion: texte(cooldown.emotion),
        erreur: texte(cooldown.error),
        lecon: texte(cooldown.lesson),
      },
      jugement: j ? { grade: j.grade, phrase: texte(j.phrase), cause: estCause(j.causeCategory) ? j.causeCategory : null } : null,
      captures: images.get(s.segmentRef) ?? [],
    })
  }
  trades.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0) || (a.segmentId < b.segmentId ? -1 : 1))

  const positionsSansNote = positions.filter(p => dans(Date.parse(p.entreLe)) && !(p.segmentRef && segments.has(p.segmentRef)))
  return { trades, positionsSansNote, resume: resumer(trades, positionsSansNote.length) }
}

function resumer(trades: TradeSynthese[], brokerSansNote: number): ResumeSynthese {
  const sorties = { tp: 0, avantTp: 0, stop: 0, avantStop: 0, auDelaStop: 0, sansPlan: 0 }
  const enRisque: number[] = []
  const parInstrument = new Map<string, number[]>()
  let lies = 0, positionsLiees = 0, heuresIncertaines = 0
  for (const t of trades) {
    if (!t.effectif || !t.ecarts) continue
    lies++
    positionsLiees += t.effectif.positions.length
    if (t.ecarts.heureIncertaine) heuresIncertaines++
    const v = t.ecarts.sortieVsPlan
    if (v === 'tp') sorties.tp++
    else if (v === 'avant-tp') sorties.avantTp++
    else if (v === 'stop') sorties.stop++
    else if (v === 'avant-stop') sorties.avantStop++
    else if (v === 'au-dela-stop') sorties.auDelaStop++
    else sorties.sansPlan++
    const e = t.ecarts.entree
    if (e === null) continue
    if (t.ecarts.risque !== null) enRisque.push(e / t.ecarts.risque)
    const cle = t.instrument ?? '?'
    const l = parInstrument.get(cle)
    if (l) l.push(e)
    else parInstrument.set(cle, [e])
  }
  const moyenne = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  return {
    trades: trades.length,
    lies,
    prevusSansBroker: trades.length - lies,
    brokerSansNote,
    positionsLiees,
    ecartEntreeMoyen: enRisque.length > 0 ? enR(moyenne(enRisque)) : null,
    ecartEntreeParInstrument: [...parInstrument.entries()]
      .map(([instrument, xs]) => ({ instrument, n: xs.length, moyenne: arrondi(moyenne(xs)) }))
      .sort((a, b) => b.n - a.n || a.instrument.localeCompare(b.instrument)),
    sortiesAvantPlan: sorties.avantTp + sorties.avantStop,
    sorties,
    heuresIncertaines,
  }
}
