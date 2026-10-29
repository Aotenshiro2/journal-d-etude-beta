// Import des trades depuis les fichiers des plateformes — porte DÉTERMINISTE
// (go Brice 08/09/2026). Un format = un parseur, reconnu à la signature de ses
// en-têtes ; rien ne passe par l'IA ici, rien n'est inventé, et ce qui ne se
// lit pas proprement est rejeté ligne par ligne avec sa raison.
//
// v1 : Tradovate « Performance.csv » — le format en or, une ligne = un trade
// déjà apparié (buyFillId/sellFillId, prix des deux jambes, pnl, horodatages).
// v2 (brief A, 29/10/2026) : table Trades de TopstepX (« trades_export.csv »,
// horodatages avec décalage), et le CSV GÉNÉRIQUE dont le membre désigne les
// colonnes (sans désignation : on rend les en-têtes et une proposition).
// v3 (brief D3, 30/10/2026) : Quantower, des exécutions et des ordres appariés
// en trades (premier entré, premier sorti) : l'export d'exécutions (Gross P/L
// par exécution, quatre séparateurs) et l'historique d'ordres (ordres Filled,
// résultat calculé avec la valeur du point du contrat).
//
// Ce module n'importe rien : scripts/verifier-imports-trades.mjs et
// scripts/verifier-documents.mjs le chargent tel quel.

export interface TradeNormalise {
  source: string
  idExterne: string
  compte: string | null
  symbole: string
  direction: 'long' | 'short' | null
  /** Contrats, unités ou lots : décimal permis (CFD : 0,5 lot). */
  quantite: number
  prixEntree: number | null
  prixSortie: number | null
  entreLe: Date
  sortiLe: Date | null
  pnl: number
  devise: string
  frais: number | null
  dureeSec: number | null
  /** Décalage lu dans le fichier (« +02:00 ») : entreLe est alors un vrai
   *  instant UTC. Absent ou null : heure telle qu'affichée (Tradovate), que
   *  appliquerFuseau (fuseau.ts) ramène à un instant si le membre donne son
   *  fuseau IANA, écrit alors ici. */
  fuseau?: string | null
  /** null = le fichier ne dit pas s'il y avait un stop. */
  stopPrix?: number | null
}

export interface ResultatParse {
  format: string | null
  trades: TradeNormalise[]
  erreurs: string[]
  /** CSV générique : les en-têtes trouvés (doublons renommés « Time (2) »). */
  entetes?: string[]
  /** CSV générique sans `colonnes` : une correspondance devinée au nom des colonnes. */
  proposition?: Partial<ColonnesCsv>
  /** Le compte commun aux lignes quand elles portent plusieurs sous-comptes (Quantower : « XX-000001 »). */
  compte?: string | null
  /** Ce que la lecture a fait sans que ce soit une erreur (ordres annulés ignorés, exécutions appariées...). */
  remarques?: string[]
}

/** Les colonnes d'un CSV inconnu, désignées par le membre (nom d'en-tête par champ). */
export interface ColonnesCsv {
  symbole: string
  entreLe: string
  sortiLe?: string
  direction?: string
  quantite?: string
  prixEntree?: string
  prixSortie?: string
  pnl: string
  frais?: string
  idExterne?: string
  stopPrix?: string
  /** « DD/MM/YYYY » ou « MM/DD/YYYY » (« JJ/MM/AAAA » accepté) : lève
   *  l'ambiguïté jour/mois des dates à barres. Inutile pour l'ISO. */
  formatDate?: string
  /** Code de la monnaie du fichier (« EUR ») ; USD par défaut. */
  devise?: string
}

/** Découpe une ligne CSV en gérant les champs entre guillemets ("$1,195.00"). */
function decouperLigneCsv(ligne: string, sep = ','): string[] {
  const champs: string[] = []
  let courant = ''
  let entreGuillemets = false
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i]
    if (entreGuillemets) {
      if (c === '"' && ligne[i + 1] === '"') { courant += '"'; i++ }
      else if (c === '"') entreGuillemets = false
      else courant += c
    } else if (c === '"') {
      entreGuillemets = true
    } else if (c === sep) {
      champs.push(courant)
      courant = ''
    } else {
      courant += c
    }
  }
  champs.push(courant)
  return champs.map(x => x.trim())
}

/** "$465.00" → 465 ; "$(3.10)" → -3.10 ; "-$753.60" → -753.60 ; "1 195,00" → 1195. */
function lireMontant(brut: string): number | null {
  if (!brut) return null
  let s = brut.trim()
  let negatif = false
  if (/^\(.*\)$/.test(s)) { negatif = true; s = s.slice(1, -1) }
  if (s.startsWith('-')) { negatif = true; s = s.slice(1) }
  s = s.replace(/[$€£\s ]/g, '')
  if (/^\(.*\)$/.test(s)) { negatif = true; s = s.slice(1, -1) }
  // « 1,195.00 » (US) vs « 1195,00 » (FR) : si point ET virgule, la virgule
  // est un séparateur de milliers ; sinon une virgule seule est décimale.
  if (s.includes('.') && s.includes(',')) s = s.replace(/,/g, '')
  else s = s.replace(',', '.')
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negatif ? -n : n
}

/** « MM/DD/YYYY HH:mm:ss » (export Tradovate, fuseau de la plateforme).
 *  On construit la date telle quelle, sans conversion de fuseau : c'est
 *  l'heure que le trader a vue à l'écran. */
function lireDateUs(brut: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(brut.trim())
  if (!m) return null
  const [, mois, jour, annee, h, min, sec] = m
  const d = new Date(Date.UTC(+annee, +mois - 1, +jour, +h, +min, +sec))
  return Number.isNaN(d.getTime()) ? null : d
}

/** « 2min 54sec » / « 1h 5min » → secondes. */
function lireDuree(brut: string): number | null {
  if (!brut) return null
  let total = 0
  const h = /(\d+)\s*h/.exec(brut)
  const min = /(\d+)\s*min/.exec(brut)
  const sec = /(\d+)\s*sec/.exec(brut)
  if (h) total += +h[1] * 3600
  if (min) total += +min[1] * 60
  if (sec) total += +sec[1]
  return h || min || sec ? total : null
}

const ENTETES_TRADOVATE = ['symbol', 'buyFillId', 'sellFillId', 'qty', 'buyPrice', 'sellPrice', 'pnl', 'boughtTimestamp', 'soldTimestamp']

const ENTETES_TOPSTEPX = ['Id', 'ContractName', 'EnteredAt', 'ExitedAt', 'EntryPrice', 'ExitPrice', 'Fees', 'PnL', 'Size', 'Type']

/**
 * Reconnaît le format à la signature des en-têtes et parse.
 * @param colonnes Désignation des colonnes d'un CSV inconnu. Ignorée quand la
 *   signature d'un format connu est reconnue : le lecteur dédié est plus juste,
 *   et le même fichier garde ainsi toujours la même source (dédoublonnage).
 */
