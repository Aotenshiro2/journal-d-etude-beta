// LES BESOINS DES MEMBRES, SIGNAUX DE FRICTION ET LIMITES DES AGENTS
// (06/11/2026, apres-midi) : le serveur. Regles pures : signaux-pur.ts (la
// liste fermee des cles, le contexte permis, la cadence, le seuil, le tri des
// limites). Contrat : besoins-contrat-api.md, « Suite du 06/11 apres-midi ».
//
// - Un signal s'ecrit sous verrou par personne (cadence : une fois par heure
//   et par cle, 30 par jour), dans la table besoin_signal (migration
//   20261106200000, HORS du schema Prisma : avant elle, tout signal est ignore
//   en silence et rien ne casse).
// - La personne est un HMAC : compte AOK, compte Telegram, ou, sans session,
//   une empreinte du JOUR (IP et forme de l'appareil, hachees avec un secret
//   du serveur). Ni l'IP ni un identifiant ne sont gardes en clair. Sans
//   secret, aucun signal n'est ecrit.
// - Le seuil s'evalue au moment ou un signal est ecrit, jamais par minuterie :
//   3 personnes distinctes en 7 jours = une carte a_trier de la cle (cree_par
//   'signal'), ou rien si une carte porte deja cette cle (quel que soit son
//   statut : une carte refusee ne se rouvre pas toute seule).
// - Les limites des agents : le tri de Brice (triLimites) puis la note sur une
//   carte (cree_par 'agent', le message du membre recopie du fil comme pour
//   noter_besoin, sans phrase au membre), et les signaux du serveur.
// Ne jette jamais vers l'appelant : un bot repond comme avant, quoi qu'il
// arrive ici. Jamais de contexte, de personne ni de texte de membre dans un log.

import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { erreurCourte, estTableAbsente } from './pur'
import type { Depots } from './moteur'
import { depotsServeur, noterBesoinsDuChat, noterBesoinsTelegram } from './serveur'
import {
  CADENCE_CLE_MINUTES, CORPS_SIGNAL_MAX_OCTETS, RE_PERSONNE, SEUIL_JOURS, SEUIL_PERSONNES,
  appareilEmpreinte, besoinDeLimite, besoinDuSignal, contexteServeur, decisionCadence, decisionSeuil, echangeSensible,
  estRefusPolitique, jourEmpreinte, lireCorpsSignal, rienANoter, triLimites,
  type BilanLimites, type CleSignal, type Contexte, type SuiviLimites,
} from './signaux-pur'

export type ReponseSignal = { status: number; corps: Record<string, unknown> }

// ---------------------------------------------------------------------------
// La personne : un HMAC, jamais un identifiant en clair
// ---------------------------------------------------------------------------

const USAGE_COMPTE = 'aok/besoins_signal/compte/v1'
const USAGE_TELEGRAM = 'aok/besoins_signal/telegram/v1'
const USAGE_VISITEUR = 'aok/besoins_signal/visiteur/v1'

/** Le secret des empreintes : BESOINS_SIGNAL_SEL, sinon la cle de service (derivee par usage, comme le lien magique du cockpit). */
function secret(): string | null {
  return process.env.BESOINS_SIGNAL_SEL?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null
}

function empreinte(prefixe: 'c' | 't' | 'a', usage: string, valeur: string): string | null {
  const s = secret()
  if (!s) return null
  const cle = createHmac('sha256', s).update(usage, 'utf8').digest()
  return `${prefixe}:${createHmac('sha256', cle).update(valeur, 'utf8').digest('hex').slice(0, 32)}`
}

export function personneCompte(userId: string): string | null {
  return userId ? empreinte('c', USAGE_COMPTE, userId.trim().toLowerCase()) : null
}

export function personneTelegram(telegramId: number): string | null {
  return Number.isSafeInteger(telegramId) && telegramId > 0 ? empreinte('t', USAGE_TELEGRAM, String(telegramId)) : null
}

/** Un visiteur sans session : son empreinte du jour (IP et forme de l'appareil). Sans IP lisible : null, rien n'est ecrit. */
export function personneVisiteur(ip: string | null, ua: string | null, maintenant = new Date()): string | null {
  if (!ip) return null
  return empreinte('a', USAGE_VISITEUR, `${jourEmpreinte(maintenant)}|${ip}|${appareilEmpreinte(ua)}`)
}

function ipDe(req: NextRequest): string | null {
  const brute = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || (req.headers.get('x-real-ip') ?? '').trim()
  return brute && isIP(brute) ? brute : null
}

// ---------------------------------------------------------------------------
// L'ecriture d'un signal et le seuil
// ---------------------------------------------------------------------------

export type IssueSignal = 'ecrit' | 'cadence' | 'sans_personne' | 'absente' | 'panne'

/**
 * Un signal : verrou par personne, cadence lue sous le verrou, ecriture, puis
 * le seuil de la cle. Ne jette pas.
 */
