// Import des trades depuis les fichiers des plateformes — porte DÉTERMINISTE
// (go Brice 08/09/2026). Un format = un parseur, reconnu à la signature de ses
// en-têtes ; rien ne passe par l'IA ici, rien n'est inventé, et ce qui ne se
// lit pas proprement est rejeté ligne par ligne avec sa raison.
//
// v1 : Tradovate « Performance.csv » — le format en or, une ligne = un trade
// déjà apparié (buyFillId/sellFillId, prix des deux jambes, pnl, horodatages).
// v2 prévue : table Trades de TopstepX (capture intelligente, même schéma).
// v3 prévue : Orders history Quantower/Rithmic (des ordres à reconstruire).

export interface TradeNormalise {
  source: string
  idExterne: string
  compte: string | null
  symbole: string
  direction: 'long' | 'short' | null
  quantite: number
  prixEntree: number | null
  prixSortie: number | null
  entreLe: Date
  sortiLe: Date | null
  pnl: number
  devise: string
  frais: number | null
  dureeSec: number | null
}

export interface ResultatParse {
  format: string | null
  trades: TradeNormalise[]
  erreurs: string[]
}

/** Découpe une ligne CSV en gérant les champs entre guillemets ("$1,195.00"). */
function decouperLigneCsv(ligne: string): string[] {
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
    } else if (c === ',') {
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

/** Reconnaît le format à la signature des en-têtes et parse. */
export function parserFichierTrades(texte: string, fichier?: string): ResultatParse {
  const lignes = texte.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lignes.length === 0) return { format: null, trades: [], erreurs: ['Fichier vide.'] }

  const entetes = decouperLigneCsv(lignes[0])
  if (ENTETES_TRADOVATE.every(e => entetes.includes(e))) {
    return parserTradovatePerformance(lignes, entetes, fichier)
  }

  // Orders history Quantower/Rithmic : reconnu mais pas encore supporté —
  // le dire clairement vaut mieux qu'un « format inconnu ».
  if (entetes.includes('Order type') && entetes.includes('Average fill price')) {
    return {
      format: 'quantower-orders',
      trades: [],
      erreurs: ['Ce fichier est un historique d’ORDRES (Quantower/Rithmic), pas de trades : la reconstruction arrive dans une prochaine version. Exporte plutôt le rapport Performance de Tradovate.'],
    }
  }

  return { format: null, trades: [], erreurs: ['Format non reconnu. Formats supportés aujourd’hui : rapport Performance de Tradovate (CSV).'] }
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