export function parserFichierTrades(texte: string, fichier?: string, colonnes?: Partial<ColonnesCsv>): ResultatParse {
  const lignes = texte.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lignes.length === 0) return { format: null, trades: [], erreurs: ['Fichier vide.'] }

  const entetes = decouperLigneCsv(lignes[0])
  if (ENTETES_TRADOVATE.every(e => entetes.includes(e))) {
    return parserTradovatePerformance(lignes, entetes, fichier)
  }

  // Les autres lecteurs suivent le séparateur du fichier (« ; » d'un Excel français).
  const sep = separateurDe(lignes[0])
  const entetesSep = sep === ',' ? entetes : decouperLigneCsv(lignes[0], sep)
  if (ENTETES_TOPSTEPX.every(e => entetesSep.includes(e))) {
    return parserTopstepX(lignes, entetesSep, sep)
  }

  // Quantower (brief D3) : l'historique d'ordres (les ordres Filled appariés),
  // puis l'export d'exécutions, quel que soit le séparateur choisi à l'export.
  const ordres = separateurAvecEntetes(lignes[0], ENTETES_ORDRES_QUANTOWER)
  if (ordres) return parserOrdresQuantower(lignes, ordres.entetes, ordres.sep)
  const executions = separateurAvecEntetes(lignes[0], ENTETES_EXECUTIONS_QUANTOWER)
  if (executions) return parserExecutionsQuantower(lignes, executions.entetes, executions.sep)
  // Un historique d'ordres auquel il manque des colonnes : reconnu, pas lisible.
  if (entetesSep.includes('Order type') && entetesSep.includes('Average fill price')) {
    return { format: 'quantower-orders', trades: [], erreurs: [MESSAGE_ORDRES_SANS_TRADE] }
  }

  return parserCsvGenerique(lignes, sep, colonnes)
}

/**
 * L'empreinte d'un trade : symbole, instant d'entrée, quantité, P&L. C'est la
 * clé du rapport Performance de Tradovate quand les ids de fills manquent, et
 * celle des trades lus dans un PDF, un HTML ou une image (brief D1,
 * 30/10/2026) : le même rapport en CSV et en PDF se reconnaît par elle
 * (trades-envoyes.ts, connusParEmpreinte).
 */
export function empreinteTrade(t: { symbole: string; entreLe: Date; quantite: number; pnl: number }): string {
  return `${t.symbole}-${t.entreLe.toISOString()}-${t.quantite}-${t.pnl}`
}

/** Les trades dont la clé (idExterne) n'est pas déjà connue. Réimporter le
 *  même fichier = 0 nouveau, par construction. */
export function separerNouveaux<T extends { idExterne: string }>(trades: T[], connus: Set<string>): T[] {
  return trades.filter(t => !connus.has(t.idExterne))
}

/** Le body.colonnes d'une requête, réduit aux champs connus (chaînes non vides). */
export function lireColonnes(brut: unknown): Partial<ColonnesCsv> | undefined {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return undefined
  const sortie: Partial<Record<keyof ColonnesCsv, string>> = {}
  for (const champ of [...CHAMPS_CSV, 'formatDate', 'devise'] as (keyof ColonnesCsv)[]) {
    const v = (brut as Record<string, unknown>)[champ]
    if (typeof v === 'string' && v.trim()) sortie[champ] = v.trim().slice(0, 200)
  }
  return sortie
}

/** Le séparateur le plus présent dans la ligne d'en-têtes (virgule à égalité). */
function separateurDe(ligne: string): string {
  const compte = (c: string) => ligne.split(c).length - 1
  const candidats: [string, number][] = [[',', compte(',')], [';', compte(';')], ['\t', compte('\t')]]
  candidats.sort((a, b) => b[1] - a[1])
  return candidats[0][1] > 0 ? candidats[0][0] : ','
}

/** Quantité positive, décimale permise (« 3 », « 0,5 », « 1.5 Lots », « 1,000 » = mille) ; null si illisible ou nulle. */
function lireQuantite(brut: string): number | null {
  const s = brut.trim().replace(/\s*(lots?|units?|unités?|contracts?|contrats?)$/i, '')
  const n = /^[1-9]\d{0,2}(,\d{3})+$/.test(s) ? Number(s.replace(/,/g, '')) : lireMontant(s)
  if (n === null || !Number.isFinite(n)) return null
  const q = Math.abs(n)
  return q > 0 ? q : null
}

// ── Horodatages ──────────────────────────────────────────────────────────────

/** Pour les dates à barres : le jour d'abord (« 21/04/2025 ») ou le mois (« 04/21/2025 »). */
type OrdreDate = 'jour' | 'mois'

interface Horodatage { date: Date; fuseau: string | null }

// ISO et assimilés, année d'abord (« 2025-06-06T17:25:45Z », « 2025.06.06 17:25 » de MT5).
const RE_ISO = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})[T ]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?$/i
// Année à la fin (« 06/06/2025 17:25:45 +02:00 », « 6/6/2025 5:25 PM »).
const RE_BARRES = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})[T ]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(AM|PM)?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?$/i

/**
 * Un horodatage avec heure (la date seule ne suffit pas à regrouper des
 * exécutions). Avec un décalage (« +02:00 », « Z ») : le vrai instant UTC, et
 * le décalage normalisé dans `fuseau`. Sans : l'heure telle qu'affichée,
 * construite comme pour Tradovate, `fuseau` null.
 */
function lireHorodatage(brut: string, ordre: OrdreDate | null): Horodatage | null {
  const s = brut.trim()
  let annee: string, mois: string, jour: string, h: string, min: string
  let sec: string | undefined, frac: string | undefined, ampm: string | undefined, decalage: string | undefined
  const iso = RE_ISO.exec(s)
  if (iso) {
    [, annee, mois, jour, h, min, sec, frac, decalage] = iso
  } else {
    const b = RE_BARRES.exec(s)
    if (!b || !ordre) return null
    let premier: string, second: string
    ;[, premier, second, annee, h, min, sec, frac, ampm, decalage] = b
    jour = ordre === 'jour' ? premier : second
    mois = ordre === 'jour' ? second : premier
  }

  let heure = +h
  if (ampm) {
    if (heure < 1 || heure > 12) return null
    heure = (heure % 12) + (ampm.toUpperCase() === 'PM' ? 12 : 0)
  }
  if (heure > 23 || +min > 59 || +(sec ?? 0) > 59) return null
  const ms = frac ? Number(frac.slice(0, 3).padEnd(3, '0')) : 0
  const local = Date.UTC(+annee, +mois - 1, +jour, heure, +min, +(sec ?? 0), ms)
  const verif = new Date(local)
  // Le 31/02 « passe » en JavaScript (il devient le 3 mars) : on le refuse.
  if (Number.isNaN(local) || verif.getUTCMonth() !== +mois - 1 || verif.getUTCDate() !== +jour) return null

  if (!decalage) return { date: verif, fuseau: null }
  if (/^(Z|UTC|GMT)$/i.test(decalage)) return { date: verif, fuseau: '+00:00' }
  const d = /^([+-])(\d{2}):?(\d{2})$/.exec(decalage)!
  const minutes = (+d[2] * 60 + +d[3]) * (d[1] === '-' ? -1 : 1)
  if (Math.abs(minutes) > 14 * 60) return null
  return { date: new Date(local - minutes * 60_000), fuseau: `${d[1]}${d[2]}:${d[3]}` }
}

