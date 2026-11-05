// Un doublon = le même document sur le MÊME compte (brief J1, 05/11/2026,
// décision de Brice pour le copy trading). Module PUR (n'importe que des
// modules purs) : scripts/verifier-doublons-compte.mjs le charge tel quel.
//
// Avant : la clé unique (userId, source, idExterne) et l'empreinte (symbole,
// instant d'entrée, quantité, P&L) se cherchaient TOUS COMPTES CONFONDUS. Deux
// comptes copiés importés l'un après l'autre : le second était « déjà connu »
// et ses trades n'étaient pas rangés.
//
// Maintenant, pour un import rangé sur un compte Pilotage (`compteId`) :
// - la clé des sources qui ne disent pas le compte du broker porte le compteId
//   (« <idExterne>|compte:<compteId> ») : le même trade sur deux comptes donne
//   deux clés, la contrainte unique (userId, source, idExterne) ne bloque plus,
//   sans migration ;
// - la clé et l'empreinte se cherchent sur CE compte seulement ;
// - une ligne d'avant (clé sans compte, compteId rempli) se reconnaît encore
//   sur son compte : sa clé est cherchée sous les deux formes.
// Quantower ne change pas : sa clé dit déjà le compte du broker (exécutions) ou
// les numéros d'ordres (ordres), uniques entre les comptes ; elle reste cherchée
// tous comptes confondus, seule l'empreinte se borne au compte.
// Sans compteId (écran /imports du journal, aperçu de Pilotage sans compte) :
// comme avant, tous comptes confondus ; une clé rangée sur un compte y est
// reconnue par sa forme de base.

import { connusParEmpreinte } from './trades-envoyes'

/** Les sources dont la clé dit déjà le compte (ou des numéros uniques entre comptes) : leur clé ne change pas. */
export const SOURCES_AVEC_COMPTE: ReadonlySet<string> = new Set(['quantower-executions', 'quantower-orders'])

/** Ce qui sépare la clé du document du compte Pilotage. */
export const MARQUE_COMPTE = '|compte:'

export const sourceDitLeCompte = (source: string) => SOURCES_AVEC_COMPTE.has(source)

/** La clé d'un trade rangé sur `compteId` (inchangée sans compte, pour Quantower, ou si elle porte déjà ce compte). */
export function cleSurCompte(idExterne: string, source: string, compteId: string | null): string {
  if (compteId === null || sourceDitLeCompte(source)) return idExterne
  const suffixe = MARQUE_COMPTE + compteId
  return idExterne.endsWith(suffixe) ? idExterne : idExterne + suffixe
}

/** La clé du document, sans le compte Pilotage. */
export function cleDeBase(idExterne: string): string {
  const i = idExterne.lastIndexOf(MARQUE_COMPTE)
  return i >= 0 ? idExterne.slice(0, i) : idExterne
}

/** Les trades avec la clé qu'ils auront en base une fois rangés sur `compteId`. */
export function rangerSurCompte<T extends { source: string; idExterne: string }>(trades: T[], compteId: string | null): T[] {
  if (compteId === null) return trades
  return trades.map(t => {
    const cle = cleSurCompte(t.idExterne, t.source, compteId)
    return cle === t.idExterne ? t : { ...t, idExterne: cle }
  })
}

type Empreintable = { idExterne: string; symbole: string; entreLe: Date; quantite: number; pnl: number }

/** Un filtre Prisma de TradeImport, écrit sans Prisma (module pur) ; l'appelant y ajoute userId EN DERNIER. */
export interface FiltreDoublons {
  source: string
  compteId?: string
  idExterne?: { in: string[] }
  entreLe?: { in: Date[] }
  OR?: ({ idExterne: { in: string[] } } | { entreLe: { in: Date[] } })[]
}

/**
 * Les deux recherches en base d'un import (trades d'UNE source, clés déjà
 * rangées par rangerSurCompte) : par clé, et par instant d'entrée pour
 * l'empreinte. Le userId n'y est pas : l'appelant l'ajoute après, il ne se
 * contourne pas.
 */
export function recherchesDoublons(compteId: string | null, trades: (Empreintable & { source: string })[]): { parCle: FiltreDoublons; parEntree: FiltreDoublons } {
  const source = trades[0]?.source ?? ''
  const cles = [...new Set(trades.map(t => t.idExterne))]
  const entrees = [...new Set(trades.map(t => t.entreLe.getTime()))].map(ms => new Date(ms))
  if (compteId === null) {
    // Tous comptes : la clé telle quelle, ou rangée sur un compte (même instant d'entrée, comparée par sa base).
    return {
      parCle: { source, OR: [{ idExterne: { in: cles } }, { entreLe: { in: entrees } }] },
      parEntree: { source, entreLe: { in: entrees } },
    }
  }
  const bases = cles.map(cleDeBase)
  return {
    parCle: sourceDitLeCompte(source)
      ? { source, idExterne: { in: cles } }
      : { source, compteId, idExterne: { in: [...new Set([...cles, ...bases])] } },
    parEntree: { source, compteId, entreLe: { in: entrees } },
  }
}

/**
 * Les clés déjà connues d'un import, à partir des lignes que les deux
 * recherches ont rendues : celles trouvées par leur clé (ramenée à la forme
 * de l'import : rangée sur le compte, ou de base sans compte), puis celles
 * reconnues à l'empreinte (connusParEmpreinte). `parEntree` vide = pas
 * d'empreinte (l'écran /imports n'en a jamais fait).
 */
export function clesConnues(
  trades: (Empreintable & { source: string })[],
  compteId: string | null,
  parCle: { idExterne: string }[],
  parEntree: Empreintable[],
): Set<string> {
  const source = trades[0]?.source ?? ''
  const forme = (id: string) => (compteId === null ? cleDeBase(id) : cleSurCompte(id, source, compteId))
  const connues = new Set(parCle.map(e => forme(e.idExterne)))
  if (parEntree.length === 0) return connues
  return connusParEmpreinte(trades, connues, parEntree.map(e => ({ ...e, idExterne: forme(e.idExterne) })))
}