export async function enregistrerSignal(o: { app: string; cle: CleSignal; contexte: Contexte; personne: string | null }): Promise<IssueSignal> {
  const personne = o.personne
  if (!personne || !RE_PERSONNE.test(personne)) return 'sans_personne'
  const app = /^[a-z_]{1,32}$/.test(o.app) ? o.app : 'autre'
  try {
    const decision = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`besoins:signal:${personne}`}::text, 0))) as verrou`
      const l = await tx.$queryRaw<{ heure: boolean; jour: number }[]>`
        select
          exists (select 1 from public.besoin_signal s where s.personne = ${personne} and s.cle = ${o.cle}
                  and s.created_at > now() - ${CADENCE_CLE_MINUTES}::int * interval '1 minute') as heure,
          (select count(*)::int from public.besoin_signal s where s.personne = ${personne}
                  and s.created_at > now() - interval '24 hours') as jour`
      const d = decisionCadence({ dejaCetteHeure: l[0]?.heure === true, aujourdhui: Number(l[0]?.jour ?? 0) })
      if (d !== 'ecrire') return d
      await tx.$executeRaw`
        insert into public.besoin_signal (cle, app, personne, contexte)
        values (${o.cle}, ${app}, ${personne}, ${JSON.stringify(o.contexte)}::jsonb)`
      return d
    })
    if (decision !== 'ecrire') return 'cadence'
  } catch (err) {
    if (estTableAbsente(err)) return 'absente'
    console.warn(`[besoins/signal] non enregistre : ${erreurCourte(err)}`)
    return 'panne'
  }
  await evaluerSeuil(o.cle)
  return 'ecrit'
}

/**
 * La carte d'une cle de signal : celle qui porte deja la cle (fusions suivies),
 * sinon une carte a_trier creee avec le titre FIXE de la cle (cree_par
 * 'signal', aucun mot de membre). Seuil atteint, ou ligne C du bouton.
 */
export async function carteDuSignal(cle: CleSignal, depots: Depots): Promise<{ id: string; cle: string; titre: string; nouvelle: boolean }> {
  const deja = await depots.carteParCle(cle)
  if (deja) return { id: deja.id, cle: deja.cle, titre: deja.titre, nouvelle: false }
  const creee = await depots.creerCarte(besoinDuSignal(cle), cle, 'signal')
  if (creee) return { id: creee.id, cle: creee.cle, titre: creee.titre, nouvelle: true }
  // Creee entre-temps par un autre signal.
  const course = await depots.carteParCle(cle)
  if (course) return { id: course.id, cle: course.cle, titre: course.titre, nouvelle: false }
  throw new Error('carte du signal introuvable')
}

/** Le seuil de la cle, au moment ou un signal vient d'etre ecrit. Ne jette pas. */
async function evaluerSeuil(cle: CleSignal): Promise<void> {
  try {
    const l = await prisma.$queryRaw<{ n: number }[]>`
      select count(distinct s.personne)::int as n from public.besoin_signal s
      where s.cle = ${cle} and s.created_at > now() - ${SEUIL_JOURS}::int * interval '1 day'`
    const personnes7j = Number(l[0]?.n ?? 0)
    if (personnes7j < SEUIL_PERSONNES) return
    const depots = depotsServeur()
    const carte = await depots.carteParCle(cle)
    if (decisionSeuil({ personnes7j, carteExiste: carte !== null }) === 'creer') await carteDuSignal(cle, depots)
  } catch (err) {
    console.warn(`[besoins/signal] seuil non evalue : ${erreurCourte(err)}`)
  }
}

// ---------------------------------------------------------------------------
// POST /api/besoins/signal
// ---------------------------------------------------------------------------

/**
 * Un signal d'un outil (session facultative). 200 { ok: true } meme quand il
 * est ignore (cadence, pas de personne, migration absente) ; 400 cle, app ou
 * contexte invalide ; 503 base en panne. `session` lit le compte de la
 * requete (getUserId, passe par la route), seulement pour un corps valide.
 */
export async function recevoirSignal(req: NextRequest, session: () => Promise<string | null>): Promise<ReponseSignal> {
  const longueur = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(longueur) && longueur > CORPS_SIGNAL_MAX_OCTETS) return { status: 400, corps: { error: 'Corps trop long.' } }
  let brut: unknown
  try {
    const t = await req.text()
    if (t.length > CORPS_SIGNAL_MAX_OCTETS) return { status: 400, corps: { error: 'Corps trop long.' } }
    brut = JSON.parse(t)
  } catch {
    return { status: 400, corps: { error: 'Corps JSON attendu : { app, cle, contexte? }.' } }
  }
  const c = lireCorpsSignal(brut)
  if ('erreur' in c) return { status: 400, corps: { error: c.erreur } }
  let userId: string | null = null
  try {
    userId = await session()
  } catch {
    userId = null
  }
  const personne = userId ? personneCompte(userId) : personneVisiteur(ipDe(req), req.headers.get('user-agent'))
  const issue = await enregistrerSignal({ app: c.app, cle: c.cle, contexte: c.contexte, personne })
  if (issue === 'panne') return { status: 503, corps: { error: 'Indisponible pour le moment.' } }
  return { status: 200, corps: { ok: true } }
}

// ---------------------------------------------------------------------------
// Les signaux du serveur (bot des membres, chat du support)
// ---------------------------------------------------------------------------

/** Un signal du bot des membres (bouton perime, message non compris, agent en echec). Ne jette pas. */
export async function signalerBot(telegramId: number, cle: CleSignal, contexte: Record<string, unknown> = {}): Promise<void> {
  try {
    await enregistrerSignal({ app: 'telegram', cle, contexte: contexteServeur(cle, contexte), personne: personneTelegram(telegramId) })
  } catch (err) {
    console.warn(`[besoins/signal] signal du bot perdu : ${erreurCourte(err)}`)
  }
}

// ---------------------------------------------------------------------------
// Les limites des agents : le tri de Brice, puis la note et les signaux
// ---------------------------------------------------------------------------

/** Un compte Telegram de l'equipe que le bot reconnait (cockpit_telegram_comptes : Brice, Melanie, Adil). Dans le doute : non. */
async function estAdminTelegram(telegramId: number): Promise<boolean> {
  try {
    const l = await prisma.$queryRaw<{ ok: number }[]>`
      select 1 as ok from public.cockpit_telegram_comptes where telegram_id = ${telegramId}::bigint limit 1`
    return l.length > 0
  } catch {
    return false
  }
}

/** Un compte AOK de l'equipe que le bot reconnait (cockpit_telegram_comptes.user_id). Dans le doute : non. */
async function estAdminCompte(userId: string): Promise<boolean> {
  try {
    const l = await prisma.$queryRaw<{ ok: number }[]>`
      select 1 as ok from public.cockpit_telegram_comptes where user_id::text = ${userId} limit 1`
    return l.length > 0
  } catch {
    return false
  }
}

/**
 * Fin d'un echange du bot des membres : le tri (l'admin n'est lu que si
 * l'echange est sensible), les limites sur une carte (cree_par 'agent', sans
 * phrase au membre), puis les signaux du serveur. Ne jette pas.
 */
export async function appliquerLimitesTelegram(o: {
  telegramId: number
  /** Le message du membre tel que le pont l'ecrit au fil (nettoyerPourSupport). */
  texteFil: string
  texteMembre: string
  reponse: string
  suivi: SuiviLimites
}): Promise<BilanLimites | null> {
  // Le cas courant : rien vu, et pas de refus (qui, pour un admin, laisse une limite du serveur).
  if (rienANoter(o.suivi) && !estRefusPolitique(o.reponse)) return null
  try {
    const sensible = !o.suivi.prudence && echangeSensible(o.suivi, o.reponse)
    const admin = sensible ? await estAdminTelegram(o.telegramId) : false
    const bilan = triLimites(o.suivi, { bot: 'liveclub', admin, texteMembre: o.texteMembre, reponse: o.reponse })
    if (bilan.limites.length) {
      await noterBesoinsTelegram({
        telegramId: o.telegramId, texteFil: o.texteFil, besoins: bilan.limites.map(l => besoinDeLimite(l, 'bot')),
        peutDire: false, creePar: 'agent',
      })
    }
    const personne = personneTelegram(o.telegramId)
    for (const s of bilan.signaux) await enregistrerSignal({ app: 'telegram', cle: s.cle, contexte: s.contexte, personne })
    return bilan
  } catch (err) {
    console.warn(`[besoins/limites] bot : ${erreurCourte(err)}`)
    return null
  }
}

/** Fin d'un echange du chat du support (apres la sauvegarde du fil). Ne jette pas. */
export async function appliquerLimitesChat(o: {
  userId: string
  app: string
  filId: string
  /** Le message du membre tel qu'il est au fil. */
  texte: string
  reponse: string
  suivi: SuiviLimites
}): Promise<BilanLimites | null> {
  if (rienANoter(o.suivi) && !estRefusPolitique(o.reponse)) return null
  try {
    const sensible = !o.suivi.prudence && echangeSensible(o.suivi, o.reponse)
    const admin = sensible ? await estAdminCompte(o.userId) : false
    const bilan = triLimites(o.suivi, { bot: 'support', admin, texteMembre: o.texte, reponse: o.reponse, app: o.app })
    if (bilan.limites.length) {
      await noterBesoinsDuChat({
        userId: o.userId, app: o.app, filId: o.filId, texte: o.texte, besoins: bilan.limites.map(l => besoinDeLimite(l, 'site')),
        peutDire: false, creePar: 'agent',
      })
    }
    const personne = personneCompte(o.userId)
    for (const s of bilan.signaux) await enregistrerSignal({ app: /^[a-z_]{1,32}$/.test(o.app) ? o.app : 'site', cle: s.cle, contexte: s.contexte, personne })
    return bilan
  } catch (err) {
    console.warn(`[besoins/limites] chat : ${erreurCourte(err)}`)
    return null
  }
}