/**
 * L'ordre jour/mois des dates à barres d'un fichier. `formatDate` tranche ;
 * sinon les valeurs : un premier nombre > 12 dit « jour d'abord », un second
 * > 12 dit « mois d'abord ». Si rien ne tranche et qu'une date au moins se
 * lirait différemment (« 04/06 »), on ne devine pas : on demande.
 */
function ordreDesDates(valeurs: string[], formatDate?: string): { ordre: OrdreDate } | { erreur: string } {
  if (formatDate) {
    const f = formatDate.trim().toUpperCase()
    if (f.startsWith('DD') || f.startsWith('JJ')) return { ordre: 'jour' }
    if (f.startsWith('MM')) return { ordre: 'mois' }
    if (f.startsWith('YYYY') || f.startsWith('AAAA') || f === 'ISO') return { ordre: 'jour' }
    return { erreur: `formatDate « ${formatDate.slice(0, 40)} » inconnu : « DD/MM/YYYY » ou « MM/DD/YYYY ».` }
  }
  let jourDabord = false, moisDabord = false, ambigu = false
  for (const v of valeurs) {
    const b = RE_BARRES.exec(v.trim())
    if (!b) continue
    const a = +b[1], c = +b[2]
    if (a > 12) jourDabord = true
    if (c > 12) moisDabord = true
    if (a !== c && a <= 12 && c <= 12) ambigu = true
  }
  if (jourDabord && moisDabord) return { erreur: 'Dates incohérentes : le jour et le mois changent de place selon les lignes.' }
  if (jourDabord) return { ordre: 'jour' }
  if (moisDabord) return { ordre: 'mois' }
  if (ambigu) return { erreur: 'Dates ambiguës (jour et mois tous deux de 1 à 12) : précise formatDate, « DD/MM/YYYY » ou « MM/DD/YYYY ».' }
  return { ordre: 'jour' } // aucune date à barres, ou jour = mois partout : l'ordre ne change rien
}

/** « 00:02:08.2771580 » (TimeSpan .NET, « 1.02:03:04 » au-delà d'un jour), en secondes. */
function lireDureeHms(brut: string): number | null {
  const m = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(brut.trim())
  if (!m) return null
  const [, jours, h, min, sec, frac] = m
  return Math.round(+(jours ?? 0) * 86_400 + +h * 3600 + +min * 60 + +sec + (frac ? Number(`0.${frac}`) : 0))
}

// ── TopstepX ─────────────────────────────────────────────────────────────────

/**
 * Table Trades de TopstepX (« trades_export.csv ») : une ligne = un trade
 * apparié, Id unique, dates en MM/DD/YYYY avec le décalage du poste
 * (« 06/06/2025 17:25:45 +02:00 »), Type Long/Short, PnL brut et Fees à part.
 */
function parserTopstepX(lignes: string[], entetes: string[], sep: string): ResultatParse {
  const idx = (nom: string) => entetes.indexOf(nom)
  const trades: TradeNormalise[] = []
  const erreurs: string[] = []
  const vus = new Map<string, number>()

  for (let i = 1; i < lignes.length; i++) {
    const c = decouperLigneCsv(lignes[i], sep)
    const val = (nom: string) => (idx(nom) >= 0 ? c[idx(nom)] ?? '' : '')
    const id = val('Id')
    const symbole = val('ContractName')
    const entree = lireHorodatage(val('EnteredAt'), 'mois')
    const sortie = lireHorodatage(val('ExitedAt'), 'mois')
    const pnl = lireMontant(val('PnL'))
    const quantite = lireQuantite(val('Size'))
    const type = val('Type').toLowerCase()
    const direction = type === 'long' ? 'long' : type === 'short' ? 'short' : null

    const raisons: string[] = []
    if (!id) raisons.push('Id vide')
    if (!symbole) raisons.push('ContractName vide')
    if (!entree) raisons.push('EnteredAt illisible')
    if (!sortie) raisons.push('ExitedAt illisible')
    if (pnl === null) raisons.push('PnL illisible')
    if (quantite === null) raisons.push('Size illisible')
    if (!direction) raisons.push('Type ni Long ni Short')
    if (raisons.length > 0 || !entree || !sortie || pnl === null || quantite === null) {
      erreurs.push(`Ligne ${i + 1} illisible (${raisons.join(', ')}) : ignorée.`)
      continue
    }
    if (vus.has(id)) {
      erreurs.push(`Ligne ${i + 1} : même Id que la ligne ${vus.get(id)}, ignorée.`)
      continue
    }
    vus.set(id, i + 1)

    const frais = lireMontant(val('Fees'))
    trades.push({
      source: 'topstepx-trades',
      idExterne: id,
      compte: null,
      symbole,
      direction,
      quantite,
      prixEntree: lireMontant(val('EntryPrice')),
      prixSortie: lireMontant(val('ExitPrice')),
      entreLe: entree.date,
      sortiLe: sortie.date,
      pnl,
      devise: 'USD',
      frais: frais === null ? null : Math.abs(frais),
      dureeSec: lireDureeHms(val('TradeDuration')) ?? Math.round((sortie.date.getTime() - entree.date.getTime()) / 1000),
      fuseau: entree.fuseau,
      stopPrix: null,
    })
  }

  if (trades.length === 0 && erreurs.length === 0) erreurs.push('Aucun trade dans le fichier.')
  return { format: 'topstepx-trades', trades, erreurs }
}

// ── Quantower : exécutions et ordres appariés (brief D3, 30/10/2026) ─────────
//
// Les deux exports donnent des exécutions, pas des trades : une entrée, puis
// la sortie qui la ferme. On les apparie premier entré, premier sorti, par
// compte et par symbole (une exécution de sens opposé ferme les lots ouverts
// les plus anciens ; le surplus retourne la position). Un trade = une part
// d'entrée fermée par une part de sortie : les partiels en donnent plusieurs,
// que l'import regroupe en une position (positions.ts).

export const MESSAGE_ORDRES_SANS_TRADE = "Ce fichier est un historique d'ordres, pas de trades : exporte le rapport Performance de Tradovate, ou envoie-nous ton fichier au support pour qu'on l'ajoute."

const ENTETES_ORDRES_QUANTOWER = ['Account', 'Symbol', 'Side', 'Order type', 'Quantity', 'Status', 'Date/Time', 'Order ID', 'Average fill price', 'Qty. filled']
const ENTETES_EXECUTIONS_QUANTOWER = ['Account', 'Date/Time', 'Symbol', 'Side', 'Order type', 'Quantity', 'Price', 'Gross P/L', 'Position ID']

/** Les séparateurs proposés par l'export de Quantower : virgule, point-virgule, tabulation, espace. */
const SEPARATEURS_EXPORT = [',', ';', '\t', ' ']

