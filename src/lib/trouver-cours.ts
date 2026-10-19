// trouver_cours cote serveur (19/10/2026) : la lecture EN DIRECT des lecons
// de l'academie, par la fonction SQL public.academie_trouver_cours (migration
// 20261019120000_academie_trouver_cours.sql, SECURITY DEFINER, execute retire
// a anon et authenticated : seul le serveur l'appelle). La mise en forme et
// les consignes sont dans le module pur trouver-cours-pur.ts.
//
// Appelee par le bot Live Club (liveclub/agent-membre.ts), le chat support du
// site (api/support/chat/route.ts), scripts/eval-fuites.mjs et
// scripts/verifier-trouver-cours.mjs.

import { prisma } from './db'
import type { BotPolitique } from './politique-information'
import {
  LIGNES_DEMANDEES, RESULTAT_SANS_NOTION, SQL_TROUVER_COURS,
  lireEntreeTrouverCours, requeteEtendue, resultatTrouverCours, type LigneCours,
} from './trouver-cours-pur'

/** Le resultat de trouver_cours pour le bot donne. Ne jette pas : une base illisible rend recherche_indisponible. */
export async function trouverCours(entree: unknown, bot: BotPolitique): Promise<Record<string, unknown>> {
  const e = lireEntreeTrouverCours(entree)
  if (!e) return RESULTAT_SANS_NOTION
  let lignes: LigneCours[] | null
  try {
    const brutes = await prisma.$queryRawUnsafe<LigneCours[]>(SQL_TROUVER_COURS, requeteEtendue(e.notion), LIGNES_DEMANDEES)
    lignes = brutes.map(l => ({ ...l, rang: Number(l.rang) }))
  } catch (err) {
    // Jamais le message : il peut reprendre la requete.
    console.warn(`[trouver_cours] base illisible (${err instanceof Error ? err.name : 'erreur'})`)
    lignes = null
  }
  return resultatTrouverCours(bot, e, lignes)
}
