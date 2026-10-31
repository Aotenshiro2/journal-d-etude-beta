// Ajouter une AUTRE adresse email a son compte, sur preuve par code (GO de
// Brice du 31/10/2026) : la partie serveur. Regles pures et email :
// emails-confirmation-pur.ts. Routes : /api/compte/emails/ajouter et
// /api/compte/emails/confirmer. Migration :
// 20261031190000_profile_emails_confirmation.sql.
//
// Les tables (serveur, Prisma, role postgres) :
// - profile_emails : les adresses du compte. Une adresse n'y entre plus que
//   VERIFIEE (le navigateur n'y insere plus rien depuis cette migration).
//   L'unicite sur email ne change pas : une adresse verifiee a un seul
//   titulaire, et n'est jamais ecrasee ni deplacee.
// - profile_emails_attente : une ligne par (compte, adresse) en attente, avec
//   le HMAC du code, son expiration et ses essais. Plusieurs comptes peuvent
//   attendre la meme adresse : seul celui qui recoit le code la prouve, et sa
//   confirmation efface les attentes des autres (et une vieille ligne non
//   verifiee de profile_emails posee par un autre compte : le squat).
// - profile_emails_envois : le compteur d'envois (compte, HMAC de l'adresse,
//   date), que le membre ne peut ni lire ni effacer.
//
// Le secret du HMAC : SUPABASE_SERVICE_ROLE_KEY, deja pose sur le journal en
// production (academie, support, photos) et en local. On n'en derive que des
// cles par usage (cleDerivee). Le changer invalide les codes en cours (15 min)
// et remet les compteurs d'envoi a zero, rien d'autre.
//
// Jamais le code, l'adresse complete ni le message d'une erreur de base (il
// peut reprendre l'adresse) dans un log : compte tronque, ref de l'adresse,
// code de l'erreur.

import type { Prisma } from '@prisma/client'
import { Resend } from 'resend'
import { prisma } from '@/lib/db'
import { tronquer } from '@/lib/academie/http'
import { oublierDroitsDuCompte } from '@/lib/trouver-cours'
import { relationAbsente } from '@/lib/liveclub/pur'
import {
  CODE_ESSAIS_MAX, CODE_VALIDITE_MINUTES, EXPEDITEUR, SUPPORT,
  codeCorrespond, decisionAjout, decisionConfirmation, essaisRestants, etatEssai, genererCode, hmacAdresse, hmacCode,
  htmlEmailCode, modeleEmailCode, refAdresse, texteEmailCode,
  type DecisionAjout,
} from './emails-confirmation-pur'

type Tx = Prisma.TransactionClient

/** Le secret du HMAC, ou null (la route rend 503 'config'). */
function secretCodes(): string | null {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  return s && s.length >= 32 ? s : null
}

function cleResend(): string | null {
  return process.env.RESEND_API_KEY_LIVECLUB?.trim() || process.env.RESEND_API_KEY?.trim() || null
}

/** Verrou consultatif de TRANSACTION (rendu au commit). Ordre fixe : compte, puis adresse, puis ligne. */
async function verrou(tx: Tx, cle: string): Promise<void> {
  await tx.$queryRaw`select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended(${cle}::text, 0))) as verrou`
}

/** Le code de l'erreur (Prisma, Postgres) ou son nom : jamais son message. */
function codeErreur(err: unknown): string {
  if (relationAbsente(err)) return 'tables absentes (migration 20261031190000)'
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; meta?: { code?: unknown } }
  const codes = [e.code, e.meta?.code].filter((x): x is string => typeof x === 'string')
  return codes.length ? codes.join('/') : err instanceof Error ? err.name : 'erreur'
}

// ---------------------------------------------------------------------------
// Ajouter : poser un code et l'envoyer
// ---------------------------------------------------------------------------

export type IssueAjout =
  | { ok: true }
  | { ok: false; erreur: Exclude<DecisionAjout, 'ok'> | 'config' | 'envoi' | 'indisponible' }