/** Le séparateur avec lequel la ligne d'en-têtes porte toutes les colonnes demandées, ou null. */
function separateurAvecEntetes(ligne: string, requis: string[]): { sep: string; entetes: string[] } | null {
  for (const sep of SEPARATEURS_EXPORT) {
    const entetes = decouperLigneCsv(ligne, sep)
    if (requis.every(e => entetes.includes(e))) return { sep, entetes }
  }
  return null
}

/** « XX-F50K-000001-000002 XX-000001 (Prénom Nom) » : le compte (premier mot) et le compte commun (second), jamais le nom. */
function compteQuantower(brut: string): { compte: string; commun: string | null } {
  const [compte, commun] = brut.replace(/\([^)]*\)\s*$/, '').trim().split(/\s+/)
  return { compte: (compte ?? '').slice(0, 80), commun: commun ? commun.slice(0, 80) : null }
}

/** « MNQH5@CME » donne « MNQH5 » : le contrat sans sa place de cotation. */
const symboleSansPlace = (brut: string) => brut.trim().replace(/@[A-Za-z0-9_.-]+$/, '').slice(0, 40)

/** Une exécution lue (une ligne d'exécution, ou un ordre Filled). */
interface ExecutionLue {
  ligne: number
  compte: string
  symbole: string
  sens: 'long' | 'short'
  quantite: number
  prix: number
  quand: Horodatage
  /** Résultat réalisé écrit par le fichier (export d'exécutions) ; null quand il n'en donne pas (ordres). */
  resultat: number | null
  frais: number | null
  id: string | null
}

interface Paire { entree: ExecutionLue; sortie: ExecutionLue; quantite: number; pnl: number | null; frais: number | null }

const centimes = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const arrondiQ = (n: number) => Math.round(n * 1e8) / 1e8

/** `total` réparti selon `poids`, au centime, la dernière part prend le reste (la somme est exacte). */
function repartir(total: number, poids: number[]): number[] {
  const somme = poids.reduce((s, p) => s + p, 0)
  const parts = poids.map(p => (somme === 0 ? 0 : centimes((total * p) / somme)))
  if (parts.length > 0) parts[parts.length - 1] = centimes(total - parts.slice(0, -1).reduce((s, p) => s + p, 0))
  return parts
}

/**
 * Le résultat écrit d'une sortie qui ferme plusieurs lots : au prorata de
 * l'écart de prix de chaque lot (exact quand la valeur du point est la même,
 * c'est le cas d'un même contrat), sinon des quantités.
 */
function partsDuResultat(sortie: ExecutionLue, fermes: { lot: ExecutionLue; q: number }[]): (number | null)[] {
  if (sortie.resultat === null) return fermes.map(() => null)
  const parPrix = fermes.map(f => f.q * (sortie.prix - f.lot.prix) * (f.lot.sens === 'long' ? 1 : -1))
  const somme = parPrix.reduce((s, p) => s + p, 0)
  const prix = somme !== 0 && Math.sign(somme) === Math.sign(sortie.resultat)
  return repartir(sortie.resultat, prix ? parPrix : fermes.map(f => f.q))
}

const partFrais = (e: ExecutionLue, q: number) => (e.frais === null ? null : (e.frais * q) / e.quantite)

/**
 * Premier entré, premier sorti, par compte et symbole. Une exécution qui porte
 * un résultat alors qu'aucun lot de sens opposé n'est ouvert est une sortie
 * dont l'entrée précède le fichier : écartée (orphelines). Les lots encore
 * ouverts à la fin sont comptés (ouvertes) : la sortie manque au fichier.
 */
function apparierFifo(executions: ExecutionLue[]): { paires: Paire[]; ouvertes: number; orphelines: number } {
  // Ordre chronologique ; un export du plus récent au plus ancien est d'abord retourné (secondes égales).
  const premiere = executions[0]?.quand.date.getTime() ?? 0
  const derniere = executions[executions.length - 1]?.quand.date.getTime() ?? 0
  const sens = premiere > derniere ? [...executions].reverse() : executions
  const chrono = sens.map((e, i) => ({ e, i })).sort((a, b) => a.e.quand.date.getTime() - b.e.quand.date.getTime() || a.i - b.i).map(x => x.e)

  const lots = new Map<string, { e: ExecutionLue; reste: number }[]>()
  const paires: Paire[] = []
  let orphelines = 0
  for (const e of chrono) {
    const cle = JSON.stringify([e.compte, e.symbole])
    const file = lots.get(cle) ?? []
    lots.set(cle, file)
    if (file.length === 0 || file[0].e.sens === e.sens) {
      if (e.resultat !== null && e.resultat !== 0) { orphelines++; continue }
      file.push({ e, reste: e.quantite })
      continue
    }
    let reste = e.quantite
    const fermes: { lot: ExecutionLue; q: number }[] = []
    while (reste > 0 && file.length > 0) {
      const lot = file[0]
      const q = Math.min(reste, lot.reste)
      fermes.push({ lot: lot.e, q })
      lot.reste = arrondiQ(lot.reste - q)
      reste = arrondiQ(reste - q)
      if (lot.reste <= 0) file.shift()
    }
    const parts = partsDuResultat(e, fermes)
    fermes.forEach(({ lot, q }, k) => {
      const fe = partFrais(lot, q)
      const fs = partFrais(e, q)
      paires.push({ entree: lot, sortie: e, quantite: q, pnl: parts[k], frais: fe === null && fs === null ? null : centimes((fe ?? 0) + (fs ?? 0)) })
    })
    // Le surplus retourne la position : il ouvre un lot de l'autre sens (son résultat est celui de la part fermée).
    if (reste > 0) file.push({ e: { ...e, resultat: 0 }, reste })
  }
  let ouvertes = 0
  for (const file of lots.values()) ouvertes += file.length
  return { paires, ouvertes, orphelines }
}

/** Les remarques communes aux deux lecteurs Quantower. */
function remarquesFifo(o: { executions: number; trades: number; ouvertes: number; orphelines: number; comptes: number }): string[] {
  const pl = (n: number, s: string, p = `${s}s`) => `${n} ${n > 1 ? p : s}`
  return [
    `${pl(o.executions, 'exécution')} lue${o.executions > 1 ? 's' : ''}, appariée${o.executions > 1 ? 's' : ''} en ${pl(o.trades, 'trade')} (premier entré, premier sorti, par compte et symbole).`,
    o.ouvertes > 0 ? `${pl(o.ouvertes, 'entrée')} sans sortie dans le fichier (position encore ouverte, ou sortie après l'export) : non rendue${o.ouvertes > 1 ? 's' : ''}.` : '',
    o.orphelines > 0 ? `${pl(o.orphelines, 'sortie')} sans entrée dans le fichier (entrée avant l'export) : non rendue${o.orphelines > 1 ? 's' : ''}.` : '',
    o.comptes > 1 ? `Le fichier porte ${o.comptes} comptes.` : '',
  ].filter(Boolean)
}

