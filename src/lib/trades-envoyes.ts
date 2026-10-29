// Les trades envoyés tels quels à l'import (brief D1, 30/10/2026) : ceux que
// /api/pilotage/documents/lire a lus dans un PDF, un HTML ou une image
// (TradeNormalise passés par JSON : les dates arrivent en chaînes ISO).
// POST /api/pilotage/trades/import { trades, source, compteId, confirmer?, fuseau? }
// les fait passer par le même dédoublonnage (userId, source, idExterne), le
// même regroupement et les mêmes correspondances qu'un CSV.
//
// Rien de ce que le client envoie n'est cru : chaque champ est vérifié, une
// ligne douteuse est écartée avec sa raison. Module PUR (n'importe que des
// modules purs) : scripts/verifier-documents.mjs le charge tel quel.

import { empreinteTrade, type ResultatParse, type TradeNormalise } from './imports-trades'
import { nomFuseau } from './fuseau'

type Empreintable = { idExterne: string; symbole: string; entreLe: Date; quantite: number; pnl: number }

/**
 * Les clés déjà connues, complétées des trades présents en base sous une AUTRE
 * clé de la même source (brief D1, 30/10/2026). Le rapport Performance de
 * Tradovate en CSV porte les ids de fills, son PDF non : le même trade y a deux
 * clés, mais la même empreinte (symbole, instant d'entrée, quantité, P&L). Un
 * CSV puis le PDF du même rapport, ou l'inverse : 0 nouveau.
 * @param existants les exécutions du membre de la même source dont l'instant
 *   d'entrée est celui d'un trade importé. Chacune ne reconnaît qu'un trade
 *   (deux trades identiques en base en reconnaissent deux, pas plus), et celles
 *   déjà reconnues par leur clé ne comptent pas une seconde fois.
 */
export function connusParEmpreinte(trades: Empreintable[], connus: Set<string>, existants: Empreintable[]): Set<string> {
  const entrants = new Set(trades.map(t => t.idExterne))
  const restants = new Map<string, number>()
  for (const e of existants) {
    if (entrants.has(e.idExterne)) continue
    const cle = empreinteTrade(e)
    restants.set(cle, (restants.get(cle) ?? 0) + 1)
  }
  const resultat = new Set(connus)
  for (const t of trades) {
    if (resultat.has(t.idExterne)) continue
    const cle = empreinteTrade(t)
    const n = restants.get(cle) ?? 0
    if (n > 0) {
      resultat.add(t.idExterne)
      restants.set(cle, n - 1)
    }
  }
  return resultat
}

/** Le fuseau d'un trade lu : un décalage (« +02:00 ») ou un nom IANA reconnu ; sinon null (heure telle qu'affichée). */
function fuseauEnvoye(brut: unknown): string | null {
  if (typeof brut !== 'string' || !brut.trim()) return null
  const s = brut.trim()
  return /^[+-]\d{2}:\d{2}$/.test(s) ? s : nomFuseau(s)
}

/** Autant qu'un gros export CSV : au-delà, le front découpe. */
export const TRADES_ENVOYES_MAX = 10_000

const RE_SOURCE = /^[a-z0-9][a-z0-9:._-]{1,79}$/

/** La source d'un import par trades (« pdf:tradovate », « html:vantage »), ou null si elle ne convient pas. */
export function sourceEnvoyee(brut: unknown): string | null {
  if (typeof brut !== 'string') return null
  const s = brut.trim().toLowerCase()
  return RE_SOURCE.test(s) ? s : null
}

const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const texte = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
function instant(v: unknown): Date | null {
  if (typeof v !== 'string' && !(v instanceof Date)) return null
  const d = new Date(v)
  const t = d.getTime()
  return Number.isNaN(t) || t < Date.UTC(1990, 0, 1) || t > Date.UTC(2100, 0, 1) ? null : d
}

