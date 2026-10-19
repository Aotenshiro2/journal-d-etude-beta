// trouver_cours cote serveur (19/10/2026) : la lecture EN DIRECT des lecons
// de l'academie, par la fonction SQL public.academie_trouver_cours (migrations
// 20261019120000 et 20261019140000, SECURITY DEFINER, execute retire a anon
// et authenticated : seul le serveur l'appelle). La mise en forme et les
// consignes sont dans le module pur trouver-cours-pur.ts.
//
// LES ACCES DE LA PERSONNE (Brice, 19/10) : avec un compte du site, ses
// droits viennent de droitsAcademie (src/lib/academie/droits.ts, APPELE
// seulement, jamais modifie ici), gardes 10 minutes par compte dans cette
// instance : une conversation ne les calcule qu'une fois, pas a chaque
// question (droits.ts garde deja Stripe en cache par email).
// - chat support : le compte du jeton (la route l'a deja verifie) ;
// - bot Live Club : le compte Telegram rattache (cockpit_liveclub_rattachements)
//   donne l'email du payeur ; le compte du site est celui qui a cet email
//   VERIFIE (meme regle que droitsAcademie pour les acces par email), s'il
//   est unique. Sinon : l'hypothese Live Club actif.
//
// Appelee par le bot Live Club (liveclub/agent-membre.ts), le chat support du
// site (api/support/chat/route.ts), scripts/eval-fuites.mjs et
// scripts/verifier-trouver-cours.mjs.

import { prisma } from './db'
import type { BotPolitique } from './politique-information'
import { droitsAcademie } from './academie/droits'
import { CacheCourt, type Droits } from './academie/pur'
import { rattachementActif } from './liveclub/rattacher'
import {
  LIGNES_DEMANDEES, RESULTAT_SANS_NOTION, SQL_TROUVER_COURS,
  lireEntreeTrouverCours, requeteEtendue, resultatTrouverCours, type CompteCours, type LigneCours,
} from './trouver-cours-pur'

const DUREE_CACHE_MS = 10 * 60 * 1000
const cacheDroits = new CacheCourt<Droits>(500)
const cacheCompteTelegram = new CacheCourt<string | null>(500)

/** Les droits d'un compte du site, une fois par 10 minutes. null = illisibles (pas de cache). */
async function droitsDuCompte(userId: string): Promise<Droits | null> {
  const enCache = cacheDroits.lire(userId)
  if (enCache) return enCache
  try {
    const d = await droitsAcademie(userId)
    // Un Stripe illisible (incomplet) ne se garde pas : la question suivante relira.
    if (!d.incomplet) cacheDroits.ecrire(userId, d, DUREE_CACHE_MS)
    return d
  } catch (err) {
    console.warn(`[trouver_cours] droits illisibles (${err instanceof Error ? err.name : 'erreur'})`)
    return null
  }
}

/** $1 = email (minuscules). Les comptes du site qui ont cet email verifie (deux au plus : unique ou pas). */
const SQL_COMPTES_PAR_EMAIL = `
select distinct x.id::text as id from (
  select u.id from auth.users u
   where lower(btrim(u.email)) = $1 and u.email_confirmed_at is not null
  union
  select pe.profile_id from public.profile_emails pe
   where lower(btrim(pe.email)) = $1 and pe.verified = true
) x
limit 2
`

/** Le compte du site d'un compte Telegram rattache, ou null (pas de rattachement, pas de compte, ou plusieurs). */
async function compteDuTelegram(telegramId: number): Promise<string | null> {
  const cle = String(telegramId)
  const enCache = cacheCompteTelegram.lire(cle)
  if (enCache !== undefined) return enCache
  const r = await rattachementActif(telegramId)
  const email = r?.email?.trim().toLowerCase()
  let compte: string | null = null
  if (email) {
    const lignes = await prisma.$queryRawUnsafe<{ id: string }[]>(SQL_COMPTES_PAR_EMAIL, email)
    compte = lignes.length === 1 ? lignes[0].id : null
  }
  cacheCompteTelegram.ecrire(cle, compte, DUREE_CACHE_MS)
  return compte
}

/** Qui ecrit : le compte du site (support), le compte Telegram (Live Club), ou des droits deja connus (eval). */
export type QuiEcrit = { userId?: string | null; telegramId?: number; droits?: Droits }

const parDefaut = (bot: BotPolitique): CompteCours =>
  bot === 'liveclub' ? { etat: 'hypothese_live_club' } : { etat: 'visiteur' }

async function compteCours(bot: BotPolitique, qui: QuiEcrit): Promise<CompteCours> {
  if (qui.droits) return { etat: 'droits', droits: qui.droits }
  let userId = qui.userId ?? null
  if (!userId && bot === 'liveclub' && qui.telegramId !== undefined) {
    try {
      userId = await compteDuTelegram(qui.telegramId)
    } catch (err) {
      console.warn(`[trouver_cours] rattachement illisible (${err instanceof Error ? err.name : 'erreur'})`)
    }
  }
  if (!userId) return parDefaut(bot)
  const droits = await droitsDuCompte(userId)
  return droits ? { etat: 'droits', droits } : { etat: 'illisible' }
}

/** Le resultat de trouver_cours pour le bot donne. Ne jette pas : une base illisible rend recherche_indisponible. */
export async function trouverCours(entree: unknown, bot: BotPolitique, qui: QuiEcrit = {}): Promise<Record<string, unknown>> {
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
  // Les droits seulement s'il y a des lecons a juger.
  const compte = lignes?.length ? await compteCours(bot, qui) : parDefaut(bot)
  return resultatTrouverCours(bot, e, lignes, compte)
}
