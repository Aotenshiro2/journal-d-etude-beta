// Rattacher un compte Telegram a son payeur (cockpit_liveclub_rattachements,
// migration 20260929190000, en production). Un seul rattachement actif par
// compte Telegram (index unique partiel) : changer de payeur = poser
// retire_le sur l'ancienne ligne puis inserer, rien ne s'efface.
//
// (15/10, Brice) PLUSIEURS COMPTES TELEGRAM POUR UNE MEME PERSONNE : un seul
// est dans le Live Club a la fois. changerDeCompte fait passer l'abonnement
// d'un compte a un autre (retire_raison 'changement_compte', remplace_par,
// migration 20261015230000), sous le garde-fou des 30 jours. Les regles
// pures sont dans comptes-telegram-pur.ts, le parcours dans comptes-telegram.ts.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { memePayeur, normaliserEmail } from './pur'
import { preuveTelegram } from './adresses-pur'
import { rattacherAdresseSurPreuve } from './adresses'
import { JOURS_GARDE_CHANGEMENT, MAX_CHANGEMENTS_LIBRE_SERVICE, RAISON_CHANGEMENT_COMPTE } from './comptes-telegram-pur'

export { memePayeur }

export type Rattachement = {
  rattachement_id: string
  telegram_id: bigint
  membre_id: string | null
  client_stripe: string | null
  compte: string | null
  email: string | null
  source: 'metricgram' | 'bot' | 'manuel'
  lie_le: Date
}

/** Le client SQL : prisma, ou une transaction. */
type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>

/** Le rattachement actif de ce compte Telegram, ou null. Jette si la base ne repond pas. */
export async function rattachementActif(telegramId: number): Promise<Rattachement | null> {
  const lignes = await prisma.$queryRaw<Rattachement[]>`
    select rattachement_id, telegram_id, membre_id, client_stripe, compte, email, source, lie_le
    from public.cockpit_liveclub_rattachements
    where telegram_id = ${telegramId} and retire_le is null
    limit 1`
  return lignes[0] ?? null
}

/** Le membre (cockpit_membre_emails) qui porte cet email, ou null. */
export async function membreParEmail(email: string): Promise<string | null> {
  const propre = normaliserEmail(email)
  if (!propre) return null
  const lignes = await prisma.$queryRaw<{ membre_id: string }[]>`
    select membre_id from public.cockpit_membre_emails where email = ${propre} limit 1`
  return lignes[0]?.membre_id ?? null
}

export type PayeurRattache = {
  clientStripe?: string | null
  email?: string | null
  membreId?: string | null
  source: 'bot'
}

export type IssueRattachement = {
  rattachementId: string
  /** nouveau = aucun lien avant ; identique = meme payeur (champs vides completes) ; remplace = l'ancien lien est retire. */
  changement: 'nouveau' | 'identique' | 'remplace'
}

/**
 * Pose le lien telegram_id -> payeur. Si un lien actif pointe deja vers le
 * meme payeur, on le garde (sa source aussi, metricgram compris) et on
 * complete ses champs vides. S'il pointe ailleurs, il recoit retire_le et un
 * nouveau lien est insere, dans la meme transaction. Le membre est retrouve
 * par l'email s'il n'est pas donne. Jette si rien ne designe le payeur.
 *
 * MEME PERSONNE, DEUX ADRESSES (Brice, 15/10) : quand le compte passe d'une
 * adresse a une autre et que les DEUX liens viennent d'une preuve de
 * possession (source 'bot' : lien personnel ou code email), les deux
 * adresses sont a la meme personne. L'adresse qui manque est alors ajoutee a
 * son compte AOK et a sa fiche du cockpit (rattacherAdresseSurPreuve,
 * adresses.ts), sauf conflit. Ne change rien a la reponse : une panne y est
 * loggue, jamais renvoyee.
 */
export async function rattacherTelegram(telegramId: number, payeur: PayeurRattache): Promise<IssueRattachement> {
  const nouveau = await preparerPayeur(payeur)
  const issue = await avecRejeu(() => prisma.$transaction(tx => poserDansTransaction(tx, telegramId, nouveau, payeur.source)))
  await adresseSurPreuve(telegramId, issue, payeur.source)
  return { rattachementId: issue.rattachementId, changement: issue.changement }
}

type IssuePose = IssueRattachement & {
  /** Le lien retire par ce changement de payeur ('remplace' seulement). */
  ancien: Rattachement | null
  email: string | null
  clientStripe: string | null
}

