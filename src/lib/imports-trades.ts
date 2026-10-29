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
// Prévu : Orders history Quantower/Rithmic (des ordres à reconstruire).
//
// Ce module n'importe rien : scripts/verifier-imports-trades.mjs le charge tel quel.

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

  // Orders history Quantower/Rithmic : reconnu mais pas encore supporté —
  // le dire clairement vaut mieux qu'un « format inconnu ».
  if (entetesSep.includes('Order type') && entetesSep.includes('Average fill price')) {
    return {
      format: 'quantower-orders',
      trades: [],
      erreurs: ["Ce fichier est un historique d'ordres, pas de trades : exporte le rapport Performance de Tradovate, ou envoie-nous ton fichier au support pour qu'on l'ajoute."],
    }
  }

  return parserCsvGenerique(lignes, sep, colonnes)
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

// ── CSV générique ────────────────────────────────────────────────────────────

type ChampCsv = Exclude<keyof ColonnesCsv, 'formatDate' | 'devise'>

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
      idExterne: buyFillId && sellFillId ? `${buyFillId}-${sellFillId}` : `${symbole}-${entreLe.toISOString()}-${quantite}-${pnl}`,
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
