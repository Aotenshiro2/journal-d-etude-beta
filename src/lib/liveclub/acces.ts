// Acces broker au Live Club (affiliation RaiseFx, 29/09). Melanie colle des
// emails dans le cockpit (formulaire ou agent) : chacun recoit 6 mois
// d'acces a partir du jour de l'ajout, UNE SEULE FOIS (index unique
// (lower(email), motif), migration 20260929200100 : une ligne, meme retiree
// ou terminee, bloque un second acces). L'email part de support@ avec le
// lien personnel vers le bot ; l'entree suit le meme parcours qu'un abonne.
//
// Appele par POST /api/cockpit/liveclub/acces (acteur 'cockpit:<uuid>') et
// par l'action 'acces_broker' de l'agent du cockpit (acteur 'agent:<qui>').

import { prisma } from '@/lib/db'
import { journaliserGesteLiveClub } from '@/lib/stripe-actions'
import { cleStripeLecture, lienBot, MOIS_ACCES_BROKER } from './config'
import { creerJeton, jetonExistant } from './jetons'
import { emailAccesBroker } from './emails'
import { abonnementsLiveClubParEmail } from './stripe'
import { abonnementOuvreLeGroupe, dateIso, joursEntre, messageErreur, normaliserEmail, relationAbsente } from './pur'

export const MAX_EMAILS_PAR_LOT = 50

/**
 * Ce qui manque pour accorder un acces broker, ou null si tout est la. Un
 * acces n'est pas renouvelable : l'accorder alors que l'email ne peut pas
 * partir le brulerait sans que la personne le sache. Les deux surfaces
 * (route du cockpit, carte de l'agent) refusent donc AVANT, sur ce message.
 */
export function prerequisAccesBroker(): string | null {
  const manque: string[] = []
  if (!(process.env.RESEND_API_KEY_LIVECLUB?.trim() || process.env.RESEND_API_KEY?.trim())) {
    manque.push('RESEND_API_KEY_LIVECLUB (ou RESEND_API_KEY)')
  }
  if (!cleStripeLecture()) manque.push('STRIPE_READ_KEY_MELANIE (ou STRIPE_AGENT_KEY_MELANIE)')
  return manque.length
    ? `Accès broker impossible pour l'instant, rien n'a été accordé : ${manque.join(' et ')} absente(s) du projet journal.`
    : null
}

export type ResultatAccesBroker = {
  /** L'email tel que traite (minuscules), ou tel que colle s'il est invalide. */
  email: string
  resultat: 'accorde' | 'deja_accorde' | 'deja_abonne' | 'invalide' | 'echec'
  /** 'YYYY-MM-DD' : fin de l'acces accorde, ou de l'acces deja accorde. */
  jusquau?: string
  /** accorde seulement : l'email d'invitation est-il parti ? */
  emailEnvoye?: boolean
  /**
   * accorde seulement : l'acces existait deja (rien n'est prolonge), mais son
   * invitation n'etait jamais partie ; ce collage l'a renvoyee (ou retentee).
   */
  renvoi?: boolean
  /** echec, ou accorde sans email : pourquoi (sans donnee personnelle). */
  erreur?: string
}

/**
 * Un lot d'emails -> un resultat par email, dans l'ordre (doublons du lot
 * retires). Jette seulement si le lot est vide ou depasse 50.
 */
export async function accorderAccesBroker(
  emails: string[],
  options: { acteur: string; note?: string | null },
): Promise<ResultatAccesBroker[]> {
  if (!Array.isArray(emails) || emails.length === 0) throw new Error('Aucun email a traiter.')
  if (emails.length > MAX_EMAILS_PAR_LOT) throw new Error(`${MAX_EMAILS_PAR_LOT} emails au plus par lot.`)
  const note = options.note?.trim().slice(0, 500) || null

  // D'abord le tri (invalides, doublons du lot), dans l'ordre du collage.
  const vus = new Set<string>()
  const resultats: (ResultatAccesBroker | null)[] = []
  const aTraiter: { rang: number; email: string }[] = []
  for (const brut of emails) {
    const email = normaliserEmail(brut)
    if (!email) {
      resultats.push({ email: String(brut ?? '').trim().slice(0, 254), resultat: 'invalide' })
      continue
    }
    if (vus.has(email)) continue
    vus.add(email)
    aTraiter.push({ rang: resultats.length, email })
    resultats.push(null)
  }

  // Puis les acces, CONCURRENCE_LOT a la fois : 50 adresses une par une
  // (base, Stripe, Resend) frolent la limite de duree d'une fonction. Pas
  // plus de 2 a la fois : Resend limite a quelques envois par seconde.
  let suivant = 0
  const ouvrier = async () => {
    while (suivant < aTraiter.length) {
      const { rang, email } = aTraiter[suivant++]
      try {
        resultats[rang] = await accorderUn(email, options.acteur, note)
      } catch (err) {
        resultats[rang] = { email, resultat: 'echec', erreur: messageErreur(err) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCE_LOT, aTraiter.length) }, ouvrier))
  return resultats.filter((r): r is ResultatAccesBroker => r !== null)
}

const CONCURRENCE_LOT = 2