const communUnique = (valeurs: (string | null)[]): string | null => {
  const set = new Set(valeurs.filter((v): v is string => !!v))
  return set.size === 1 ? [...set][0] : null
}

/**
 * Export d'exécutions de Quantower (Account, Date/Time, Symbol, Side, Order
 * type, Quantity, Price, Gross P/L, [Fee,] Net P/L, Position ID) : une ligne =
 * une exécution, le résultat écrit sur celle qui ferme. Le fichier n'a pas
 * d'identifiant d'exécution (Position ID = contrat et compte) : la clé est
 * l'empreinte de la paire (compte, symbole, entrée, sortie, quantité,
 * résultat), avec un rang quand deux paires identiques se suivent. Même
 * contenu en virgule, point-virgule, tabulation ou espaces = mêmes clés.
 * pnl = Gross P/L ; frais = Fee, sinon Gross P/L moins Net P/L.
 */
function parserExecutionsQuantower(lignes: string[], entetes: string[], sep: string): ResultatParse {
  const idx = (nom: string) => entetes.indexOf(nom)
  const cellules = lignes.slice(1).map(l => decouperLigneCsv(l, sep))
  const val = (c: string[], nom: string) => (idx(nom) >= 0 ? c[idx(nom)] ?? '' : '')
  const ordre = ordreDesDates(cellules.map(c => val(c, 'Date/Time')).filter(Boolean))
  if ('erreur' in ordre) return { format: 'quantower-executions', trades: [], erreurs: [ordre.erreur] }

  const erreurs: string[] = []
  const executions: ExecutionLue[] = []
  const communs: (string | null)[] = []
  cellules.forEach((c, k) => {
    const ligne = k + 2
    const { compte, commun } = compteQuantower(val(c, 'Account'))
    const symbole = symboleSansPlace(val(c, 'Symbol'))
    const sens = lireDirection(val(c, 'Side'))
    const quantite = lireQuantite(val(c, 'Quantity'))
    const prix = lireMontant(val(c, 'Price'))
    const quand = lireHorodatage(val(c, 'Date/Time'), ordre.ordre)
    const brut = lireMontant(val(c, 'Gross P/L') || '0')
    const raisons = [
      compte ? '' : 'Account vide', symbole ? '' : 'Symbol vide', sens === 'long' || sens === 'short' ? '' : 'Side ni Buy ni Sell',
      quantite === null ? 'Quantity illisible' : '', prix === null ? 'Price illisible' : '', quand ? '' : 'Date/Time illisible',
      brut === null ? 'Gross P/L illisible' : '',
    ].filter(Boolean)
    if (raisons.length > 0 || !quand || quantite === null || prix === null || brut === null || (sens !== 'long' && sens !== 'short')) {
      erreurs.push(`Ligne ${ligne} illisible (${raisons.join(', ')}) : ignorée.`)
      return
    }
    const fee = idx('Fee') >= 0 && val(c, 'Fee') ? lireMontant(val(c, 'Fee')) : null
    const net = idx('Net P/L') >= 0 && val(c, 'Net P/L') ? lireMontant(val(c, 'Net P/L')) : null
    const frais = fee !== null ? Math.abs(fee) : net !== null ? Math.abs(centimes(brut - net)) : null
    communs.push(commun)
    executions.push({ ligne, compte, symbole, sens, quantite, prix, quand, resultat: centimes(brut), frais, id: null })
  })

  const { paires, ouvertes, orphelines } = apparierFifo(executions)
  const trades: TradeNormalise[] = []
  const rangs = new Map<string, number>()
  let calcules = 0
  let sansResultat = 0
  for (const p of paires) {
    let pnl = p.pnl ?? 0
    // Une sortie à un autre prix que l'entrée, sans résultat ni frais écrits (une liquidation, mesuré sur
    // l'essai) : le résultat se calcule avec la valeur du point du contrat, comme pour les ordres.
    if (p.sortie.resultat === 0 && !p.sortie.frais && p.sortie.prix !== p.entree.prix) {
      const point = valeurDuPoint(p.entree.symbole)
      if (point === null) sansResultat++
      else { pnl = centimes((p.sortie.prix - p.entree.prix) * p.quantite * point * (p.entree.sens === 'long' ? 1 : -1)); calcules++ }
    }
    const cle = [p.entree.compte, p.entree.symbole, p.entree.quand.date.toISOString(), p.sortie.quand.date.toISOString(), p.quantite, pnl].join('|')
    const rang = (rangs.get(cle) ?? 0) + 1
    rangs.set(cle, rang)
    trades.push(tradeDeLaPaire(p, 'quantower-executions', rang === 1 ? cle : `${cle}#${rang}`, pnl))
  }
  if (trades.length === 0 && erreurs.length === 0) erreurs.push('Aucun trade dans le fichier : aucune entrée suivie de sa sortie.')
  return {
    format: 'quantower-executions', trades, erreurs, compte: communUnique(communs),
    remarques: [
      ...remarquesFifo({ executions: executions.length, trades: trades.length, ouvertes, orphelines, comptes: new Set(executions.map(e => e.compte)).size }),
      calcules > 0 ? `${calcules} trade${calcules > 1 ? 's' : ''} sans résultat écrit (sortie sans P/L ni frais, une liquidation ?) : résultat calculé avec la valeur du point du contrat.` : '',
      sansResultat > 0 ? `${sansResultat} trade${sansResultat > 1 ? 's' : ''} sans résultat écrit et sans valeur du point connue : résultat à 0, vérifie-le${sansResultat > 1 ? 's' : ''}.` : '',
    ].filter(Boolean),
  }
}

/**
 * Valeur d'un point (USD) des contrats à terme courants, par racine du
 * symbole (« MNQH5 » : MNQ). Les historiques d'ordres n'écrivent aucun
 * résultat : il se calcule (sortie - entrée) x quantité x valeur du point.
 */
const VALEUR_DU_POINT: Record<string, number> = {
  ES: 50, MES: 5, NQ: 20, MNQ: 2, YM: 5, MYM: 0.5, RTY: 50, M2K: 5, EMD: 100,
  CL: 1000, MCL: 100, QM: 500, NG: 10000, QG: 2500, RB: 42000, HO: 42000,
  GC: 100, MGC: 10, SI: 5000, SIL: 1000, HG: 25000, MHG: 2500, PL: 50, PA: 100,
  ZB: 1000, UB: 1000, ZN: 1000, ZF: 1000, ZT: 2000, ZC: 50, ZS: 50, ZW: 50, ZL: 600, ZM: 100,
  '6E': 125000, M6E: 12500, '6B': 62500, M6B: 6250, '6J': 12500000, '6A': 100000, M6A: 10000, '6C': 100000, '6S': 125000,
  BTC: 5, MBT: 0.1, ETH: 50, MET: 0.1,
}

/** « NQM5 », « MNQH25 » : la racine sans le mois ni l'année du contrat. */
export function racineContrat(symbole: string): string {
  const m = /^([A-Z0-9]{1,4}?)[FGHJKMNQUVXZ]\d{1,2}$/.exec(symbole.trim().toUpperCase())
  return m ? m[1] : symbole.trim().toUpperCase()
}

