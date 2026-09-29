// Rattacher un compte Telegram a son payeur (cockpit_liveclub_rattachements,
// migration 20260929190000, en production). Un seul rattachement actif par
// compte Telegram (index unique partiel) : changer de payeur = poser
// retire_le sur l'ancienne ligne puis inserer, rien ne s'efface.

import { prisma } from '@/lib/db'
import { memePayeur, normaliserEmail } from './pur'

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
 */
export async function rattacherTelegram(telegramId: number, payeur: PayeurRattache): Promise<IssueRattachement> {
  const clientStripe = payeur.clientStripe?.trim() || null
  const email = payeur.email ? normaliserEmail(payeur.email) : null
  let membreId = payeur.membreId ?? null
  if (!clientStripe && !email && !membreId) throw new Error('Rattachement sans payeur : ni client Stripe, ni email, ni membre.')
  if (!membreId && email) membreId = await membreParEmail(email)
  const compte = clientStripe ? 'melanie' : null
  const nouveau = { clientStripe, email, membreId }

  const essai = () => prisma.$transaction(async tx => {
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
      return { rattachementId: ancien.rattachement_id, changement: 'identique' as const }
    }
    if (ancien) {
      await tx.$executeRaw`
        update public.cockpit_liveclub_rattachements set retire_le = now()
        where rattachement_id = ${ancien.rattachement_id}::uuid`
    }
    const inseres = await tx.$queryRaw<{ rattachement_id: string }[]>`
      insert into public.cockpit_liveclub_rattachements
        (telegram_id, membre_id, client_stripe, compte, email, source)
      values (${telegramId}, ${membreId}::uuid, ${clientStripe}, ${compte}, ${email}, ${payeur.source})
      returning rattachement_id`
    return { rattachementId: inseres[0].rattachement_id, changement: ancien ? 'remplace' as const : 'nouveau' as const }
  })

  try {
    return await essai()
  } catch (err) {
    // Deux updates Telegram simultanes pour le meme compte : l'un gagne
    // l'index unique partiel (23505), on rejoue une fois, il voit alors le
    // lien pose par l'autre.
    if (/23505|unique constraint/i.test(err instanceof Error ? err.message : String(err))) return essai()
    throw err
  }
}
