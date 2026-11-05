// L'écran « Mes trades » du Journal (brief J2, 05/11/2026) : ce que les trois
// vues, la fiche d'un trade et le curseur tirent de la synthèse
// (GET /api/trades/synthese, synthese-trades-pur.ts). Période, mots des
// pastilles, jours du calendrier, chiffres des six panneaux, sorties prévues
// face aux sorties du broker, phrases des écarts, étalement des libellés de
// l'échelle.
//
// Module PUR (n'importe que des modules purs) : scripts/verifier-mes-trades.mjs
// le charge tel quel. Les nombres s'écrivent à la française avec une espace
// simple entre les milliers (pas d'espace insécable).

import { sensDuTrade, type Sens, type SortieVsPlan, type Synthese, type TradeSynthese } from './synthese-trades-pur'
import type { VuePosition } from './positions'

// -- La période ---------------------------------------------------------------

export type Periode = 'mois' | '3mois' | 'tout'

export const PERIODES: { cle: Periode; libelle: string }[] = [
  { cle: 'mois', libelle: 'Ce mois' },
  { cle: '3mois', libelle: '3 mois' },
  { cle: 'tout', libelle: 'Tout' },
]

export const estPeriode = (x: unknown): x is Periode => x === 'mois' || x === '3mois' || x === 'tout'

/** Le début de la période, à minuit HEURE LOCALE : le 1er du mois (Ce mois), le 1er du mois d'il y a deux mois (3 mois), rien (Tout). */
export function debutPeriode(p: Periode, maintenant: Date): Date | null {
  if (p === 'tout') return null
  return new Date(maintenant.getFullYear(), maintenant.getMonth() - (p === 'mois' ? 0 : 2), 1)
}

/** L'adresse de la synthèse pour une période : un instant ISO (minuit local), pas de borne de fin. */
export function urlSynthese(p: Periode, maintenant: Date): string {
  const debut = debutPeriode(p, maintenant)
  return debut ? `/api/trades/synthese?depuis=${encodeURIComponent(debut.toISOString())}` : '/api/trades/synthese'
}

// -- Les nombres --------------------------------------------------------------

// Intl met une espace insécable fine entre les milliers : une espace simple à la place.
const ESPACES = /[\u00a0\u202f]/g

/** « 20 100 », « 20 100,25 », « 20 120,50 », « 1,08523 » : deux décimales au moins dès qu'il y en a, cinq au plus. */
export function formatNombre(x: number): string {
  const net = Math.round(Math.abs(x) * 1e8) / 1e8
  const s = net.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(net) ? 0 : 2, maximumFractionDigits: 5 }).replace(ESPACES, ' ')
  return x < 0 && net !== 0 ? `-${s}` : s
}

export const formatPrix = formatNombre

/** Une distance en points, sans signe : « 0,25 pt », « 1,50 pt », « 9 pts » (pluriel à partir de 2). */
export function formatPts(x: number): string {
  const a = Math.abs(x)
  return `${formatNombre(a)} ${a >= 2 ? 'pts' : 'pt'}`
}

/** Avec son signe : « +0,25 pt », « -9 pts », « 0 pt ». */
export function formatPtsSigne(x: number): string {
  const net = Math.round(x * 1e8) / 1e8
  return `${net > 0 ? '+' : net < 0 ? '-' : ''}${formatPts(net)}`
}

/** Un R à une décimale : « 2,0 », « 1,3 », « -1,0 ». */
export function formatR(x: number): string {
  const r = Math.round(x * 10) / 10
  const s = Math.abs(r).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return r < 0 ? `-${s}` : s
}