/**
 * La valeur du point d'un symbole : la table d'abord ; sinon, pour un contrat
 * que la plateforme connaît (Symbol type « Futures »), le rapport Order value /
 * (quantité x prix) des ordres du fichier, s'il est le même partout. Quantower
 * met 1 aux symboles qu'il ne connaît pas (« Unknown ») : jamais lu pour eux.
 */
export function valeurDuPoint(symbole: string, ordres: { type: string; valeur: number | null; quantite: number | null; prix: number | null }[] = []): number | null {
  const table = VALEUR_DU_POINT[racineContrat(symbole)]
  if (table !== undefined) return table
  const rapports = ordres
    .filter(o => /^futures?$/i.test(o.type.trim()) && o.valeur && o.quantite && o.prix)
    .map(o => Math.abs(o.valeur!) / (Math.abs(o.quantite!) * Math.abs(o.prix!)))
  if (rapports.length === 0) return null
  const min = Math.min(...rapports)
  const max = Math.max(...rapports)
  if (min <= 0 || max / min > 1.01) return null
  return Number(min.toPrecision(4))
}

function tradeDeLaPaire(p: Paire, source: string, idExterne: string, pnl: number): TradeNormalise {
  const entreLe = p.entree.quand.date
  const sortiLe = p.sortie.quand.date
  return {
    source,
    idExterne,
    compte: p.entree.compte,
    symbole: p.entree.symbole,
    direction: p.entree.sens,
    quantite: p.quantite,
    prixEntree: p.entree.prix,
    prixSortie: p.sortie.prix,
    entreLe,
    sortiLe,
    pnl,
    devise: 'USD',
    frais: p.frais,
    dureeSec: Math.round((sortiLe.getTime() - entreLe.getTime()) / 1000),
    fuseau: p.entree.quand.fuseau,
    stopPrix: null,
  }
}

/**
 * Historique d'ordres de Quantower (« Orders history.csv ») : seuls les ordres
 * Filled comptent (annulés et refusés ignorés), au prix moyen exécuté
 * (Average fill price) et à la quantité exécutée (Qty. filled). Appariés
 * premier entré, premier sorti ; clé = les identifiants des deux ordres
 * (« 1001-1002 ») ; résultat calculé avec la valeur du point (valeurDuPoint),
 * frais inconnus (null). Aucun trade rebâti : le message d'avant reste, en
 * tête des erreurs.
 */
function parserOrdresQuantower(lignes: string[], entetes: string[], sep: string): ResultatParse {
  const idx = (nom: string) => entetes.indexOf(nom)
  const cellules = lignes.slice(1).map(l => decouperLigneCsv(l, sep))
  const val = (c: string[], nom: string) => (idx(nom) >= 0 ? c[idx(nom)] ?? '' : '')
  const sansTrade = (erreurs: string[], remarques: string[] = []): ResultatParse => ({ format: 'quantower-orders', trades: [], erreurs: [MESSAGE_ORDRES_SANS_TRADE, ...erreurs], remarques })
  // L'échéance du contrat s'écrit comme les dates des ordres : elle aide à trancher jour ou mois d'abord.
  const ordre = ordreDesDates(cellules.flatMap(c => [val(c, 'Date/Time'), val(c, 'Expiration date')]).filter(Boolean))
  if ('erreur' in ordre) return sansTrade([ordre.erreur])

  const erreurs: string[] = []
  const executions: ExecutionLue[] = []
  const communs: (string | null)[] = []
  const parSymbole = new Map<string, { type: string; valeur: number | null; quantite: number | null; prix: number | null }[]>()
  let ignores = 0
  let partiels = 0
  cellules.forEach((c, k) => {
    const ligne = k + 2
    const symbole = symboleSansPlace(val(c, 'Symbol'))
    const liste = parSymbole.get(symbole) ?? []
    parSymbole.set(symbole, liste)
    liste.push({
      type: val(c, 'Symbol type'), valeur: lireMontant(val(c, 'Order value')), quantite: lireMontant(val(c, 'Quantity')),
      prix: lireMontant(val(c, 'Price')) ?? lireMontant(val(c, 'Trigger price')),
    })
    const execute = lireMontant(val(c, 'Qty. filled'))
    if (val(c, 'Status').trim().toLowerCase() !== 'filled') {
      ignores++
      if (execute !== null && execute !== 0) partiels++
      return
    }
    const { compte, commun } = compteQuantower(val(c, 'Account'))
    const sens = lireDirection(val(c, 'Side'))
    const quantite = execute === null ? null : Math.abs(execute) || null
    const prix = lireMontant(val(c, 'Average fill price'))
    const quand = lireHorodatage(val(c, 'Date/Time'), ordre.ordre)
    const id = val(c, 'Order ID').trim()
    const raisons = [
      compte ? '' : 'Account vide', symbole ? '' : 'Symbol vide', sens === 'long' || sens === 'short' ? '' : 'Side ni Buy ni Sell',
      quantite === null ? 'Qty. filled illisible' : '', prix === null ? 'Average fill price illisible' : '', quand ? '' : 'Date/Time illisible',
      id ? '' : 'Order ID vide',
    ].filter(Boolean)
    if (raisons.length > 0 || !quand || quantite === null || prix === null || (sens !== 'long' && sens !== 'short')) {
      erreurs.push(`Ligne ${ligne} illisible (${raisons.join(', ')}) : ignorée.`)
      return
    }
    communs.push(commun)
    executions.push({ ligne, compte, symbole, sens, quantite, prix, quand, resultat: null, frais: null, id })
  })

  const { paires, ouvertes, orphelines } = apparierFifo(executions)
  const trades: TradeNormalise[] = []
  const sansValeur = new Map<string, number>()
  const vus = new Map<string, number>()
  for (const p of paires) {
    const point = valeurDuPoint(p.entree.symbole, parSymbole.get(p.entree.symbole))
    if (point === null) { sansValeur.set(p.entree.symbole, (sansValeur.get(p.entree.symbole) ?? 0) + 1); continue }
    const pnl = centimes((p.sortie.prix - p.entree.prix) * p.quantite * point * (p.entree.sens === 'long' ? 1 : -1))
    const cle = `${p.entree.id}-${p.sortie.id}`
    const rang = (vus.get(cle) ?? 0) + 1
    vus.set(cle, rang)
    trades.push(tradeDeLaPaire(p, 'quantower-orders', rang === 1 ? cle : `${cle}#${rang}`, pnl))
  }
  for (const [symbole, n] of sansValeur) erreurs.push(`Valeur du point inconnue pour ${symbole} : ${n} trade${n > 1 ? 's' : ''} non rendu${n > 1 ? 's' : ''}.`)
  const remarques = [
    `${executions.length} ordre${executions.length > 1 ? 's' : ''} exécuté${executions.length > 1 ? 's' : ''} lu${executions.length > 1 ? 's' : ''}, ${ignores} annulé${ignores > 1 ? 's' : ''} ou refusé${ignores > 1 ? 's' : ''} ignoré${ignores > 1 ? 's' : ''}.`,
    partiels > 0 ? `${partiels} ordre${partiels > 1 ? 's' : ''} non Filled mais en partie exécuté${partiels > 1 ? 's' : ''} : non lu${partiels > 1 ? 's' : ''}, vérifie ces trades.` : '',
    ...remarquesFifo({ executions: executions.length, trades: trades.length, ouvertes, orphelines, comptes: new Set(executions.map(e => e.compte)).size }),
    trades.length > 0 ? 'Résultat calculé avec la valeur du point du contrat, frais non écrits dans le fichier.' : '',
  ].filter(Boolean)
  if (trades.length === 0) return sansTrade(erreurs, remarques)
  return { format: 'quantower-orders', trades, erreurs, compte: communUnique(communs), remarques }
}