type PayeurPrepare = { clientStripe: string | null; email: string | null; membreId: string | null }

async function preparerPayeur(payeur: Omit<PayeurRattache, 'source'>): Promise<PayeurPrepare> {
  const clientStripe = payeur.clientStripe?.trim() || null
  const email = payeur.email ? normaliserEmail(payeur.email) : null
  let membreId = payeur.membreId ?? null
  if (!clientStripe && !email && !membreId) throw new Error('Rattachement sans payeur : ni client Stripe, ni email, ni membre.')
  if (!membreId && email) membreId = await membreParEmail(email)
  return { clientStripe, email, membreId }
}

/** Le lien du compte, pose dans une transaction deja ouverte (verrou sur son lien actif). */
async function poserDansTransaction(tx: Db, telegramId: number, nouveau: PayeurPrepare, source: PayeurRattache['source']): Promise<IssuePose> {
  const { clientStripe, email, membreId } = nouveau
  const compte = clientStripe ? 'melanie' : null
  const actifs = await tx.$queryRaw<Rattachement[]>`
    select rattachement_id, telegram_id, membre_id, client_stripe, compte, email, source, lie_le
    from public.cockpit_liveclub_rattachements
    where telegram_id = ${telegramId} and retire_le is null
    for update`
  const ancien = actifs[0]
  if (ancien && memePayeur(ancien, nouveau)) {
    await tx.$executeRaw`
      update public.cockpit_liveclub_rattachements set
        client_stripe = coalesce(client_stripe, ${clientStripe}),
        compte = coalesce(compte, ${compte}),
        email = coalesce(email, ${email}),
        membre_id = coalesce(membre_id, ${membreId}::uuid)
      where rattachement_id = ${ancien.rattachement_id}::uuid`
    return { rattachementId: ancien.rattachement_id, changement: 'identique', ancien: null, email, clientStripe }
  }
  if (ancien) {
    await tx.$executeRaw`
      update public.cockpit_liveclub_rattachements set retire_le = now()
      where rattachement_id = ${ancien.rattachement_id}::uuid`
  }
  const inseres = await tx.$queryRaw<{ rattachement_id: string }[]>`
    insert into public.cockpit_liveclub_rattachements
      (telegram_id, membre_id, client_stripe, compte, email, source)
    values (${telegramId}, ${membreId}::uuid, ${clientStripe}, ${compte}, ${email}, ${source})
    returning rattachement_id`
  return {
    rattachementId: inseres[0].rattachement_id,
    changement: ancien ? 'remplace' : 'nouveau',
    ancien: ancien ?? null,
    email, clientStripe,
  }
}

/**
 * Deux updates Telegram simultanes pour le meme compte : l'un gagne l'index
 * unique partiel (23505), on rejoue une fois, il voit alors le lien pose par
 * l'autre.
 */
async function avecRejeu<T>(essai: () => Promise<T>): Promise<T> {
  try {
    return await essai()
  } catch (err) {
    if (/23505|unique constraint/i.test(err instanceof Error ? err.message : String(err))) return essai()
    throw err
  }
}

/** Le compte passe d'une adresse a une autre, les deux fois par preuve : l'adresse qui manque va a la personne. */
async function adresseSurPreuve(telegramId: number, issue: IssuePose, source: PayeurRattache['source']): Promise<void> {
  const preuve = issue.ancien ? preuveTelegram(issue.ancien, { email: issue.email, source }) : null
  if (preuve && issue.ancien) {
    await rattacherAdresseSurPreuve({
      preuve: 'telegram',
      telegramId,
      ancien: { rattachementId: issue.ancien.rattachement_id, email: preuve.ancienne, clientStripe: issue.ancien.client_stripe },
      nouveau: { rattachementId: issue.rattachementId, email: preuve.nouvelle, clientStripe: issue.clientStripe },
    })
  }
}

// ---------------------------------------------------------------------------
// (15/10) Plusieurs comptes Telegram pour une meme personne
// ---------------------------------------------------------------------------

/**
 * Les rattachements ACTIFS d'AUTRES comptes Telegram sur ce payeur : son
 * adresse, ou l'un de ses clients Stripe. `verrou` : FOR UPDATE (dans une
 * transaction). Jette si la base ne repond pas.
 */
