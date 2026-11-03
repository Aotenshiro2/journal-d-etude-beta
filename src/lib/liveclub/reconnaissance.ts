// Reconnaitre une personne par l'ontologie des membres (Brice, 03/11) : la
// LECTURE des traces, les regles sont dans reconnaissance-pur.ts.
//
// Lecteurs :
// - l'accueil du groupe (route du webhook, chat_member) et le message prive
//   de l'admission (bot-membre.ts) : un compte Telegram jamais vu peut etre
//   un ancien membre revenu par un autre compte ou une autre adresse ;
// - le resume du matin (resume.ts) : « nouveau » ou « retour » sur la ligne
//   d'une arrivee.
// Et lireEquipe : les fiches, comptes Telegram et clients Stripe de l'equipe
// (exemption fondateur, admin ou equipe, et comptes d'Agent AOK), que le
// resume ne met jamais dans « À contacter » ni dans les impayes.
//
// Chaque requete porte un marqueur en commentaire (/* reco:... */) : les
// tests (scripts/verifier-reconnaissance.mjs) repondent par une fausse base.
// Lecture seule. Jette sur une panne : l'appelant decide (prudence).

import { prisma } from '@/lib/db'
import {
  AUCUNE_TRACE, JOURS_FICHE_ANCIENNE, JOURS_TRACE_ANCIENNE, cleNom, reconnaitre,
  type Indice, type Reconnaissance, type Traces,
} from './reconnaissance-pur'

/** Ce que l'appelant sait de la personne. Tout est facultatif sauf l'instant de l'arrivee. */
export type QuiArrive = {
  telegramId?: number | null
  membreId?: string | null
  /** L'abonnement qui la fait entrer (sub_...) : il n'est pas une trace du passe. */
  abonnementId?: string | null
  clientStripe?: string | null
  emails?: readonly (string | null | undefined)[]
  /** Nom complet (Telegram, Stripe) : seulement si aucun identifiant ne trouve de fiche. */
  nom?: string | null
  quand: Date
}