// ── CSV générique ────────────────────────────────────────────────────────────

type ChampCsv =Exclude<keyof ColonnesCsv, 'formatDate' | 'devise'>

const CHAMPS_CSV: ChampCsv[] = [
  'symbole', 'entreLe', 'sortiLe', 'direction', 'quantite', 'prixEntree', 'prixSortie', 'pnl', 'frais', 'idExterne', 'stopPrix',
]
const CHAMPS_OBLIGATOIRES: ChampCsv[] = ['symbole', 'entreLe', 'pnl']

// Noms probables, comparés sans casse, accents ni ponctuation (« P&L » = « pl »).
// Ordre des champs = ordre d'attribution ; dans un champ, le premier nom l'emporte.
const NOMS_PROBABLES: [ChampCsv, string[]][] = [
  ['symbole', ['symbole', 'symbol', 'instrument', 'contractname', 'contract', 'contrat', 'ticker', 'market', 'marche', 'asset', 'actif', 'produit']],
  ['entreLe', ['entreele', 'enteredat', 'entrytime', 'entrydate', 'entrydatetime', 'opentime', 'opendate', 'opened', 'dateentree', 'heureentree', 'entree', 'dateouverture', 'heureouverture', 'ouverture', 'open', 'datetime', 'date', 'time', 'heure']],
  ['sortiLe', ['sortile', 'exitedat', 'exittime', 'exitdate', 'exitdatetime', 'closetime', 'closedate', 'closed', 'datesortie', 'heuresortie', 'sortie', 'datecloture', 'cloture', 'fermeture', 'close']],
  ['prixEntree', ['prixentree', 'entryprice', 'openprice', 'avgentryprice', 'prixouverture', 'entry']],
  ['prixSortie', ['prixsortie', 'exitprice', 'closeprice', 'avgexitprice', 'prixcloture', 'exit']],
  ['pnl', ['pnl', 'netpnl', 'realizedpnl', 'pnlnet', 'profitloss', 'pl', 'netprofit', 'profit', 'gainperte', 'resultat', 'gain']],
  ['frais', ['frais', 'fees', 'fee', 'commission', 'commissions', 'costs']],
  ['quantite', ['quantite', 'quantity', 'qty', 'size', 'volume', 'lots', 'lot', 'contracts', 'contrats', 'taille']],
  ['direction', ['direction', 'side', 'sens', 'type', 'longshort', 'buysell', 'action']],
  ['stopPrix', ['stopprix', 'stopprice', 'stoploss', 'stop', 'sl']],
  ['idExterne', ['idexterne', 'id', 'tradeid', 'ticket', 'positionid', 'position', 'dealid', 'deal', 'orderid']],
]

// NFD sépare la lettre de son accent ; le filtre final retire l'accent avec la ponctuation.
const normaliserNom = (s: string) => s.normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Deux colonnes du même nom (MT5 : « Time », « Price » deux fois) : « Time (2) ». */
function entetesUniques(entetes: string[]): string[] {
  const vus = new Map<string, number>()
  return entetes.map(e => {
    const n = (vus.get(e) ?? 0) + 1
    vus.set(e, n)
    return n === 1 ? e : `${e} (${n})`
  })
}

/** Correspondance devinée au seul nom des colonnes (aucune ligne lue). */
export function proposerColonnes(entetes: string[]): Partial<ColonnesCsv> {
  const normes = entetes.map(normaliserNom)
  const pris = new Set<number>()
  const proposition: Partial<ColonnesCsv> = {}
  for (const [champ, noms] of NOMS_PROBABLES) {
    let trouve = -1
    // D'abord le nom exact, puis un nom long contenu dans l'en-tête (« Entry Time (UTC) »).
    for (const nom of noms) {
      trouve = normes.findIndex((n, i) => !pris.has(i) && n === nom)
      if (trouve >= 0) break
    }
    if (trouve < 0) {
      for (const nom of noms.filter(x => x.length >= 5)) {
        trouve = normes.findIndex((n, i) => !pris.has(i) && n.includes(nom))
        if (trouve >= 0) break
      }
    }
    if (trouve >= 0) { pris.add(trouve); proposition[champ] = entetes[trouve] }
  }
  return proposition
}

/** Long / short depuis les mots usuels ; null si vide, 'inconnu' sinon. */
function lireDirection(brut: string): 'long' | 'short' | null | 'inconnu' {
  const s = normaliserNom(brut)
  if (!s) return null
  if (/^(long|buy|achat|bought)/.test(s) || ['b', 'l', 'acheter'].includes(s)) return 'long'
  if (/^(short|sell|vente|sold)/.test(s) || ['s', 'vendre'].includes(s)) return 'short'
  return 'inconnu'
}