export async function autresComptesDuPayeur(
  telegramId: number,
  email: string,
  clients: readonly string[],
  db: Db = prisma,
  verrou = false,
): Promise<Rattachement[]> {
  return db.$queryRaw<Rattachement[]>`
    select rattachement_id, telegram_id, membre_id, client_stripe, compte, email, source, lie_le
    from public.cockpit_liveclub_rattachements
    where retire_le is null and telegram_id <> ${telegramId}
      and (lower(email) = ${email}
        or (client_stripe is not null and client_stripe = any(${[...clients]}::text[])))
    order by lie_le
    ${verrou ? Prisma.sql`for update` : Prisma.empty}`
}

/**
 * Les changements de compte faits par le bot pour ce payeur dans les 30
 * derniers jours : les comptes DISTINCTS qui ont pris la place d'un autre (un
 * changement qui retire deux anciens liens compte pour un). Jette, colonne
 * absente comprise (migration 20261015230000 pas appliquee) : l'appelant en
 * fait un « on ne sait pas », jamais un libre-service.
 */
export async function changementsRecents(email: string, clients: readonly string[], db: Db = prisma): Promise<number> {
  const lignes = await db.$queryRaw<{ n: number }[]>`
    select count(distinct remplace_par)::int as n
    from public.cockpit_liveclub_rattachements
    where retire_raison = ${RAISON_CHANGEMENT_COMPTE}
      and retire_le > now() - make_interval(days => ${JOURS_GARDE_CHANGEMENT}::int)
      and (lower(email) = ${email}
        or (client_stripe is not null and client_stripe = any(${[...clients]}::text[])))`
  return lignes[0]?.n ?? 0
}

export type IssueChangementCompte =
  | {
    etat: 'fait'
    /** Le lien du nouveau compte. */
    rattachementId: string
    /** Les liens retires (anciens comptes), avec leur telegram_id. */
    anciens: Rattachement[]
    /** Le membre du cockpit du payeur, s'il est connu. */
    membreId: string | null
  }
  /** Garde-fou atteint : rien n'a change. */
  | { etat: 'garde'; anciens: Rattachement[]; membreId: string | null }

/**
 * Fait passer l'abonnement de ce payeur sur CE compte Telegram, en UNE
 * transaction : verrou sur le payeur (son adresse), garde-fou relu
 * (changementsRecents), liens actifs des autres comptes retires (retire_le,
 * retire_raison 'changement_compte', remplace_par = ce compte), puis le lien
 * de ce compte pose (rattacherTelegram, meme regle). Rien n'est retire si le
 * garde-fou est atteint. Personne d'autre sur le payeur : le lien est pose,
 * anciens vide. Jette sur une panne (colonne absente comprise) : rien n'a
 * change.
 *
 * La sortie du groupe des anciens comptes, les messages et le journal sont
 * faits par l'appelant (comptes-telegram.ts), apres la transaction.
 */
export async function changerDeCompte(
  telegramId: number,
  payeur: { email: string; clients: readonly string[]; clientStripe: string | null },
): Promise<IssueChangementCompte> {
  const email = normaliserEmail(payeur.email)
  if (!email) throw new Error('Changement de compte sans adresse lisible.')
  const nouveau = await preparerPayeur({ clientStripe: payeur.clientStripe, email })

  const issue = await avecRejeu(() => prisma.$transaction(async tx => {
    // Deux changements simultanes sur le meme payeur se suivent.
    await tx.$queryRaw`
      select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`payeur:${email}`}::text, 0))) as verrou`
    const deja = await changementsRecents(email, payeur.clients, tx)
    const anciens = await autresComptesDuPayeur(telegramId, email, payeur.clients, tx, true)
    if (anciens.length > 0 && deja >= MAX_CHANGEMENTS_LIBRE_SERVICE) {
      return { etat: 'garde' as const, anciens, pose: null }
    }
    for (const a of anciens) {
      await tx.$executeRaw`
        update public.cockpit_liveclub_rattachements
        set retire_le = now(), retire_raison = ${RAISON_CHANGEMENT_COMPTE}, remplace_par = ${telegramId}
        where rattachement_id = ${a.rattachement_id}::uuid and retire_le is null`
    }
    const pose = await poserDansTransaction(tx, telegramId, nouveau, 'bot')
    return { etat: 'fait' as const, anciens, pose }
  }))

  if (issue.etat === 'garde' || !issue.pose) return { etat: 'garde', anciens: issue.anciens, membreId: nouveau.membreId }
  await adresseSurPreuve(telegramId, issue.pose, 'bot')
  return { etat: 'fait', rattachementId: issue.pose.rattachementId, anciens: issue.anciens, membreId: nouveau.membreId }
}
