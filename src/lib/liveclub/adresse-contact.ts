// (31/10) Le SERVEUR de l'adresse de contact d'un acces broker : le controle
// avant la carte d'Agent AOK, et l'execution au clic. Regles et textes :
// adresse-contact-pur.ts ; lectures pour les envois : adresse-contact-lecture.ts.
//
// Au clic, EN UNE TRANSACTION : l'acces verrouille et relu, la nouvelle
// adresse verrouillee (deux cartes simultanees ne la posent pas sur deux
// acces), les refus refaits, l'ancienne adresse retiree et la nouvelle posee
// (les deux restent dans la table, avec qui et quand), l'invitation remise
// « pas envoyee » si le lien n'a pas servi, et une ligne au journal (geste
// 'acces_broker', regle 'adresse_contact', sans adresse). L'adresse de l'acces
// (celle du broker), acces_id, dates, commission, lots, jeton et compte
// Telegram ne bougent pas. Puis, si le lien n'a pas servi, l'invitation part a
// l'adresse de contact (envoyerInvitation, acces.ts : meme jeton, meme lien).
//
// Jamais d'adresse dans un log ni dans le journal.

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { RefusAction, journaliserGesteLiveClub, type ActionAgent } from '@/lib/stripe-actions'
import { envoyerInvitation } from './acces'
import { adresseCommunicationsCompte } from './adresse-envoi'
import { tracerGeste } from './support-pont'
import { messageErreur } from './pur'
import {
  REGLE_INVITATION_CONTACT, REGLE_JOURNAL_CONTACT, TEXTE_TABLE_ABSENTE, TYPE_ADRESSE_CONTACT,
  carteAdresseContact, carteCourteAdresseContact, destinationApres, invitationAEnvoyer, lireParamsAdresseContact, refusAdresseContact,
  renvoiSeul, resultatAdresseContact, tableContactsAbsente,
  type DepotLu, type IssueInvitationContact, type LectureContact, type ParamsAdresseContact, type UsageAilleurs,
} from './adresse-contact-pur'

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>

type LigneAcces = {
  acces_id: string; email: string; debut: string; jusquau: string; telegram_id: bigint | null
  invite_envoyee: boolean; retire: boolean; sorti: boolean; fini: boolean; jeton_servi: boolean
}

/** L'acces broker de cette adresse (celle du broker), sans contact ni depots. */
async function lireAcces(db: Db, emailAcces: string): Promise<Omit<LectureContact, 'contact' | 'depots'> | null> {
  const l = await db.$queryRaw<LigneAcces[]>`
    select a.acces_id::text as acces_id, lower(a.email) as email,
      to_char(a.debut, 'YYYY-MM-DD') as debut, to_char(a.jusquau, 'YYYY-MM-DD') as jusquau,
      a.telegram_id, (a.invite_envoyee_le is not null) as invite_envoyee,
      (a.retire_le is not null) as retire, (a.sorti_le is not null) as sorti, (a.jusquau < current_date) as fini,
      exists (select 1 from public.cockpit_liveclub_jetons j
              where j.acces_id = a.acces_id and j.utilise_le is not null) as jeton_servi
    from public.cockpit_liveclub_acces a
    where lower(a.email) = ${emailAcces} and a.motif = 'broker'
    limit 1`
  const x = l[0]
  if (!x) return null
  return {
    accesId: x.acces_id, email: x.email, debut: x.debut, jusquau: x.jusquau,
    telegramId: x.telegram_id === null ? null : Number(x.telegram_id),
    inviteEnvoyee: x.invite_envoyee === true, retire: x.retire === true, sorti: x.sorti === true,
    fini: x.fini === true, jetonServi: x.jeton_servi === true,
  }
}

/** L'adresse de contact en cours. Jette si la table manque (l'appelant le dit). */
async function contactEnCours(db: Db, accesId: string): Promise<string | null> {
  const l = await db.$queryRaw<{ email: string }[]>`
    select email from public.cockpit_liveclub_acces_contacts
    where acces_id = ${accesId}::uuid and retire_le is null
    limit 1`
  return l[0]?.email ?? null
}