function parserCsvGenerique(lignes: string[], sep: string, colonnes?: Partial<ColonnesCsv>): ResultatParse {
  const entetes = entetesUniques(decouperLigneCsv(lignes[0], sep))
  const base = { format: 'csv-generique', entetes }
  if (!colonnes) {
    return {
      ...base,
      trades: [],
      erreurs: ['Format non reconnu automatiquement : désigne les colonnes du fichier (symbole, entrée et P&L au minimum) pour le lire.'],
      proposition: proposerColonnes(entetes),
    }
  }

  // Les colonnes désignées doivent exister ; le nom exact d'abord, puis sans casse.
  const index: Partial<Record<ChampCsv, number>> = {}
  const erreurs: string[] = []
  for (const champ of CHAMPS_CSV) {
    const nom = colonnes[champ]
    if (!nom) {
      if (CHAMPS_OBLIGATOIRES.includes(champ)) erreurs.push(`Colonne non désignée : ${champ}.`)
      continue
    }
    let i = entetes.indexOf(nom)
    if (i < 0) i = entetes.findIndex(e => e.trim().toLowerCase() === nom.trim().toLowerCase())
    if (i < 0) erreurs.push(`Colonne « ${nom} » (${champ}) introuvable dans le fichier.`)
    else index[champ] = i
  }
  const devise = (colonnes.devise ?? 'USD').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(devise)) erreurs.push(`Devise « ${colonnes.devise} » inconnue : un code en trois lettres (EUR, USD...).`)
  if (erreurs.length > 0) return { ...base, trades: [], erreurs, proposition: proposerColonnes(entetes) }

  const cellules = lignes.slice(1).map(l => decouperLigneCsv(l, sep))
  const val = (c: string[], champ: ChampCsv) => (index[champ] === undefined ? '' : c[index[champ]!] ?? '')
  const dates = cellules.flatMap(c => [val(c, 'entreLe'), val(c, 'sortiLe')]).filter(Boolean)
  const ordre = ordreDesDates(dates, colonnes.formatDate)
  if ('erreur' in ordre) return { ...base, trades: [], erreurs: [ordre.erreur] }

  const trades: TradeNormalise[] = []
  const vusId = new Map<string, number>()
  const occurrences = new Map<string, number>()

  cellules.forEach((c, k) => {
    const ligne = k + 2
    const raisons: string[] = []
    // Montant facultatif : vide = null ; présent mais illisible = raison.
    const montant = (champ: ChampCsv, libelle: string) => {
      const brut = val(c, champ)
      if (!brut) return null
      const n = lireMontant(brut)
      if (n === null) raisons.push(`${libelle} illisible`)
      return n
    }

    const symbole = val(c, 'symbole')
    if (!symbole) raisons.push('symbole vide')
    const entree = lireHorodatage(val(c, 'entreLe'), ordre.ordre)
    if (!entree) raisons.push("date d'entrée illisible")
    let sortie: Horodatage | null = null
    if (val(c, 'sortiLe')) {
      sortie = lireHorodatage(val(c, 'sortiLe'), ordre.ordre)
      if (!sortie) raisons.push('date de sortie illisible')
    }
    const pnl = lireMontant(val(c, 'pnl'))
    if (pnl === null) raisons.push('P&L illisible')
    let quantite: number | null = 1
    if (index.quantite !== undefined) {
      quantite = lireQuantite(val(c, 'quantite'))
      if (quantite === null) raisons.push('quantité illisible (un nombre de contrats, d\'unités ou de lots, plus grand que 0)')
    }
    const sens = lireDirection(val(c, 'direction'))
    if (sens === 'inconnu') raisons.push(`sens « ${val(c, 'direction').slice(0, 20)} » inconnu`)
    const prixEntree = montant('prixEntree', "prix d'entrée")
    const prixSortie = montant('prixSortie', 'prix de sortie')
    const frais = montant('frais', 'frais')
    const stop = montant('stopPrix', 'stop')
    if (entree && sortie && sortie.date.getTime() < entree.date.getTime()) raisons.push("sortie avant l'entrée")

    if (raisons.length > 0 || !entree || pnl === null || quantite === null) {
      erreurs.push(`Ligne ${ligne} illisible (${raisons.join(', ')}) : ignorée.`)
      return
    }

    // Clé de dédoublonnage. Avec un identifiant : il est complété du symbole et
    // de l'instant d'entrée, pour que deux fichiers de plateformes différentes
    // qui numérotent tous deux « 1, 2, 3 » ne se confondent pas. Sans : une
    // empreinte, et un rang quand deux lignes identiques se suivent (deux
    // partiels au même prix), stable d'un réimport à l'autre.
    const id = val(c, 'idExterne')
    let idExterne: string
    if (id) {
      if (vusId.has(id)) {
        erreurs.push(`Ligne ${ligne} : même identifiant que la ligne ${vusId.get(id)}, ignorée.`)
        return
      }
      vusId.set(id, ligne)
      idExterne = `${id}|${symbole}|${entree.date.toISOString()}`
    } else {
      const empreinte = `${symbole}|${entree.date.toISOString()}|${quantite}|${pnl}`
      const rang = (occurrences.get(empreinte) ?? 0) + 1
      occurrences.set(empreinte, rang)
      idExterne = rang === 1 ? empreinte : `${empreinte}#${rang}`
    }

    trades.push({
      source: 'csv-generique',
      idExterne,
      compte: null,
      symbole,
      direction: sens === 'inconnu' ? null : sens,
      quantite,
      prixEntree,
      prixSortie,
      entreLe: entree.date,
      sortiLe: sortie?.date ?? null,
      pnl,
      devise,
      frais: frais === null ? null : Math.abs(frais),
      dureeSec: sortie ? Math.round((sortie.date.getTime() - entree.date.getTime()) / 1000) : null,
      fuseau: entree.fuseau,
      // Un stop à 0 est l'absence de stop chez MT4/MT5 (« S / L » vide).
      stopPrix: stop === null || stop === 0 ? null : stop,
    })
  })

  if (trades.length === 0 && erreurs.length === 0) erreurs.push('Aucun trade dans le fichier.')
  return { ...base, trades, erreurs }
}

function parserTradovatePerformance(lignes: string[], entetes: string[], fichier?: string): ResultatParse {
  const idx = (nom: string) => entetes.indexOf(nom)
  const trades: TradeNormalise[] = []
  const erreurs: string[] = []

  for (let i = 1; i < lignes.length; i++) {
    const c = decouperLigneCsv(lignes[i])
    const symbole = c[idx('symbol')] ?? ''
    if (!symbole) continue
    const pnl = lireMontant(c[idx('pnl')] ?? '')
    const achatLe = lireDateUs(c[idx('boughtTimestamp')] ?? '')
    const venteLe = lireDateUs(c[idx('soldTimestamp')] ?? '')
    const quantite = Math.abs(parseInt(c[idx('qty')] ?? '', 10)) || 1
    const buyFillId = c[idx('buyFillId')] ?? ''
    const sellFillId = c[idx('sellFillId')] ?? ''

    if (pnl === null || !achatLe || !venteLe) {
      erreurs.push(`Ligne ${i + 1} illisible (pnl ou horodatage) : ignorée.`)
      continue
    }

    // Long si on achète d'abord ; short si on vend d'abord.
    const direction: 'long' | 'short' = achatLe.getTime() <= venteLe.getTime() ? 'long' : 'short'
    const entreLe = direction === 'long' ? achatLe : venteLe
    const sortiLe = direction === 'long' ? venteLe : achatLe
    const prixAchat = lireMontant(c[idx('buyPrice')] ?? '')
    const prixVente = lireMontant(c[idx('sellPrice')] ?? '')

    trades.push({
      source: 'tradovate-performance',
      idExterne: buyFillId && sellFillId ? `${buyFillId}-${sellFillId}` : empreinteTrade({ symbole, entreLe, quantite, pnl }),
      compte: null,
      symbole,
      direction,
      quantite,
      prixEntree: direction === 'long' ? prixAchat : prixVente,
      prixSortie: direction === 'long' ? prixVente : prixAchat,
      entreLe,
      sortiLe,
      pnl,
      devise: 'USD',
      frais: null,
      dureeSec: lireDuree(c[idx('duration')] ?? ''),
    })
  }

  if (trades.length === 0 && erreurs.length === 0) erreurs.push('Aucun trade dans le fichier.')
  void fichier
  return { format: 'tradovate-performance', trades, erreurs }
}