/** Un R signé, comme sur le curseur : « +1,3 R », « -1,0 R », « 0,0 R ». */
export function formatRSigne(x: number): string {
  const r = Math.round(x * 10) / 10
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}${formatR(Math.abs(r))} R`
}

/** « 1re », « 2e », « 3e ». */
export const ordinal = (n: number) => (n === 1 ? '1re' : `${n}e`)

// -- Les dates ----------------------------------------------------------------

const deux = (n: number) => String(n).padStart(2, '0')

/**
 * Le jour (AAAA-MM-JJ) d'un instant, à l'heure locale. `heureAffichee` : une
 * position sans fuseau porte l'heure affichée par le broker stockée comme de
 * l'UTC, elle se lit donc telle quelle (composantes UTC).
 */
export function jourDe(iso: string, heureAffichee = false): string {
  const d = new Date(iso)
  return heureAffichee
    ? `${d.getUTCFullYear()}-${deux(d.getUTCMonth() + 1)}-${deux(d.getUTCDate())}`
    : `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`
}

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
const JOURS_LONGS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
export const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** « mar. 03/11 » (long : « mardi 03/11 »), à l'heure locale ou affichée (voir jourDe). */
export function dateCourte(iso: string, heureAffichee = false, long = false): string {
  const d = new Date(iso)
  const [j, m, s] = heureAffichee ? [d.getUTCDate(), d.getUTCMonth(), d.getUTCDay()] : [d.getDate(), d.getMonth(), d.getDay()]
  return `${(long ? JOURS_LONGS : JOURS)[s]} ${deux(j)}/${deux(m + 1)}`
}

/** Un jour AAAA-MM-JJ en court : « mar. 03/11 ». */
export function libelleJour(jour: string): string {
  const [a, m, j] = jour.split('-').map(Number)
  const d = new Date(a, m - 1, j)
  return `${JOURS[d.getDay()]} ${deux(j)}/${deux(m)}`
}

/** « 09:40 », à l'heure locale ou affichée. */
export function heureDe(iso: string, heureAffichee = false): string {
  const d = new Date(iso)
  return heureAffichee ? `${deux(d.getUTCHours())}:${deux(d.getUTCMinutes())}` : `${deux(d.getHours())}:${deux(d.getMinutes())}`
}

// -- Le sens et la pastille ---------------------------------------------------

/** Le sens : la direction du broker, sinon le stop face à l'entrée, sinon le TP face à l'entrée. */
export function sensDe(t: TradeSynthese): Sens | null {
  const entree = t.prevu.entree ?? t.effectif?.entree ?? null
  const s = sensDuTrade(t.effectif?.positions[0]?.direction, entree, t.prevu.stop ?? t.effectif?.stop ?? null)
  if (s !== null) return s
  if (entree !== null && t.prevu.tp !== null && t.prevu.tp !== entree) return t.prevu.tp > entree ? 1 : -1
  return null
}

export const libelleSens = (s: Sens | null) => (s === 1 ? 'long' : s === -1 ? 'short' : null)

export type Ton = 'vert' | 'ambre' | 'rouge' | 'neutre' | 'gris'
export interface Pastille { texte: string; ton: Ton }

export const PASTILLE_SANS_NOTE: Pastille = { texte: 'Pas de note', ton: 'gris' }

/** La pastille d'un trade : où sa sortie est tombée par rapport au plan, en mots simples. */
export function pastilleDuTrade(t: TradeSynthese): Pastille {
  const e = t.effectif
  if (!e) return { texte: 'Pas de trade du broker', ton: 'gris' }
  if (e.sortie === null) return { texte: 'Encore ouvert', ton: 'neutre' }
  const stop = t.prevu.stop ?? e.stop
  switch (t.ecarts?.sortieVsPlan ?? null) {
    case 'tp': return { texte: 'Comme prévu', ton: 'vert' }
    case 'avant-tp': return { texte: 'Sortie avant ton TP', ton: 'ambre' }
    case 'stop': return { texte: 'Au stop, comme prévu', ton: 'neutre' }
    case 'avant-stop': return { texte: 'Coupé avant ton stop', ton: 'ambre' }
    case 'au-dela-stop': return { texte: stop !== null ? `Stop dépassé de ${formatPts(e.sortie - stop)}` : 'Stop dépassé', ton: 'rouge' }
  }
  const sens = sensDe(t)
  const entree = e.entree
  if (t.prevu.tp === null && sens !== null && entree !== null && (e.sortie - entree) * sens > 0) return { texte: 'En gain, sans TP', ton: 'vert' }
  return { texte: 'Sans stop ni TP', ton: 'gris' }
}

// -- Les éléments : trades du Carnet et positions du broker sans note ---------

export type Element =
  | { type: 'trade'; cle: string; instant: number; trade: TradeSynthese }
  | { type: 'position'; cle: string; instant: number; position: VuePosition }

export const elementTrade = (t: TradeSynthese): Element => ({ type: 'trade', cle: `t:${t.segmentId}`, instant: Date.parse(t.startedAt), trade: t })
export const elementPosition = (p: VuePosition): Element => ({ type: 'position', cle: `p:${p.positionId}`, instant: Date.parse(p.entreLe), position: p })

/** Du plus récent au plus ancien, à égalité par clé (l'ordre ne dépend pas de la lecture). */
export const parInstant = (a: Element, b: Element) => b.instant - a.instant || (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0)

/** Tous les éléments de la synthèse : ses trades et ses positions sans note, du plus récent au plus ancien. */
export function elementsDe(s: Synthese): Element[] {
  return [...s.trades.map(elementTrade), ...s.positionsSansNote.map(elementPosition)].sort(parInstant)
}

/** Le jour d'un élément (une position sans fuseau se lit à l'heure affichée). */
export const jourElement = (e: Element) => (e.type === 'trade' ? jourDe(e.trade.startedAt) : jourDe(e.position.entreLe, !e.position.fuseau))

// -- Le calendrier ------------------------------------------------------------

/** Le point d'un élément : lié au broker (vert), noté sans broker (ambre), broker sans note (gris). */
export type Point = 'lie' | 'sans' | 'broker'
export const pointDe = (e: Element): Point => (e.type === 'position' ? 'broker' : e.trade.effectif ? 'lie' : 'sans')

/** Les éléments rangés par jour (AAAA-MM-JJ), chaque jour dans l'ordre de la journée. */
export function parJour(elements: Element[]): Map<string, Element[]> {
  const jours = new Map<string, Element[]>()
  for (const e of [...elements].sort((a, b) => a.instant - b.instant || (a.cle < b.cle ? -1 : 1))) {
    const j = jourElement(e)
    const l = jours.get(j)
    if (l) l.push(e)
    else jours.set(j, [e])
  }
  return jours
}

/**
 * Les semaines d'un mois, du lundi au vendredi (au dimanche avec
 * `weekend`) : AAAA-MM-JJ, ou null pour un jour hors du mois. Une semaine dont
 * aucun jour rendu n'est dans le mois n'apparaît pas.
 */
export function semainesDuMois(annee: number, mois0: number, weekend = false): (string | null)[][] {
  const premier = new Date(annee, mois0, 1)
  const lundi = new Date(annee, mois0, 1 - ((premier.getDay() + 6) % 7))
  const largeur = weekend ? 7 : 5
  const semaines: (string | null)[][] = []
  for (let d = lundi; d.getFullYear() < annee || (d.getFullYear() === annee && d.getMonth() <= mois0); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)) {
    const semaine: (string | null)[] = []
    for (let i = 0; i < largeur; i++) {
      const j = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i)
      semaine.push(j.getMonth() === mois0 && j.getFullYear() === annee ? `${annee}-${deux(mois0 + 1)}-${deux(j.getDate())}` : null)
    }
    if (semaine.some(x => x !== null)) semaines.push(semaine)
  }
  return semaines
}

/** Le jour choisi par défaut (labo 2, vues 4) : le dernier jour de la période qui a des trades, null s'il n'y en a pas. */
export function dernierJourAvecTrades(elements: Element[]): string | null {
  let dernier: string | null = null
  for (const e of elements) {
    const j = jourElement(e)
    if (dernier === null || j > dernier) dernier = j
  }
  return dernier
}

/** Un jour AAAA-MM-JJ tombe-t-il un samedi ou un dimanche ? */
export function estWeekend(jour: string): boolean {
  const [a, m, j] = jour.split('-').map(Number)
  const s = new Date(a, m - 1, j).getDay()
  return s === 0 || s === 6
}

export interface Mois { annee: number; mois: number }

/**
 * Les mois que le calendrier peut montrer pour une période, du plus ancien au
 * plus récent : le mois en cours (Ce mois), les trois derniers (3 mois), du
 * mois du plus ancien élément au mois en cours (Tout).
 */
export function moisDeLaPeriode(p: Periode, maintenant: Date, plusAncienJour: string | null): Mois[] {
  const fin = { annee: maintenant.getFullYear(), mois: maintenant.getMonth() }
  let debut = fin
  if (p === '3mois') {
    const d = new Date(fin.annee, fin.mois - 2, 1)
    debut = { annee: d.getFullYear(), mois: d.getMonth() }
  } else if (p === 'tout' && plusAncienJour) {
    const [a, m] = plusAncienJour.split('-').map(Number)
    if (a < fin.annee || (a === fin.annee && m - 1 < fin.mois)) debut = { annee: a, mois: m - 1 }
  }
  const liste: Mois[] = []
  for (let d = new Date(debut.annee, debut.mois, 1); d <= new Date(fin.annee, fin.mois, 1); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    liste.push({ annee: d.getFullYear(), mois: d.getMonth() })
  }
  return liste
}

// -- Les six panneaux et leurs listes -----------------------------------------

export interface ChiffresPanneaux {
  /** Trades du Carnet liés au broker, sur les trades notés. */
  lies: { n: number; sur: number }
  /** L'écart d'entrée moyen de l'instrument le plus tradé (en prix, positif = moins bon), et combien d'autres instruments. */
  entree: { moyenne: number | null; instrument: string | null; n: number; autres: number }
  /** Sorties avant le TP ou avant le stop, sur les trades liés. */
  avantPlan: { n: number; sur: number }
  /** R prévu et R réel moyens, sur les trades qui ont les deux. */
  r: { prevu: number | null; reel: number | null; n: number }
  sansBroker: number
  sansNote: number
}

const moyenne = (xs: number[]) => (xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

/** Une moyenne d'écarts à afficher : deux décimales (0,17 pt), cinq pour les petits prix du forex (0,00012). */
export const arrondiEcart = (x: number) => (Math.abs(x) >= 0.01 ? Math.round(x * 100) / 100 : Math.round(x * 1e5) / 1e5)

export function chiffresPanneaux(s: Synthese): ChiffresPanneaux {
  const premier = s.resume.ecartEntreeParInstrument[0]
  const deuxR = s.trades.filter(t => t.prevu.rPrevu !== null && t.ecarts?.rReel != null)
  return {
    lies: { n: s.resume.lies, sur: s.resume.trades },
    entree: {
      moyenne: premier ? arrondiEcart(premier.moyenne) : null,
      instrument: premier && premier.instrument !== '?' ? premier.instrument : null,
      n: premier ? premier.n : 0,
      autres: Math.max(0, s.resume.ecartEntreeParInstrument.length - 1),
    },
    avantPlan: { n: s.resume.sortiesAvantPlan, sur: s.resume.lies },
    r: {
      prevu: moyenne(deuxR.map(t => t.prevu.rPrevu as number)),
      reel: moyenne(deuxR.map(t => t.ecarts!.rReel as number)),
      n: deuxR.length,
    },
    sansBroker: s.resume.prevusSansBroker,
    sansNote: s.resume.brokerSansNote,
  }
}

export type CleListe = 'lies' | 'entree' | 'avant-plan' | 'r' | 'sans-broker' | 'sans-note'

export const TITRES_LISTES: Record<CleListe, string> = {
  'lies': 'Trades liés au broker',
  'entree': 'Ton entrée',
  'avant-plan': 'Sorties avant ton plan',
  'r': 'R prévu, R réel',
  'sans-broker': 'Notés sans trade du broker',
  'sans-note': 'Trades du broker sans note',
}

/** Le mot court de chaque panneau dans le bandeau de pastilles (labo 2, vues 4). */
export const COURTS_LISTES: Record<CleListe, string> = {
  'lies': 'Liés au broker',
  'entree': 'Ton entrée',
  'avant-plan': 'Avant ton plan',
  'r': 'R prévu, réel',
  'sans-broker': 'Sans broker',
  'sans-note': 'Sans note',
}

// hasOwnProperty, pas `in` : « ?liste=toString » ne doit pas passer pour un panneau.
export const estCleListe = (x: unknown): x is CleListe => typeof x === 'string' && Object.prototype.hasOwnProperty.call(TITRES_LISTES, x)

/** La liste qu'ouvre un panneau, du plus récent au plus ancien. */
export function elementsDeLaListe(cle: CleListe, s: Synthese): Element[] {
  if (cle === 'sans-note') return s.positionsSansNote.map(elementPosition).sort(parInstant)
  const garde: Record<Exclude<CleListe, 'sans-note'>, (t: TradeSynthese) => boolean> = {
    'lies': t => t.effectif !== null,
    'entree': t => t.ecarts?.entree != null,
    'avant-plan': t => t.ecarts?.sortieVsPlan === 'avant-tp' || t.ecarts?.sortieVsPlan === 'avant-stop',
    'r': t => t.ecarts?.rReel != null,
    'sans-broker': t => t.effectif === null,
  }
  return s.trades.filter(garde[cle]).map(elementTrade).sort(parInstant)
}

// -- Les sorties : prévues face au broker -------------------------------------

export interface SortiePrevue { prix: number; taille: number | null; estTp: boolean }

/**
 * Les sorties prévues : les partiels tapés (le TP compris s'il y est), sinon la
 * sortie tapée, sinon le TP ; la plus proche de l'entrée d'abord (dans le sens
 * du trade ; sens inconnu = prix croissants).
 */
export function sortiesPrevues(t: TradeSynthese, sens: Sens | null): SortiePrevue[] {
  const { partiels, sortie, tp, taille } = t.prevu
  const brutes = partiels.length > 0
    ? partiels.map(p => ({ prix: p.prix, taille: p.taille }))
    : sortie !== null ? [{ prix: sortie, taille }] : tp !== null ? [{ prix: tp, taille }] : []
  return brutes
    .map(p => ({ ...p, estTp: tp !== null && Math.abs(p.prix - tp) < 1e-9 }))
    .sort((a, b) => (a.prix - b.prix) * (sens ?? 1))
}

/** Les sorties du broker d'un compte, dans l'ordre ; à défaut la sortie moyenne. */
export function sortiesEffectives(t: TradeSynthese): { prix: number; quantite: number | null }[] {
  const e = t.effectif
  if (!e) return []
  const fermees = e.sorties.filter(x => x.prix !== null).map(x => ({ prix: x.prix as number, quantite: x.quantite }))
  if (fermees.length > 0) return fermees
  return e.sortie !== null ? [{ prix: e.sortie, quantite: e.taille }] : []
}

export type Qualite = 'mieux' | 'moins' | 'egal'

/** Effectif face au prévu : mieux (long vendu plus haut, short racheté plus bas, ou entrée payée moins cher), moins bien, ou égal. */
export function qualite(ecartBrut: number, sens: Sens | null, cote: 'entree' | 'sortie'): Qualite | null {
  if (Math.abs(ecartBrut) < 1e-9) return 'egal'
  if (sens === null) return null
  const oriente = ecartBrut * sens * (cote === 'entree' ? -1 : 1)
  return oriente > 0 ? 'mieux' : 'moins'
}

export interface LigneSortie {
  libelle: string
  /** La sortie prévue en face ; `estStop` quand le trade est sorti au stop ou au-delà. */
  prevu: (SortiePrevue & { estStop?: boolean }) | null
  effectif: number | null
  /** Effectif - prévu, en prix (le signe brut ; la qualité dit si c'est mieux). */
  ecart: number | null
  qualite: Qualite | null
  /** L'écart tient dans un dixième du risque : rien à signaler. */
  proche: boolean
  /** Ce que la dernière sortie dit du plan : « avant ton TP », « stop dépassé »... ; null sinon. */
  suite: string | null
}

const SUITE: Partial<Record<SortieVsPlan, string>> = {
  'avant-tp': 'avant ton TP',
  'avant-stop': 'avant ton stop',
  'stop': 'au stop',
  'au-dela-stop': 'stop dépassé',
}

/**
 * Une ligne par sortie : la n-ième prévue face à la n-ième du broker. Sorti au
 * stop, avant ou au-delà : la dernière sortie du broker se compare au STOP
 * (le TP n'a pas été joué), les précédentes aux partiels dans l'ordre.
 */
export function lignesDeSortie(t: TradeSynthese, sens: Sens | null): LigneSortie[] {
  const prevues: LigneSortie['prevu'][] = sortiesPrevues(t, sens)
  const faites = sortiesEffectives(t)
  const vs = t.ecarts?.sortieVsPlan ?? null
  const stop = t.prevu.stop ?? t.effectif?.stop ?? null
  const auStop = (vs === 'stop' || vs === 'avant-stop' || vs === 'au-dela-stop') && stop !== null && faites.length > 0
  if (auStop) {
    prevues.splice(faites.length - 1, prevues.length, { prix: stop, taille: null, estTp: false, estStop: true })
  }
  const risque = t.ecarts?.risque ?? null
  const n = Math.max(prevues.length, faites.length)
  const lignes: LigneSortie[] = []
  for (let i = 0; i < n; i++) {
    const p = prevues[i] ?? null
    const f = faites[i]?.prix ?? null
    const ecart = p && f !== null ? Math.round((f - p.prix) * 1e8) / 1e8 : null
    const proche = ecart !== null && risque !== null && Math.abs(ecart) <= risque / 10 + 1e-9
    const derniere = i === faites.length - 1
    lignes.push({
      libelle: n === 1 ? 'Sortie' : `${ordinal(i + 1)} sortie`,
      prevu: p, effectif: f, ecart,
      qualite: ecart === null ? null : qualite(ecart, sens, 'sortie'),
      proche,
      suite: derniere && ecart !== null && !proche && vs ? SUITE[vs] ?? null : null,
    })
  }
  return lignes
}

// -- Les quatre écarts de la fiche, en une ligne chacun -----------------------

/**
 * L'entrée : « +0,25 pt, comme prévu » (à un dixième du risque ; le signe est
 * celui du prix, effectif moins prévu, comme dans le tableau du détail),
 * « 3 pts plus loin que prévu », « 1 pt mieux que prévu » (sans signe : les mots
 * disent le sens, long comme short).
 */
export function texteEntree(t: TradeSynthese): string | null {
  const e = t.ecarts?.entree ?? null
  const faite = t.effectif?.entree ?? null
  const prevue = t.prevu.entree
  if (e === null || faite === null || prevue === null) {
    if (faite !== null) return prevue === null ? `${formatPrix(faite)}, pas de prix prévu` : null
    return prevue !== null ? `${formatPrix(prevue)} prévu` : null
  }
  const risque = t.ecarts?.risque ?? null
  if (Math.abs(e) < 1e-9) return 'Pile à ton prix'
  if (risque !== null && Math.abs(e) <= risque / 10 + 1e-9) return `${formatPtsSigne(faite - prevue)}, comme prévu`
  return e > 0 ? `${formatPts(e)} plus loin que prévu` : `${formatPts(e)} mieux que prévu`
}

/** La sortie, d'après sortieVsPlan et la dernière sortie du broker. */
export function texteSortie(t: TradeSynthese): string {
  const e = t.effectif
  if (!e) return 'Pas de trade du broker'
  if (e.sortie === null) return 'Encore ouvert'
  const faites = sortiesEffectives(t)
  const derniere = faites.length > 0 ? faites[faites.length - 1].prix : e.sortie
  const stop = t.prevu.stop ?? e.stop
  const tp = t.prevu.tp
  switch (t.ecarts?.sortieVsPlan ?? null) {
    case 'tp': return 'Au TP, comme prévu'
    case 'stop': return 'Au stop, comme prévu'
    case 'avant-tp': {
      const d = tp !== null ? formatPts(tp - derniere) : null
      if (!d) return 'Avant ton TP'
      return faites.length > 1 ? `${ordinal(faites.length)} partiel ${d} avant ton TP` : `${d} avant ton TP`
    }
    case 'avant-stop': return stop !== null ? `Coupée ${formatPts(e.sortie - stop)} avant ton stop` : 'Coupée avant ton stop'
    case 'au-dela-stop': return stop !== null ? `Stop dépassé de ${formatPts(e.sortie - stop)}` : 'Stop dépassé'
  }
  return `${formatPrix(e.sortie)}, sans stop ni TP pour comparer`
}

/** La taille : « 2, comme prévu (x3 comptes) », « 3 au lieu de 2 ». */
export function texteTaille(t: TradeSynthese): string | null {
  const prevue = t.prevu.taille
  const faite = t.effectif?.taille ?? null
  const comptes = t.effectif && t.effectif.comptes > 1 ? ` (x${t.effectif.comptes} comptes)` : ''
  if (prevue !== null && faite !== null) {
    return Math.abs(faite - prevue) < 1e-9 ? `${formatNombre(faite)}, comme prévu${comptes}` : `${formatNombre(faite)} au lieu de ${formatNombre(prevue)}${comptes}`
  }
  if (faite !== null) return `${formatNombre(faite)}${comptes}`
  if (prevue !== null) return `${formatNombre(prevue)} prévu`
  return null
}

/** Le R : « 2,0 prévu, 1,3 réel ». */
export function texteR(t: TradeSynthese): string | null {
  const prevu = t.prevu.rPrevu
  const reel = t.ecarts?.rReel ?? null
  if (prevu !== null && reel !== null) return `${formatR(prevu)} prévu, ${formatR(reel)} réel`
  if (prevu !== null) return `${formatR(prevu)} prévu`
  if (reel !== null) return `${formatR(reel)} réel`
  if (t.prevu.stop === null && (t.effectif?.stop ?? null) === null) return 'Pas de stop, donc pas de R'
  return null
}

// -- Le curseur de la file (labo 2, curseur 2 : le chemin du stop au TP) -----

export interface GeometrieCurseur {
  /** Positions en % de la largeur : stop à 8, TP à 92, entrée entre les deux selon le R prévu. */
  stop: number
  entree: number
  tp: number
  /** Les sorties partielles prévues (hors TP). */
  partiels: number[]
  /** Les sorties du broker, dans l'ordre ; la dernière est la plus grosse. */
  sorties: number[]
  /** Le R obtenu, affiché au-dessus de la dernière sortie. */
  rObtenu: number
  gain: boolean
  /** Le trajet coloré, de l'entrée à la dernière sortie (jusqu'au stop quand il est dépassé). */
  trajet: { de: number; a: number }
  /** Un stop dépassé : la sortie hors de la piste, à gauche du stop (pointillés rouges). */
  deborde: { de: number; a: number } | null
  /** Où poser la valeur (gardée dans [7, 93] %). */
  val: number
}

/**
 * Le chemin du stop au TP, tout en R du risque prévu (un short se lit comme un
 * long) : stop à 8 %, TP à 92 %, entrée à 8 + 84 / (1 + rPrevu) %, chaque
 * prix à entrée + r x 84 / (1 + rPrevu), gardé dans [1,5, 98,5]. null quand il
 * manque le plan (entrée, stop ou TP, ou un TP du mauvais côté) ou la sortie du
 * broker : la piste reste alors vide, en pointillés.
 * @param rReel le R du trade (sorties moyennes) ; à défaut, celui de la dernière sortie.
 */
export function geometrieCurseur(o: {
  sens: Sens | null; entree: number | null; stop: number | null; tp: number | null
  sorties: number[]; partiels: number[]; rReel?: number | null
}): GeometrieCurseur | null {
  const { entree, stop, tp } = o
  if (entree === null || stop === null || tp === null || o.sorties.length === 0) return null
  const risque = Math.abs(entree - stop)
  if (!(risque > 0)) return null
  const sens = o.sens ?? (stop < entree ? 1 : -1)
  const enR = (p: number) => ((p - entree) * sens) / risque
  const rPrevu = enR(tp)
  if (!(rPrevu > 0)) return null
  const u = 84 / (1 + rPrevu)
  const pc = (r: number) => Math.max(1.5, Math.min(98.5, 8 + u + r * u))
  const rs = o.sorties.map(enR)
  const fin = rs[rs.length - 1]
  const rObtenu = o.rReel ?? fin
  const x = pc(fin)
  const s = pc(-1)
  const e = pc(0)
  return {
    stop: s, entree: e, tp: pc(rPrevu),
    partiels: o.partiels.map(p => pc(enR(p))),
    sorties: rs.map(pc),
    rObtenu,
    gain: rObtenu >= 0,
    trajet: fin < -1 ? { de: s, a: e } : { de: Math.min(e, x), a: Math.max(e, x) },
    deborde: fin < -1 ? { de: x, a: s } : null,
    val: Math.max(7, Math.min(93, x)),
  }
}

// -- L'échelle des prix -------------------------------------------------------

/** Le domaine de l'échelle : du plus bas au plus haut des prix, avec une marge de 12 % (1 % du prix si tout est au même prix). */
export function domaineEchelle(prix: number[]): [number, number] | null {
  const xs = prix.filter(x => Number.isFinite(x))
  if (xs.length === 0) return null
  const bas = Math.min(...xs)
  const haut = Math.max(...xs)
  const marge = haut > bas ? (haut - bas) * 0.12 : Math.abs(haut) * 0.01 || 1
  return [bas - marge, haut + marge]
}

/**
 * Étale des positions verticales pour que deux libellés gardent au moins
 * `ecart` entre eux, sans sortir de [min, max] ; rend les positions dans
 * l'ordre reçu. Les positions déjà assez écartées ne bougent pas.
 */
export function etalerLibelles(ys: number[], ecart: number, min: number, max: number): number[] {
  const ordre = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i)
  const pos = ordre.map(o => Math.min(max, Math.max(min, o.y)))
  for (let k = 1; k < pos.length; k++) pos[k] = Math.max(pos[k], pos[k - 1] + ecart)
  if (pos.length > 0 && pos[pos.length - 1] > max) {
    pos[pos.length - 1] = max
    for (let k = pos.length - 2; k >= 0; k--) pos[k] = Math.min(pos[k], pos[k + 1] - ecart)
  }
  const rendu = new Array<number>(ys.length)
  ordre.forEach((o, k) => { rendu[o.i] = pos[k] })
  return rendu
}