type LigneEtat = {
  connexion: string | null
  verifiee_ici: boolean
  verifiee_ailleurs: boolean
  connexion_ailleurs: boolean
  compte_heure: number
  compte_jour: number
  adresse_heure: number
  adresse_jour: number
  total_heure: number
}

/**
 * Pose un code neuf pour (compte, adresse) et l'envoie a l'adresse. Tout se
 * decide sous verrou du compte puis de l'adresse : deux demandes simultanees
 * ne passent pas sous un plafond ensemble. Le code precedent ne marche plus,
 * les essais repartent a zero. L'envoi rate : le code est efface (personne
 * ne l'a recu), l'envoi reste compte. `email` doit etre normalise.
 */
export async function demanderCode(userId: string, email: string): Promise<IssueAjout> {
  const secret = secretCodes()
  const cle = cleResend()
  if (!secret || !cle) {
    console.warn(`[compte/emails] config incomplete : ${!secret ? 'SUPABASE_SERVICE_ROLE_KEY ' : ''}${!cle ? 'RESEND_API_KEY_LIVECLUB et RESEND_API_KEY' : ''}`.trim())
    return { ok: false, erreur: 'config' }
  }
  const adresse = hmacAdresse(secret, email)
  const ref = refAdresse(adresse)
  const qui = `compte=${tronquer(userId)} ref=${ref}`
  const code = genererCode()
  const codeHmac = hmacCode(secret, userId, email, code)

  let decision: DecisionAjout
  try {
    decision = await prisma.$transaction(async tx => {
      await verrou(tx, `pe_compte:${userId}`)
      await verrou(tx, `pe_adresse:${adresse}`)
      const l = (await tx.$queryRaw<LigneEtat[]>`
        select
          (select lower(btrim(u.email)) from auth.users u where u.id = ${userId}::uuid) as connexion,
          exists (select 1 from public.profile_emails pe
                   where pe.profile_id = ${userId}::uuid and lower(btrim(pe.email)) = ${email} and pe.verified) as verifiee_ici,
          exists (select 1 from public.profile_emails pe
                   where pe.profile_id <> ${userId}::uuid and lower(btrim(pe.email)) = ${email} and pe.verified) as verifiee_ailleurs,
          exists (select 1 from auth.users u
                   where u.id <> ${userId}::uuid and lower(btrim(u.email)) = ${email}) as connexion_ailleurs,
          (select count(*)::int from public.profile_emails_envois e
            where e.profile_id = ${userId}::uuid and e.envoye_le > now() - interval '1 hour') as compte_heure,
          (select count(*)::int from public.profile_emails_envois e
            where e.profile_id = ${userId}::uuid and e.envoye_le > now() - interval '1 day') as compte_jour,
          (select count(*)::int from public.profile_emails_envois e
            where e.email_hmac = ${adresse} and e.envoye_le > now() - interval '1 hour') as adresse_heure,
          (select count(*)::int from public.profile_emails_envois e
            where e.email_hmac = ${adresse} and e.envoye_le > now() - interval '1 day') as adresse_jour,
          (select count(*)::int from public.profile_emails_envois e
            where e.envoye_le > now() - interval '1 hour') as total_heure`)[0]
      if (!l) throw new Error('etat illisible')
      const d = decisionAjout({
        email,
        emailConnexion: l.connexion,
        verifieeIci: l.verifiee_ici,
        verifieeAilleurs: l.verifiee_ailleurs,
        connexionAilleurs: l.connexion_ailleurs,
        envois: {
          compteHeure: l.compte_heure, compteJour: l.compte_jour,
          adresseHeure: l.adresse_heure, adresseJour: l.adresse_jour, totalHeure: l.total_heure,
        },
      })
      if (d !== 'ok') return d
      await tx.$executeRaw`
        insert into public.profile_emails_attente (profile_id, email, code_hmac, expire_le, essais, envoye_le, cree_le, maj_le)
        values (${userId}::uuid, ${email}, ${codeHmac},
                now() + make_interval(mins => ${CODE_VALIDITE_MINUTES}::int), 0, now(), now(), now())
        on conflict (profile_id, email) do update set
          code_hmac = excluded.code_hmac,
          expire_le = excluded.expire_le,
          essais = 0,
          envoye_le = now(),
          maj_le = now()`
      await tx.$executeRaw`
        insert into public.profile_emails_envois (profile_id, email_hmac) values (${userId}::uuid, ${adresse})`
      // Le compteur ne sert que sur 24 heures : on garde deux jours, pas plus.
      await tx.$executeRaw`delete from public.profile_emails_envois where envoye_le < now() - interval '2 days'`
      return d
    })
  } catch (err) {
    console.warn(`[compte/emails] ajout ${qui} : base ${codeErreur(err)}`)
    return { ok: false, erreur: 'indisponible' }
  }

  if (decision !== 'ok') {
    console.info(`[compte/emails] ajout ${qui} : refus ${decision}`)
    return { ok: false, erreur: decision }
  }

  const envoi = await envoyerEmailCode(cle, email, code)
  if (!envoi.ok) {
    // Personne ne l'a recu : il ne doit plus pouvoir servir.
    await prisma.$executeRaw`
      update public.profile_emails_attente set code_hmac = null, maj_le = now()
      where profile_id = ${userId}::uuid and email = ${email} and code_hmac = ${codeHmac}`.catch(() => undefined)
    console.warn(`[compte/emails] ajout ${qui} : email du code NON parti (${envoi.erreur})`)
    return { ok: false, erreur: 'envoi' }
  }
  console.info(`[compte/emails] ajout ${qui} : code envoye`)
  return { ok: true }
}

