// (31/10) L'ADRESSE D'ENVOI de TOUS les emails du Live Club a un membre :
// une seule fonction serveur, adresseEnvoi. Regle (choisirAdresseEnvoi,
// adresse-contact-pur.ts), dans l'ordre :
//   1. son compte AOK a une adresse « communications » cochee dans Mon espace
//      (migration 20261031211000) : aok_email_communications(profil). C'est
//      SON choix, il passe en premier. Le compte est retrouve par l'adresse
//      d'identite, VERIFIEE (auth.users confirme ou profile_emails verified,
//      comme trouver-cours.ts) ; zero ou deux comptes = incertain, etape sautee ;
//   2. sinon l'adresse de contact posee par l'equipe sur son acces broker
//      (adresse-contact-lecture.ts) ;
//   3. sinon l'adresse d'identite (acces ou abonnement), comme avant.
// L'adresse d'identite reste celle de l'acces et de la commission : elle
// n'est jamais remplacee ailleurs que dans le champ « a qui part l'email ».
//
// Fonction ou colonne absente (migration pas appliquee) : etape suivante, un
// seul avertissement par instance. Jamais d'adresse dans un log.
//
// Exception voulue : le code de verification d'une adresse (verification.ts)
// part a CETTE adresse, puisqu'il sert a la prouver.

import { prisma } from '@/lib/db'
import { messageErreur, normaliserEmail } from './pur'
import {
  MIGRATION_COMMUNICATIONS, choisirAdresseEnvoi, communicationsAbsentes, type SourceAdresseEnvoi,
} from './adresse-contact-pur'
import { adresseContactAcces } from './adresse-contact-lecture'

const avertis = new Set<string>()
function avertirUneFois(cle: string, message: string) {
  if (avertis.has(cle)) return
  avertis.add(cle)
  console.warn(`[liveclub/envoi] ${message}`)
}

/**
 * L'adresse « communications » cochee par le membre dans Mon espace, pour le
 * compte AOK (un seul) qui porte cette adresse verifiee. null = pas de compte,
 * plusieurs comptes, rien de coche, migration absente ou panne.
 */
export async function adresseCommunicationsCompte(emailIdentite: string | null): Promise<string | null> {
  const email = normaliserEmail(emailIdentite)
  if (!email) return null
  try {
    const l = await prisma.$queryRaw<{ profil: string; coche: boolean; email: string | null }[]>`
      with comptes as (
        select distinct x.id from (
          select u.id from auth.users u
           where lower(btrim(u.email)) = ${email} and u.email_confirmed_at is not null
          union
          select pe.profile_id from public.profile_emails pe
           where lower(btrim(pe.email)) = ${email} and pe.verified = true
        ) x
        limit 2
      )
      select c.id::text as profil,
        exists (select 1 from public.profile_emails pe
                where pe.profile_id = c.id and pe.communications and pe.verified) as coche,
        public.aok_email_communications(c.id) as email
      from comptes c`
    if (l.length !== 1 || l[0].coche !== true) return null
    return normaliserEmail(l[0].email)
  } catch (err) {
    if (communicationsAbsentes(err)) {
      avertirUneFois('communications_absentes', `adresse des communications pas encore en place (migration ${MIGRATION_COMMUNICATIONS} pas appliquee) : etape sautee.`)
    } else {
      avertirUneFois('communications_illisibles', `adresse des communications illisible (${messageErreur(err)}) : etape sautee.`)
    }
    return null
  }
}

/** L'adresse d'envoi et d'ou elle vient. null = aucune adresse connue. */
export async function adresseEnvoiDetail(o: { emailIdentite: string | null; accesId?: string | null }): Promise<{ email: string; source: SourceAdresseEnvoi } | null> {
  const identite = normaliserEmail(o.emailIdentite)
  const communications = await adresseCommunicationsCompte(identite)
  const contact = !communications && o.accesId ? await adresseContactAcces(o.accesId) : null
  return choisirAdresseEnvoi({ communications, contact, identite: identite ?? (o.emailIdentite?.trim() || null) })
}

/**
 * Ou ecrire au membre : son choix dans Mon espace, sinon l'adresse de contact
 * de son acces broker, sinon son adresse d'identite. TOUS les envois du Live
 * Club a un membre passent ici (prevenir du passage, invitation broker,
 * bienvenue, reouverture).
 */
export async function adresseEnvoi(o: { emailIdentite: string | null; accesId?: string | null }): Promise<string | null> {
  return (await adresseEnvoiDetail(o))?.email ?? null
}

/**
 * (Webhook Resend) Les AUTRES adresses verifiees du compte AOK (un seul) qui
 * porte cette adresse verifiee : un refus sur l'adresse des communications
 * retrouve ainsi l'acces ou l'abonnement de la personne. [] = aucun compte,
 * plusieurs, ou panne. Ne demande aucune migration.
 */
export async function autresAdressesDuCompte(email: string): Promise<string[]> {
  const e = normaliserEmail(email)
  if (!e) return []
  try {
    const l = await prisma.$queryRaw<{ emails: string[] | null }[]>`
      with comptes as (
        select distinct x.id from (
          select u.id from auth.users u
           where lower(btrim(u.email)) = ${e} and u.email_confirmed_at is not null
          union
          select pe.profile_id from public.profile_emails pe
           where lower(btrim(pe.email)) = ${e} and pe.verified = true
        ) x
        limit 2
      )
      select array(
        select distinct y.e from (
          select lower(btrim(u.email)) as e from auth.users u
           where u.id = c.id and u.email is not null and u.email_confirmed_at is not null
          union
          select lower(btrim(pe.email)) from public.profile_emails pe
           where pe.profile_id = c.id and pe.verified = true and pe.email is not null
        ) y
        where y.e <> ${e} and y.e <> ''
        limit 10
      ) as emails
      from comptes c`
    if (l.length !== 1) return []
    return (l[0].emails ?? []).map(x => normaliserEmail(x)).filter((x): x is string => !!x)
  } catch (err) {
    avertirUneFois('comptes_illisibles', `comptes AOK illisibles pour un refus d'email (${messageErreur(err)}).`)
    return []
  }
}