/** Les depots inscrits sur l'acces et leur commission (5 au plus), pour la carte. */
async function depotsDe(db: Db, accesId: string): Promise<DepotLu[]> {
  const l = await db.$queryRaw<{
    partenaire: string; montant: number; le: string; commission: number; statut: string
    lots_faits_le: string | null; montant_recu: number | null; recue_le: string | null
  }[]>`
    select coalesce(p.nom, c.partenaire_id) as partenaire, c.montant_base::float8 as montant,
      to_char(c.le, 'YYYY-MM-DD') as le, c.commission_attendue::float8 as commission, c.statut,
      to_char(c.lots_faits_le, 'YYYY-MM-DD') as lots_faits_le, c.montant_recu::float8 as montant_recu,
      to_char(c.recue_le, 'YYYY-MM-DD') as recue_le
    from public.cockpit_commissions c
    left join public.cockpit_partenaires p on p.partenaire_id = c.partenaire_id
    where c.acces_id = ${accesId}::uuid and c.nature = 'depot'
    order by c.le, c.pose_le
    limit 5`
  return l.map(d => ({
    partenaire: d.partenaire, montant: Number(d.montant), le: d.le, commission: Number(d.commission),
    statut: d.statut === 'recue' || d.statut === 'perdue' ? d.statut : 'attendue',
    lotsFaitsLe: d.lots_faits_le, montantRecu: d.montant_recu === null ? null : Number(d.montant_recu), recueLe: d.recue_le,
  }))
}

/** La nouvelle adresse est-elle l'adresse d'un AUTRE acces broker, ou l'adresse de contact d'un autre ? */
async function usageAilleurs(db: Db, contact: string, accesId: string): Promise<UsageAilleurs> {
  const l = await db.$queryRaw<{ acces_ailleurs: boolean; contact_ailleurs: boolean }[]>`
    select
      exists (select 1 from public.cockpit_liveclub_acces
              where lower(email) = ${contact} and motif = 'broker' and acces_id <> ${accesId}::uuid) as acces_ailleurs,
      exists (select 1 from public.cockpit_liveclub_acces_contacts
              where email = ${contact} and retire_le is null and acces_id <> ${accesId}::uuid) as contact_ailleurs`
  return { accesAilleurs: l[0]?.acces_ailleurs === true, contactAilleurs: l[0]?.contact_ailleurs === true }
}

function resendPresent(): boolean {
  return Boolean(process.env.RESEND_API_KEY_LIVECLUB?.trim() || process.env.RESEND_API_KEY?.trim())
}

export type ControleContact =
  | { erreur: string }
  | { action: ActionAgent; carte: string; court: string; manque: string | null }

/**
 * Le controle AVANT la carte (lecture seule) : l'acces de l'adresse du broker,
 * son adresse de contact, ses depots, ce qui partira. Un refus retourne au
 * modele, qui le dit tel quel. La carte est composee ici (longue pour Brice,
 * courte pour Melanie) ; acces_id, contact_avant et invitation sont poses ici,
 * et relus au clic.
 */
export async function controlerAdresseContact(action: ActionAgent): Promise<ControleContact> {
  const p = lireParamsAdresseContact(action.params)
  if (typeof p === 'string') return { erreur: p }
  const acces = await lireAcces(prisma, p.email_acces)
  if (!acces) return { erreur: refusAdresseContact(p, null, null) as string }
  let contact: string | null
  try {
    contact = await contactEnCours(prisma, acces.accesId)
  } catch (err) {
    if (tableContactsAbsente(err)) return { erreur: TEXTE_TABLE_ABSENTE }
    throw err
  }
  const lecture: LectureContact = {
    ...acces, contact, depots: await depotsDe(prisma, acces.accesId),
    // (31/10) Son choix dans Mon espace passe avant l'adresse de contact : la carte le dit.
    communications: await adresseCommunicationsCompte(acces.email),
  }
  const ailleurs = p.adresse_contact ? await usageAilleurs(prisma, p.adresse_contact, acces.accesId) : null
  const refus = refusAdresseContact(p, lecture, ailleurs)
  if (refus) return { erreur: refus }
  const invitation = invitationAEnvoyer(p, lecture)
  const params: ParamsAdresseContact = {
    ...p, acces_id: acces.accesId, contact_avant: contact, invitation, envoi_vers: destinationApres(p, lecture),
  }
  return {
    action: { type: TYPE_ADRESSE_CONTACT, compte: 'cockpit', params },
    carte: carteAdresseContact(params, lecture),
    court: carteCourteAdresseContact(params),
    manque: invitation && !resendPresent()
      ? "RESEND_API_KEY_LIVECLUB (ou RESEND_API_KEY) absente du projet journal : l'invitation ne pourrait pas partir. Rien n'est fait."
      : null,
  }
}