/**
 * Les trades d'un body.trades, vérifiés. Tous prennent la `source` donnée (la
 * clé de dédoublonnage en dépend) ; sans source valable, rien n'est lu.
 * Deux lignes au même idExterne : la seconde est écartée.
 */
export function lireTradesEnvoyes(brut: unknown, sourceBrute: unknown): ResultatParse {
  const source = sourceEnvoyee(sourceBrute)
  if (!source) {
    return { format: null, trades: [], erreurs: ['Source manquante ou invalide : une chaîne courte comme « pdf:tradovate » (lettres, chiffres, « : . _ - »).'] }
  }
  if (!Array.isArray(brut)) return { format: source, trades: [], erreurs: ['Aucun trade envoyé.'] }
  if (brut.length > TRADES_ENVOYES_MAX) {
    return { format: source, trades: [], erreurs: [`Trop de trades d'un coup (${TRADES_ENVOYES_MAX} au plus) : envoie-les en plusieurs fois.`] }
  }

  const trades: TradeNormalise[] = []
  const erreurs: string[] = []
  const vus = new Map<string, number>()
  brut.forEach((item, k) => {
    const rang = k + 1
    const t = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null
    const raisons: string[] = []
    const idExterne = texte(t?.idExterne, 200)
    const symbole = texte(t?.symbole, 40)
    const entreLe = instant(t?.entreLe)
    const sortiLe = t?.sortiLe === null || t?.sortiLe === undefined ? null : instant(t.sortiLe)
    const pnl = nombre(t?.pnl)
    const q = t?.quantite === undefined || t?.quantite === null ? 1 : nombre(t.quantite)
    if (!idExterne) raisons.push('idExterne vide')
    if (!symbole) raisons.push('symbole vide')
    if (!entreLe) raisons.push('entreLe illisible')
    if (t?.sortiLe !== null && t?.sortiLe !== undefined && !sortiLe) raisons.push('sortiLe illisible')
    if (entreLe && sortiLe && sortiLe.getTime() < entreLe.getTime()) raisons.push("sortie avant l'entrée")
    if (pnl === null) raisons.push('pnl illisible')
    if (q === null || q <= 0 || q > 1_000_000) raisons.push('quantité illisible')
    if (!t || raisons.length > 0 || !idExterne || !symbole || !entreLe || pnl === null || q === null) {
      erreurs.push(`Trade ${rang} illisible (${raisons.join(', ') || 'pas un objet'}) : ignoré.`)
      return
    }
    if (vus.has(idExterne)) {
      erreurs.push(`Trade ${rang} : même idExterne que le trade ${vus.get(idExterne)}, ignoré.`)
      return
    }
    vus.set(idExterne, rang)
    const deviseBrute = texte(t.devise, 8)?.toUpperCase() ?? null
    const frais = nombre(t.frais)
    const duree = nombre(t.dureeSec)
    const stop = nombre(t.stopPrix)
    trades.push({
      source,
      idExterne,
      compte: texte(t.compte, 80),
      symbole,
      direction: t.direction === 'long' || t.direction === 'short' ? t.direction : null,
      quantite: q,
      prixEntree: nombre(t.prixEntree),
      prixSortie: nombre(t.prixSortie),
      entreLe,
      sortiLe,
      pnl,
      devise: deviseBrute && /^[A-Z]{3}$/.test(deviseBrute) ? deviseBrute : 'USD',
      frais: frais === null ? null : Math.abs(frais),
      dureeSec: duree !== null && duree >= 0 ? Math.round(duree) : sortiLe ? Math.round((sortiLe.getTime() - entreLe.getTime()) / 1000) : null,
      fuseau: fuseauEnvoye(t.fuseau),
      stopPrix: stop === null || stop === 0 ? null : stop,
    })
  })

  if (trades.length === 0 && erreurs.length === 0) erreurs.push('Aucun trade envoyé.')
  return { format: source, trades, erreurs }
}