async function accorderUn(email: string, acteur: string, note: string | null): Promise<ResultatAccesBroker> {
  // 1. Non renouvelable : une ligne broker existe deja (active ou non). Une
  //    exception : l'acces est en cours mais son invitation n'est jamais
  //    partie (Resend en panne, table des jetons absente) et personne ne l'a
  //    encore utilise. Recoller l'email RENVOIE alors l'invitation, sans
  //    rien prolonger : sinon les 6 mois s'ecoulent sans que la personne
  //    puisse entrer, et Melanie n'a aucun autre moyen de la relancer.
  try {
    const deja = await prisma.$queryRaw<LigneAccesExistant[]>`
      select acces_id, jusquau,
        (retire_le is null and sorti_le is null and jusquau >= current_date
          and invite_envoyee_le is null and telegram_id is null) as a_relancer
      from public.cockpit_liveclub_acces
      where lower(email) = ${email} and motif = 'broker'
      limit 1`
    if (deja[0]) {
      const jusquau = dateIso(deja[0].jusquau)
      if (!deja[0].a_relancer) return { email, resultat: 'deja_accorde', jusquau }
      const envoi = await envoyerInvitation(deja[0].acces_id, email, jusquau)
      if (envoi.deja) return { email, resultat: 'deja_accorde', jusquau }
      await journaliserGesteLiveClub(
        {
          geste: 'invitation', resultat: envoi.emailEnvoye ? 'fait' : 'echec', regle: 'broker_renvoi',
          details: { acces_id: deja[0].acces_id, jusquau },
        },
        { telegramId: null, acteur },
      )
      return {
        email, resultat: 'accorde', jusquau, renvoi: true, emailEnvoye: envoi.emailEnvoye,
        ...(envoi.erreur ? { erreur: envoi.erreur } : {}),
      }
    }
  } catch (err) {
    return { email, resultat: 'echec', erreur: erreurBase(err) }
  }

  // 2. Deja abonne : on n'accorde pas (l'acces ne servirait qu'une fois, et
  //    le brulerait). Stripe illisible = echec, a refaire plus tard.
  try {
    const abonnements = await abonnementsLiveClubParEmail(email)
    if (abonnements.some(abonnementOuvreLeGroupe)) return { email, resultat: 'deja_abonne' }
  } catch (err) {
    return { email, resultat: 'echec', erreur: `Stripe illisible, rien n'a ete accorde : ${messageErreur(err)}` }
  }

  // 3. L'acces. on conflict = une course avec un autre lot : deja accorde.
  let accesId: string
  let jusquau: string
  try {
    const lignes = await prisma.$queryRaw<{ acces_id: string; jusquau: Date }[]>`
      insert into public.cockpit_liveclub_acces (email, motif, source, debut, jusquau, pose_par, note)
      values (${email}, 'broker', 'raisefx', current_date,
              (current_date + make_interval(months => ${MOIS_ACCES_BROKER}::int))::date, ${acteur}, ${note})
      on conflict do nothing
      returning acces_id, jusquau`
    if (!lignes[0]) return { email, resultat: 'deja_accorde' }
    accesId = lignes[0].acces_id
    jusquau = dateIso(lignes[0].jusquau)
  } catch (err) {
    return { email, resultat: 'echec', erreur: erreurBase(err) }
  }

  // 4. Le jeton et l'email. L'acces reste accorde meme si l'email ne part
  //    pas : invite_envoyee_le reste vide, et recoller l'email le renverra.
  const { emailEnvoye, erreur } = await envoyerInvitation(accesId, email, jusquau)

  await journaliserGesteLiveClub(
    { geste: 'acces_broker', resultat: 'fait', regle: 'broker', details: { acces_id: accesId, jusquau, email_envoye: emailEnvoye } },
    { telegramId: null, acteur },
  )
  return { email, resultat: 'accorde', jusquau, emailEnvoye, ...(erreur ? { erreur } : {}) }
}

type LigneAccesExistant = { acces_id: string; jusquau: Date; a_relancer: boolean }

/**
 * Envoie l'invitation d'un acces broker. invite_envoyee_le est RESERVE avant
 * l'envoi, en un update atomique (deux collages simultanes n'envoient qu'un
 * email), et rendu vide si l'envoi echoue. deja = un autre appel a envoye,
 * ou l'acces n'est plus a relancer (utilise, retire, sorti). Le jeton,
 * valable jusqu'a la fin de l'acces, est reutilise s'il existe deja.
 */
async function envoyerInvitation(
  accesId: string, email: string, jusquau: string,
): Promise<{ emailEnvoye: boolean; deja?: boolean; erreur?: string }> {
  let reserve: { acces_id: string }[]
  try {
    reserve = await prisma.$queryRaw<{ acces_id: string }[]>`
      update public.cockpit_liveclub_acces set invite_envoyee_le = now()
      where acces_id = ${accesId}::uuid and invite_envoyee_le is null and telegram_id is null
        and retire_le is null and sorti_le is null
      returning acces_id`
  } catch (err) {
    return { emailEnvoye: false, erreur: `Acces accorde, invitation pas preparee : ${messageErreur(err)}` }
  }
  if (!reserve[0]) return { emailEnvoye: false, deja: true }

  let erreur: string
  try {
    const jeton = (await jetonExistant({ accesId, usage: 'entree' }))
      ?? await creerJeton({ usage: 'entree', accesId, email }, joursEntre(new Date(), jusquau) + 1)
    const envoi = await emailAccesBroker(email, lienBot(jeton), jusquau)
    if (envoi.ok) return { emailEnvoye: true }
    erreur = `Acces accorde, email pas parti : ${envoi.erreur}`
  } catch (err) {
    erreur = `Acces accorde, invitation pas preparee : ${messageErreur(err)}`
  }
  try {
    await prisma.$executeRaw`
      update public.cockpit_liveclub_acces set invite_envoyee_le = null where acces_id = ${accesId}::uuid`
  } catch (err) {
    console.warn(`[liveclub/acces] reservation d'invitation pas rendue : ${messageErreur(err)}`)
  }
  return { emailEnvoye: false, erreur }
}

function erreurBase(err: unknown): string {
  return relationAbsente(err)
    ? 'Table cockpit_liveclub_acces absente (migration 20260929200100 pas appliquee).'
    : messageErreur(err)
}