/** Ce que la base doit savoir faire (prisma, ou une fausse base dans les tests). */
export type BaseLecture = { $queryRaw: <T = unknown>(requete: TemplateStringsArray, ...valeurs: unknown[]) => Promise<T> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLIENT = /^cus_[A-Za-z0-9]+$/
const JOUR_MS = 86_400_000

function propresEmails(v: readonly (string | null | undefined)[]): string[] {
  return [...new Set(v.map(e => (typeof e === 'string' ? e.trim().toLowerCase() : '')).filter(e => e.includes('@')))]
}

/** Les traces du passe de ces fiches, clients, adresses et compte Telegram. */
async function lireTraces(db: BaseLecture, o: {
  fiches: string[]; clients: string[]; emails: string[]; telegramId: number | null; abonnements: string[]; quand: Date
}): Promise<Traces> {
  if (o.fiches.length === 0 && o.clients.length === 0 && o.emails.length === 0 && o.telegramId === null) return AUCUNE_TRACE
  const seuil = new Date(o.quand.getTime() - JOURS_TRACE_ANCIENNE * JOUR_MS)
  const seuilFiche = new Date(o.quand.getTime() - JOURS_FICHE_ANCIENNE * JOUR_MS)
  const tid = o.telegramId ?? -1
  const lignes = await db.$queryRaw<{
    abonnements: number; paiements: number; fiche_ancienne: boolean | null; autres_comptes: number; acces: number
  }[]>`
    /* reco:traces */
    select
      (select count(*)::int from public.cockpit_abonnements a
        where (a.membre_id::text = any(${o.fiches}::text[]) or a.client_stripe = any(${o.clients}::text[]))
          and a.abonnement_id <> all(${o.abonnements}::text[])
          and coalesce(a.statut, '') not in ('incomplete', 'incomplete_expired')
          and (a.debut is null or a.debut < ${seuil}::timestamptz)) as abonnements,
      (select count(*)::int from public.cockpit_paiements p
        where p.membre_id::text = any(${o.fiches}::text[]) and p.date_paiement < ${seuil}::timestamptz) as paiements,
      (select bool_or(m.date_entree < ${seuilFiche}::timestamptz) from public.cockpit_membres m
        where m.membre_id::text = any(${o.fiches}::text[])) as fiche_ancienne,
      (select count(distinct r.telegram_id)::int from public.cockpit_liveclub_rattachements r
        join public.cockpit_telegram_membres tm on tm.telegram_id = r.telegram_id
        where r.membre_id::text = any(${o.fiches}::text[]) and r.telegram_id <> ${tid}::bigint) as autres_comptes,
      (select count(*)::int from public.cockpit_liveclub_acces x
        where (lower(x.email) = any(${o.emails}::text[]) or x.telegram_id = ${tid}::bigint) and x.pose_le < ${seuil}::timestamptz)
      + (select count(*)::int from public.cockpit_liveclub_exemptions x
        where (x.telegram_id = ${tid}::bigint or x.membre_id::text = any(${o.fiches}::text[])
               or lower(x.email) = any(${o.emails}::text[])) and x.pose_le < ${seuil}::timestamptz) as acces`
  const l = lignes[0]
  if (!l) return AUCUNE_TRACE
  return {
    abonnementsAnciens: Number(l.abonnements ?? 0),
    paiementsAnciens: Number(l.paiements ?? 0),
    ficheAncienne: l.fiche_ancienne === true,
    autresComptesVus: Number(l.autres_comptes ?? 0),
    accesAnciens: Number(l.acces ?? 0),
  }
}

/**
 * Nouveau, retour ou incertain (reconnaissance-pur.ts). Les identifiants
 * d'abord : le compte Telegram (ses rattachements, meme retires, ses
 * exemptions et acces broker), la fiche donnee, les adresses (et celles des
 * rattachements), le client Stripe ; toutes les fiches qu'ils touchent ; puis
 * les traces de ces fiches. Aucune fiche : le nom complet, sans ambiguite.
 */
export async function reconnaitrePersonne(p: QuiArrive, db: BaseLecture = prisma): Promise<{ verdict: Reconnaissance; indice: Indice }> {
  const telegramId = typeof p.telegramId === 'number' && Number.isSafeInteger(p.telegramId) && p.telegramId > 0 ? p.telegramId : null
  const fiches = new Set<string>(p.membreId && UUID.test(p.membreId) ? [p.membreId] : [])
  const clients = new Set<string>(p.clientStripe && CLIENT.test(p.clientStripe) ? [p.clientStripe] : [])
  const emails = new Set<string>(propresEmails(p.emails ?? []))

  if (telegramId !== null) {
    const ids = await db.$queryRaw<{ membre_id: string | null; client_stripe: string | null; email: string | null }[]>`
      /* reco:identifiants */
      select membre_id::text as membre_id, client_stripe, lower(email) as email
        from public.cockpit_liveclub_rattachements where telegram_id = ${telegramId}::bigint
      union all
      select membre_id::text, null, lower(email) from public.cockpit_liveclub_exemptions where telegram_id = ${telegramId}::bigint
      union all
      select null, null, lower(email) from public.cockpit_liveclub_acces where telegram_id = ${telegramId}::bigint`
    for (const r of ids) {
      if (r.membre_id && UUID.test(r.membre_id)) fiches.add(r.membre_id)
      if (r.client_stripe && CLIENT.test(r.client_stripe)) clients.add(r.client_stripe)
      for (const e of propresEmails([r.email])) emails.add(e)
    }
  }

  if (emails.size > 0 || clients.size > 0) {
    const parAdresse = await db.$queryRaw<{ membre_id: string }[]>`
      /* reco:fiches */
      select distinct e.membre_id::text as membre_id from public.cockpit_membre_emails e
        where lower(e.email) = any(${[...emails]}::text[])
      union
      select distinct a.membre_id::text from public.cockpit_abonnements a
        where a.client_stripe = any(${[...clients]}::text[]) and a.membre_id is not null`
    for (const r of parAdresse) if (r.membre_id && UUID.test(r.membre_id)) fiches.add(r.membre_id)
  }

  const abonnements = p.abonnementId ? [p.abonnementId, `stripe:${p.abonnementId.replace(/^stripe:/, '')}`] : []
  const traces = await lireTraces(db, {
    fiches: [...fiches], clients: [...clients], emails: [...emails], telegramId, abonnements, quand: p.quand,
  })

  let homonymes: { fiches: number; traces: Traces } | null = null
  const cle = fiches.size === 0 ? cleNom(p.nom) : null
  if (cle) {
    const noms = await db.$queryRaw<{ membre_id: string; nom: string | null }[]>`
      /* reco:noms */
      select membre_id::text as membre_id, nom from public.cockpit_membres where nom is not null`
    const memes = [...new Set(noms.filter(n => cleNom(n.nom) === cle).map(n => n.membre_id))]
    homonymes = {
      fiches: memes.length,
      traces: memes.length === 1
        ? await lireTraces(db, { fiches: memes, clients: [], emails: [], telegramId: null, abonnements, quand: p.quand })
        : AUCUNE_TRACE,
    }
  }

  return reconnaitre({ fiches: fiches.size, traces, homonymes })
}

/** Les motifs d'exemption qui disent « l'equipe » (pas un membre favorise). */
export const MOTIFS_EQUIPE = ['fondateur', 'admin', 'equipe'] as const

export type Equipe = { fiches: Set<string>; telegrams: Set<number>; clients: Set<string>; emails: Set<string> }

/**
 * (03/11) L'equipe, par l'ontologie : les comptes Telegram d'une exemption
 * fondateur, admin ou equipe et ceux d'Agent AOK (cockpit_telegram_comptes) ;
 * leurs fiches, par la fiche de l'exemption, son adresse, les rattachements
 * de ces comptes (meme retires) et les adresses du compte AOK d'Agent AOK
 * (profile_emails) ; les clients Stripe de ces fiches. Le cas du 03/11 :
 * l'abonnement personnel de Melanie (sommermelanie@ymail.com, meme fiche que
 * melaniesommer93@yahoo.com) en echec de paiement listait Melanie dans
 * « À contacter » : son compte Telegram n'est rattache a aucune fiche, la vue
 * ne la reconnaissait pas comme exemptee.
 * (03/11, retouche) Aussi les adresses de ces fiches : le resume ecarte
 * l'equipe de TOUTES ses rubriques de membres (horsEquipe, resume-pur.ts).
 */
export async function lireEquipe(db: BaseLecture = prisma): Promise<Equipe> {
  const lignes = await db.$queryRaw<{ membre_id: string | null; telegram_id: bigint | number | null; client_stripe: string | null; email?: string | null }[]>`
    /* reco:equipe */
    with comptes as (
      select x.telegram_id, x.membre_id, lower(x.email) as email from public.cockpit_liveclub_exemptions x
        where x.retire_le is null and x.motif = any(${[...MOTIFS_EQUIPE]}::text[])
      union
      select c.telegram_id, null::uuid, null::text from public.cockpit_telegram_comptes c
    ), fiches as (
      select c.membre_id from comptes c where c.membre_id is not null
      union select e.membre_id from comptes c join public.cockpit_membre_emails e on lower(e.email) = c.email
      union select r.membre_id from comptes c join public.cockpit_liveclub_rattachements r on r.telegram_id = c.telegram_id
        where r.membre_id is not null
      union select e.membre_id from public.cockpit_telegram_comptes c
        join public.profile_emails pe on pe.profile_id = c.user_id
        join public.cockpit_membre_emails e on lower(e.email) = lower(pe.email)
    )
    select null::text as membre_id, c.telegram_id, null::text as client_stripe, null::text as email from comptes c where c.telegram_id is not null
    union all select f.membre_id::text, null, null, null from fiches f
    union all select null, null, a.client_stripe, null from public.cockpit_abonnements a
      where a.client_stripe is not null and a.membre_id in (select membre_id from fiches)
    union all select null, null, null, lower(e.email) from public.cockpit_membre_emails e
      where e.membre_id in (select membre_id from fiches)`
  const equipe: Equipe = { fiches: new Set(), telegrams: new Set(), clients: new Set(), emails: new Set() }
  for (const l of lignes) {
    if (l.membre_id && UUID.test(l.membre_id)) equipe.fiches.add(l.membre_id)
    if (l.telegram_id !== null && l.telegram_id !== undefined) equipe.telegrams.add(Number(l.telegram_id))
    if (l.client_stripe && CLIENT.test(l.client_stripe)) equipe.clients.add(l.client_stripe)
    if (typeof l.email === 'string' && l.email.includes('@')) equipe.emails.add(l.email.trim().toLowerCase())
  }
  return equipe
}