type IssueTransaction = {
  lecture: Omit<LectureContact, 'depots'>
  renvoi: boolean
  invitation: boolean
  details: Record<string, unknown> | null
}

/** L'execution au clic (executerAction, stripe-actions.ts). Jette RefusAction si une regle bloque : rien n'est change. */
export async function executerAdresseContact(a: ActionAgent, acteur: string): Promise<string> {
  const p = lireParamsAdresseContact(a.params)
  if (typeof p === 'string') throw new RefusAction(p)
  if (!p.acces_id || !('contact_avant' in p)) {
    throw new RefusAction("Carte sans lecture de l'accès : redemande-la, rien n'a été changé.")
  }
  if (p.invitation === true && !resendPresent()) {
    throw new Error("RESEND_API_KEY_LIVECLUB (ou RESEND_API_KEY) absente du projet journal : rien n'a été changé.")
  }

  let issue: IssueTransaction
  try {
    issue = await prisma.$transaction(async (tx): Promise<IssueTransaction> => {
      // L'acces verrouille, puis la nouvelle adresse (une adresse = un seul acces a la fois).
      const verrou = await tx.$queryRaw<{ acces_id: string }[]>`
        select acces_id::text as acces_id from public.cockpit_liveclub_acces
        where lower(email) = ${p.email_acces} and motif = 'broker'
        for update`
      if (p.adresse_contact) {
        await tx.$queryRaw`
          select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${`liveclub:contact:${p.adresse_contact}`}::text, 0))) as verrou`
      }
      const acces = verrou[0] ? await lireAcces(tx, p.email_acces) : null
      if (!acces) throw new RefusAction(refusAdresseContact(p, null, null) as string)
      const contact = await contactEnCours(tx, acces.accesId)
      const lecture = { ...acces, contact }
      const ailleurs = p.adresse_contact ? await usageAilleurs(tx, p.adresse_contact, acces.accesId) : null
      const refus = refusAdresseContact(p, { ...lecture, depots: [] }, ailleurs)
      if (refus) throw new RefusAction(refus)
      if (acces.accesId !== p.acces_id) throw new RefusAction("L'accès n'est plus celui de la carte : redemande-la, rien n'a été changé.")
      if ((p.contact_avant ?? null) !== contact) {
        throw new RefusAction(`L'adresse de contact a changé depuis la carte (maintenant : ${contact ?? 'aucune'}) : redemande-la, rien n'a été changé.`)
      }
      const renvoi = renvoiSeul(p, { ...lecture, depots: [] })
      const invitation = invitationAEnvoyer(p, { ...lecture, depots: [] })
      if (renvoi) return { lecture, renvoi, invitation, details: null }

      const retirees = await tx.$queryRaw<{ contact_id: string }[]>`
        update public.cockpit_liveclub_acces_contacts set retire_le = now(), retire_par = ${acteur}
        where acces_id = ${acces.accesId}::uuid and retire_le is null
        returning contact_id::text as contact_id`
      let nouveau: string | null = null
      if (!p.retirer) {
        const poses = await tx.$queryRaw<{ contact_id: string }[]>`
          insert into public.cockpit_liveclub_acces_contacts (acces_id, email, raison, pose_par)
          values (${acces.accesId}::uuid, ${p.adresse_contact}, ${p.raison}, ${acteur})
          returning contact_id::text as contact_id`
        nouveau = poses[0]?.contact_id ?? null
      }
      // Le lien n'a pas servi : l'invitation repasse « pas envoyee », elle part juste apres.
      if (invitation) {
        await tx.$executeRaw`
          update public.cockpit_liveclub_acces a set invite_envoyee_le = null
          where a.acces_id = ${acces.accesId}::uuid and a.telegram_id is null
            and a.retire_le is null and a.sorti_le is null
            and not exists (
              select 1 from public.cockpit_liveclub_jetons j where j.acces_id = a.acces_id and j.utilise_le is not null)`
      }
      const details = {
        acces_id: acces.accesId,
        quoi: p.retirer ? 'retrait' : contact ? 'change' : 'pose',
        contact_id: nouveau, contact_avant_id: retirees[0]?.contact_id ?? null,
        invitation: invitation ? 'a_envoyer' : 'sans', raison: p.raison ? 'oui' : 'non',
      }
      // Le journal dans la meme transaction : sans lui, rien n'est change.
      await tx.$executeRaw`
        insert into public.cockpit_liveclub_gestes (telegram_id, geste, resultat, acteur, regle, details)
        values (${acces.telegramId}::bigint, 'acces_broker', 'fait', ${acteur}, ${REGLE_JOURNAL_CONTACT},
                ${JSON.stringify(details)}::jsonb)`
      return { lecture, renvoi, invitation, details }
    })
  } catch (err) {
    if (err instanceof RefusAction) throw err
    if (tableContactsAbsente(err)) throw new RefusAction(TEXTE_TABLE_ABSENTE)
    // Deux cartes simultanees sur la meme adresse : l'index unique tranche.
    if (/23505|cockpit_liveclub_acces_contacts_(email|acces)_idx/.test(messageErreur(err))) {
      throw new RefusAction(`${p.adresse_contact ?? "L'adresse"} est déjà l'adresse de contact d'un accès broker (carte confirmée en même temps) : rien n'a été changé.`)
    }
    throw err
  }

  const { lecture } = issue
  // Au fil Support du membre (s'il est relie) : une ligne courte, sans adresse. Ne jette pas.
  if (issue.details && lecture.telegramId !== null) {
    await tracerGeste(lecture.telegramId, { geste: 'acces_broker', resultat: 'fait', regle: REGLE_JOURNAL_CONTACT, details: issue.details })
  }

  // L'invitation, apres la transaction : meme jeton, meme lien, a l'adresse
  // d'envoi (adresse-envoi.ts : son choix dans Mon espace, sinon l'adresse de contact).
  let invitation: IssueInvitationContact = 'sans'
  let erreur: string | null = null
  const contact = p.retirer ? null : p.adresse_contact
  let destination = destinationApres(p, { email: lecture.email, communications: await adresseCommunicationsCompte(lecture.email) })
  if (issue.invitation && contact) {
    const envoi = await envoyerInvitation(lecture.accesId, lecture.email, lecture.jusquau)
    if (envoi.destination) destination = envoi.destination
    invitation = envoi.emailEnvoye ? 'partie' : 'pas_partie'
    erreur = envoi.emailEnvoye ? null : envoi.deja
      ? "un autre envoi était en cours, ou l'accès n'attend plus d'invitation"
      : envoi.erreur ?? null
    await journaliserGesteLiveClub(
      {
        geste: 'invitation', resultat: envoi.emailEnvoye ? 'fait' : 'echec', regle: REGLE_INVITATION_CONTACT,
        details: { acces_id: lecture.accesId, jusquau: lecture.jusquau, renvoi: issue.renvoi },
      },
      { telegramId: null, acteur },
    )
    console.log(`[liveclub/contact] invitation a l'adresse d'envoi : ${invitation} (acces ${lecture.accesId.slice(0, 8)})`)
  }

  return resultatAdresseContact({
    emailAcces: lecture.email, contact, avant: lecture.contact, retirer: p.retirer, renvoi: issue.renvoi,
    invitation, erreur, jusquau: lecture.jusquau, destination,
  })
}