/** L'email du code, par Resend, depuis support@. Ne jette pas. Jamais l'adresse ni le code dans l'erreur rendue. */
async function envoyerEmailCode(cle: string, email: string, code: string): Promise<{ ok: true } | { ok: false; erreur: string }> {
  const m = modeleEmailCode(email, code)
  try {
    const { error } = await new Resend(cle).emails.send({
      from: EXPEDITEUR,
      to: email,
      replyTo: SUPPORT,
      subject: m.sujet,
      html: htmlEmailCode(m),
      text: texteEmailCode(m),
    })
    if (error) return { ok: false, erreur: `Resend : ${String(error.name ?? 'erreur').slice(0, 80)}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, erreur: `Resend : ${err instanceof Error ? err.name : 'erreur'}` }
  }
}

// ---------------------------------------------------------------------------
// Confirmer : verifier le code tape
// ---------------------------------------------------------------------------

export type IssueConfirmation =
  | { ok: true }
  | { ok: false; erreur: 'code'; restants: number }
  | { ok: false; erreur: 'aucun' | 'expire' | 'epuise' | 'rattachee' | 'config' | 'indisponible' }

/**
 * Compte l'essai (5 au plus par code, code non expire), compare a temps
 * constant, et, si le code est juste, passe l'adresse verifiee sur CE compte
 * dans la meme transaction :
 * - relu sous verrou : une adresse verifiee ou de connexion d'un autre compte
 *   n'est jamais touchee ('rattachee', le code est efface) ;
 * - les lignes NON verifiees de la meme adresse sur d'autres comptes (squat)
 *   sont supprimees, ainsi que toutes les attentes de cette adresse (le code
 *   du compte compris : il ne resservira pas) ;
 * - la ligne du compte est creee verifiee, ou sa vieille ligne non verifiee
 *   passe verifiee. Le upsert ne modifie QUE une ligne de ce compte.
 * Un essai faux est enregistre (la transaction est validee, pas annulee).
 */
export async function confirmerCode(userId: string, email: string, code: string): Promise<IssueConfirmation> {
  const secret = secretCodes()
  if (!secret) {
    console.warn('[compte/emails] config incomplete : SUPABASE_SERVICE_ROLE_KEY')
    return { ok: false, erreur: 'config' }
  }
  const adresse = hmacAdresse(secret, email)
  const qui = `compte=${tronquer(userId)} ref=${refAdresse(adresse)}`

  let issue: IssueConfirmation
  try {
    issue = await prisma.$transaction(async (tx): Promise<IssueConfirmation> => {
      await verrou(tx, `pe_adresse:${adresse}`)
      const l = (await tx.$queryRaw<{ code_hmac: string | null; expire: boolean; essais: number }[]>`
        select code_hmac, expire_le <= now() as expire, essais
        from public.profile_emails_attente
        where profile_id = ${userId}::uuid and email = ${email}
        for update`)[0]
      const etat = etatEssai(l ? { codeHmac: l.code_hmac, expire: l.expire, essais: l.essais } : null)
      if (etat !== 'essai' || !l) return { ok: false, erreur: etat === 'essai' ? 'aucun' : etat }

      const apres = (await tx.$queryRaw<{ essais: number }[]>`
        update public.profile_emails_attente set essais = essais + 1, maj_le = now()
        where profile_id = ${userId}::uuid and email = ${email}
        returning essais`)[0]?.essais ?? CODE_ESSAIS_MAX
      if (!codeCorrespond(secret, userId, email, code, l.code_hmac)) {
        return { ok: false, erreur: 'code', restants: essaisRestants(apres) }
      }

      const s = (await tx.$queryRaw<{ verifiee_ailleurs: boolean; connexion_ailleurs: boolean }[]>`
        select
          exists (select 1 from public.profile_emails pe
                   where pe.profile_id <> ${userId}::uuid and lower(btrim(pe.email)) = ${email} and pe.verified) as verifiee_ailleurs,
          exists (select 1 from auth.users u
                   where u.id <> ${userId}::uuid and lower(btrim(u.email)) = ${email}) as connexion_ailleurs`)[0]
      if (!s || decisionConfirmation({ verifieeAilleurs: s.verifiee_ailleurs, connexionAilleurs: s.connexion_ailleurs }) === 'rattachee') {
        await tx.$executeRaw`
          delete from public.profile_emails_attente where profile_id = ${userId}::uuid and email = ${email}`
        return { ok: false, erreur: 'rattachee' }
      }

      await tx.$executeRaw`
        delete from public.profile_emails
        where lower(btrim(email)) = ${email} and profile_id <> ${userId}::uuid and verified = false`
      const pose = await tx.$queryRaw<{ id: string }[]>`
        insert into public.profile_emails (profile_id, email, is_primary, verified, source)
        values (${userId}::uuid, ${email}, false, true, 'code')
        on conflict (email) do update set verified = true
          where profile_emails.profile_id = excluded.profile_id
        returning id::text as id`
      if (pose.length === 0) {
        // Une ligne verifiee d'un autre compte est apparue entre-temps : on n'y touche pas.
        await tx.$executeRaw`
          delete from public.profile_emails_attente where profile_id = ${userId}::uuid and email = ${email}`
        return { ok: false, erreur: 'rattachee' }
      }
      await tx.$executeRaw`delete from public.profile_emails_attente where email = ${email}`
      return { ok: true }
    })
  } catch (err) {
    console.warn(`[compte/emails] confirmation ${qui} : base ${codeErreur(err)}`)
    return { ok: false, erreur: 'indisponible' }
  }

  if (issue.ok) {
    // Les droits gardes 10 minutes par les bots (trouver-cours.ts) : cette instance relit tout de suite.
    oublierDroitsDuCompte(userId)
    console.info(`[compte/emails] confirmation ${qui} : adresse verifiee`)
  } else {
    console.info(`[compte/emails] confirmation ${qui} : ${issue.erreur}${issue.erreur === 'code' ? ` (restants ${issue.restants})` : ''}`)
  }
  return issue
}
