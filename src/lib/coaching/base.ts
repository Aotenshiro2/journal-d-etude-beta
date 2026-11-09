// MON COACHING : LES REQUETES (09/11/2026). Migration
// sites/Aoknowledgecom/supabase/migrations/20261109140000_coaching_seances.sql.
//
// Toutes les ecritures de coaching_droits, coaching_seances et
// coaching_detections passent par ici, avec le role postgres du journal
// (aucune ecriture navigateur). Le client est passe en parametre (prisma ou
// une transaction) : scripts/essayer-migration-coaching.mjs joue ces memes
// requetes dans une transaction annulee. Aucun import de valeur (seulement des
// types) : le fichier se charge tel quel sous Node.

import type { Coach, DemandeCockpit, Droit, EvenementCal, Seance, StatutSeance } from './pur'

export type ClientSql = {
  $queryRawUnsafe<T = unknown>(sql: string, ...valeurs: unknown[]): Promise<T>
  $executeRawUnsafe(sql: string, ...valeurs: unknown[]): Promise<number>
}

/**
 * $1 = email (minuscules). Les comptes du site qui portent cet email VERIFIE.
 * COPIE EXACTE de SQL_COMPTES_DE_EMAIL (src/lib/academie/requetes.ts) : le
 * rattachement d'un rendez-vous suit les memes regles d'identite que les
 * achats. scripts/verifier-coaching.mjs verifie que les deux textes sont egaux.
 */
export const SQL_COMPTES_DE_EMAIL = `
select u.id::text as id from auth.users u
 where lower(btrim(u.email)) = $1::text and u.email_confirmed_at is not null
union
select pe.profile_id::text from public.profile_emails pe
 where lower(btrim(pe.email)) = $1::text and pe.verified = true
`

// minutes : la quantite du droit (migration 20261109200000_coaching_heures, coalesce de l'ancienne colonne seances).
const COLS_DROIT = `id::text as id, email, user_id::text as user_id, coach, seances, minutes, source, reference, libelle,
       depuis, note, pose_par, retire_le, derive`
/** Ce que rend une ecriture de coaching_droits (la meme forme que la vue). */
const RETOUR_DROIT = `id::text as id, email, user_id::text as user_id, coach, seances, coalesce(minutes, seances * 60) as minutes,
              source, reference, null::text as libelle, depuis, note, pose_par, retire_le, false as derive`
const COLS_SEANCE = `id::text as id, email, user_id::text as user_id, coach, debut, duree_min, statut, source, reference,
       droit_id::text as droit_id, note, pose_par, pose_le, statut_le, statut_par`

export type DroitLu = Droit & { user_id: string | null; derive: boolean }
export type SeanceLue = Seance & { user_id: string | null; reference: string | null; pose_par: string; pose_le: Date | string; statut_le: Date | string | null; statut_par: string | null }

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

/** $1 = compte du jeton. Ses droits : son uuid ou l'un de ses emails verifies. */
export const SQL_DROITS_DU_COMPTE = `
select ${COLS_DROIT} from public.coaching_droits_tous
 where user_id = $1::uuid or email = any(public.aok_emails_verifies($1::uuid))
`

/** $1 = compte du jeton. Ses seances, la plus recente d'abord. */
export const SQL_SEANCES_DU_COMPTE = `
select ${COLS_SEANCE} from public.coaching_seances
 where user_id = $1::uuid or email = any(public.aok_emails_verifies($1::uuid))
 order by debut desc limit 500
`

/** Les comptes qui portent l'un des emails $1 (verifies), pour la fiche du cockpit. */
const CTE_COMPTES = `
with comptes as (
  select u.id from auth.users u
   where lower(btrim(u.email)) = any($1::text[]) and u.email_confirmed_at is not null
  union
  select pe.profile_id from public.profile_emails pe
   where lower(btrim(pe.email)) = any($1::text[]) and pe.verified = true
)`

/** $1 = emails de la fiche. Les droits rattaches a ces emails ou aux comptes qui les portent. */
export const SQL_DROITS_DES_EMAILS = `${CTE_COMPTES}
select ${COLS_DROIT} from public.coaching_droits_tous
 where email = any($1::text[]) or user_id in (select id from comptes)
`

/** $1 = emails de la fiche. Les seances, la plus recente d'abord. */
export const SQL_SEANCES_DES_EMAILS = `${CTE_COMPTES}
select ${COLS_SEANCE} from public.coaching_seances
 where email = any($1::text[]) or user_id in (select id from comptes)
 order by debut desc limit 500
`

/** Tous les droits, avec l'email du compte quand le pack a ete achete connecte (email vide). */
export const SQL_TOUS_DROITS = `
select d.id::text as id, coalesce(d.email, lower(btrim(u.email))) as email, d.user_id::text as user_id, d.coach, d.seances, d.minutes,
       d.source, d.reference, d.libelle, d.depuis, d.note, d.pose_par, d.retire_le, d.derive
  from public.coaching_droits_tous d
  left join auth.users u on u.id = d.user_id
 order by d.depuis desc
 limit 2000
`

export const SQL_TOUTES_SEANCES = `
select ${COLS_SEANCE} from public.coaching_seances order by debut desc limit 3000
`

/** $1 = emails. La fiche du cockpit de chacun (membre_id, nom), par cockpit_membre_emails. */
export const SQL_FICHES_DES_EMAILS = `
select me.email, me.membre_id::text as membre_id, nullif(btrim(concat_ws(' ', m.prenom, m.nom)), '') as nom
  from public.cockpit_membre_emails me
  join public.cockpit_membres m on m.membre_id = me.membre_id
 where me.email = any($1::text[])
`

export type Detection = {
  id: string
  fichier_id: string
  titre: string
  debut: Date | string
  duree_min: number | null
  lien: string | null
  transcription: boolean
  notes_gemini: boolean
  email_suggere: string | null
  nom_suggere: string | null
  raison: string | null
  coach: Coach
  statut: 'a_confirmer' | 'confirmee' | 'ecartee'
  seance_id: string | null
  traitee_le: Date | string | null
  traitee_par: string | null
}

/** Les detections a confirmer (les plus recentes d'abord), et les 20 dernieres traitees. */
export const SQL_DETECTIONS = `
(select id::text as id, fichier_id, titre, debut, duree_min, lien, transcription, notes_gemini, email_suggere, nom_suggere,
        raison, coach, statut, seance_id::text as seance_id, traitee_le, traitee_par
   from public.coaching_detections where statut = 'a_confirmer' order by debut desc limit 200)
union all
(select id::text as id, fichier_id, titre, debut, duree_min, lien, transcription, notes_gemini, email_suggere, nom_suggere,
        raison, coach, statut, seance_id::text as seance_id, traitee_le, traitee_par
   from public.coaching_detections where statut <> 'a_confirmer' order by traitee_le desc limit 20)
`

export async function droitsDuCompte(c: ClientSql, userId: string): Promise<DroitLu[]> {
  return c.$queryRawUnsafe<DroitLu[]>(SQL_DROITS_DU_COMPTE, userId)
}

export async function seancesDuCompte(c: ClientSql, userId: string): Promise<SeanceLue[]> {
  return c.$queryRawUnsafe<SeanceLue[]>(SQL_SEANCES_DU_COMPTE, userId)
}

export async function droitsDesEmails(c: ClientSql, emails: string[]): Promise<DroitLu[]> {
  return c.$queryRawUnsafe<DroitLu[]>(SQL_DROITS_DES_EMAILS, emails)
}

export async function seancesDesEmails(c: ClientSql, emails: string[]): Promise<SeanceLue[]> {
  return c.$queryRawUnsafe<SeanceLue[]>(SQL_SEANCES_DES_EMAILS, emails)
}

/** Le compte du site a rattacher a un email : seulement s'il n'y en a qu'un. */
export async function compteDeLEmail(c: ClientSql, email: string): Promise<string | null> {
  const l = await c.$queryRawUnsafe<{ id: string }[]>(SQL_COMPTES_DE_EMAIL, email)
  const ids = [...new Set(l.map(x => x.id))]
  return ids.length === 1 ? ids[0] : null
}

/** Les libelles des comptes de l'equipe (cockpit:<uuid> -> Brice), pour dire qui a pose quoi. */
export async function libellesEquipe(c: ClientSql): Promise<Map<string, string>> {
  const l = await c.$queryRawUnsafe<{ id: string; label: string | null }[]>(
    `select user_id::text as id, label from public.cockpit_allowlist`)
  return new Map(l.filter(x => x.label).map(x => [`cockpit:${x.id}`, x.label as string]))
}

// ---------------------------------------------------------------------------
// Le webhook de Cal
// ---------------------------------------------------------------------------

/** Cal est le calendrier de Brice : toute seance qui en vient est avec lui. */
export const COACH_CAL: Coach = 'brice'

const SQL_REPORTER = `
update public.coaching_seances
   set reference = $2::text, debut = $3::timestamptz, duree_min = $4::int, email = $5::text,
       user_id = coalesce($6::uuid, user_id), statut = 'prevue', statut_le = null, statut_par = null
 where source = 'cal' and reference = $1::text and statut <> 'faite'
   and not exists (select 1 from public.coaching_seances x where x.source = 'cal' and x.reference = $2::text)
returning id::text as id, droit_id::text as droit_id
`

const SQL_ANNULER_ANCIEN = `
update public.coaching_seances set statut = 'annulee', statut_le = now(), statut_par = 'cal:report'
 where source = 'cal' and reference = $1::text and statut = 'prevue'
`

const SQL_POSER_SEANCE_CAL = `
with ins as (
  insert into public.coaching_seances as s (email, user_id, coach, debut, duree_min, statut, source, reference, pose_par)
  values ($1::text, $2::uuid, $3::text, $4::timestamptz, $5::int, 'prevue', 'cal', $6::text, 'cal')
  on conflict (source, reference) where reference is not null do update
     set debut = excluded.debut, duree_min = excluded.duree_min
   where s.statut = 'prevue'
  returning s.id::text as id, s.droit_id::text as droit_id, (s.xmax = 0) as cree
)
select id, droit_id, cree from ins
union all
select id::text, droit_id::text, false from public.coaching_seances
 where source = 'cal' and reference = $6::text and not exists (select 1 from ins)
`

// Le droit d'une heure payee sur Cal porte la duree du rendez-vous ($5, en minutes) : il couvre sa seance, ni plus ni moins.
const SQL_DROIT_CAL = `
with ins as (
  insert into public.coaching_droits (email, user_id, coach, minutes, source, reference, pose_par, note)
  values ($1::text, $2::uuid, $3::text, $5::int, 'cal', $4::text, 'cal', 'Heure payée sur Cal')
  on conflict (source, reference) where reference is not null do nothing
  returning id::text as id
)
select id from ins
union all
select id::text from public.coaching_droits where source = 'cal' and reference = $4::text and not exists (select 1 from ins)
`

const SQL_LIER_DROIT = `
update public.coaching_seances set droit_id = $2::uuid where id = $1::uuid and droit_id is null
`

export type IssuePoserCal = { seance: string; etat: 'cree' | 'mis_a_jour' | 'reporte' | 'fige'; droit: 'cree_ou_lie' | 'deja' | 'aucun' }

/**
 * Pose ou met a jour la seance d'un rendez-vous Cal (dans une transaction).
 * Un report deplace la seance d'origine (son lien au droit suit). Une seance
 * annulee ou faite ne revient jamais a « prevue » par un evenement en retard.
 * Une heure payee cree son droit (une fois), de la duree du rendez-vous, et la
 * seance s'y lie.
 */
export async function poserSeanceCal(c: ClientSql, ev: Extract<EvenementCal, { geste: 'poser' }>): Promise<IssuePoserCal> {
  const userId = await compteDeLEmail(c, ev.email)
  let seance: { id: string; droit_id: string | null } | null = null
  let etat: IssuePoserCal['etat'] = 'cree'
  if (ev.ancienUid) {
    const r = await c.$queryRawUnsafe<{ id: string; droit_id: string | null }[]>(
      SQL_REPORTER, ev.ancienUid, ev.uid, ev.debut, ev.duree_min, ev.email, userId)
    if (r[0]) { seance = r[0]; etat = 'reporte' }
    else await c.$executeRawUnsafe(SQL_ANNULER_ANCIEN, ev.ancienUid)
  }
  if (!seance) {
    const r = await c.$queryRawUnsafe<{ id: string; droit_id: string | null; cree: boolean }[]>(
      SQL_POSER_SEANCE_CAL, ev.email, userId, COACH_CAL, ev.debut, ev.duree_min, ev.uid)
    if (!r[0]) throw new Error('seance Cal introuvable apres insertion')
    seance = r[0]
    etat = r[0].cree ? 'cree' : 'mis_a_jour'
    const [statut] = await c.$queryRawUnsafe<{ statut: StatutSeance }[]>(
      `select statut from public.coaching_seances where id = $1::uuid`, seance.id)
    if (!r[0].cree && statut?.statut !== 'prevue') etat = 'fige'
  }
  let droit: IssuePoserCal['droit'] = 'aucun'
  if (ev.paye) {
    if (seance.droit_id) droit = 'deja'
    else {
      const [d] = await c.$queryRawUnsafe<{ id: string }[]>(SQL_DROIT_CAL, ev.email, userId, COACH_CAL, ev.uid, ev.duree_min)
      if (d) await c.$executeRawUnsafe(SQL_LIER_DROIT, seance.id, d.id)
      droit = 'cree_ou_lie'
    }
  }
  return { seance: seance.id, etat, droit }
}

const SQL_ANNULER_CAL = `
update public.coaching_seances set statut = 'annulee', statut_le = now(), statut_par = 'cal'
 where source = 'cal' and reference = $1::text and statut = 'prevue'
returning id::text as id, droit_id::text as droit_id
`

const SQL_RETIRER_DROIT_CAL = `
update public.coaching_droits set retire_le = now(), retire_par = 'cal:annulation'
 where id = $1::uuid and source = 'cal' and retire_le is null
`

/**
 * Annule la seance d'un rendez-vous Cal. Le droit ne d'une heure payee sur Cal
 * est retire avec elle : une place restante ne se reserve sur Cal qu'en payant
 * de nouveau. Un droit pose a la main ou un pack ne bouge jamais ici.
 */
export async function annulerSeanceCal(c: ClientSql, uid: string): Promise<{ annulee: boolean; droit_retire: boolean }> {
  const r = await c.$queryRawUnsafe<{ id: string; droit_id: string | null }[]>(SQL_ANNULER_CAL, uid)
  if (!r[0]) return { annulee: false, droit_retire: false }
  const n = r[0].droit_id ? await c.$executeRawUnsafe(SQL_RETIRER_DROIT_CAL, r[0].droit_id) : 0
  return { annulee: true, droit_retire: n > 0 }
}

// ---------------------------------------------------------------------------
// Les gestes du cockpit
// ---------------------------------------------------------------------------

type D<A extends DemandeCockpit['action']> = Extract<DemandeCockpit, { action: A }>

export async function ajouterSeance(c: ClientSql, d: D<'ajouter_seance'>, posePar: string): Promise<SeanceLue> {
  const userId = await compteDeLEmail(c, d.email)
  const [l] = await c.$queryRawUnsafe<SeanceLue[]>(`
    insert into public.coaching_seances (email, user_id, coach, debut, duree_min, statut, source, note, pose_par, statut_le, statut_par)
    values ($1::text, $2::uuid, $3::text, $4::timestamptz, $5::int, $6::text, 'cockpit', $7::text, $8::text,
            case when $6::text = 'faite' then now() end, case when $6::text = 'faite' then $8::text end)
    returning ${COLS_SEANCE}`, d.email, userId, d.coach, d.debut, d.duree_min, d.statut, d.note, posePar)
  return l
}

export async function changerStatutSeance(c: ClientSql, id: string, statut: StatutSeance, par: string): Promise<SeanceLue | null> {
  const [l] = await c.$queryRawUnsafe<SeanceLue[]>(`
    update public.coaching_seances set statut = $2::text, statut_le = now(), statut_par = $3::text
     where id = $1::uuid
    returning ${COLS_SEANCE}`, id, statut, par)
  return l ?? null
}

/** Accorde des heures (offertes ou ETM), en minutes. L'ancienne colonne seances reste vide. */
export async function accorderDroit(c: ClientSql, d: D<'accorder_droit'>, posePar: string): Promise<DroitLu> {
  const userId = await compteDeLEmail(c, d.email)
  const [l] = await c.$queryRawUnsafe<DroitLu[]>(`
    insert into public.coaching_droits (email, user_id, coach, minutes, source, depuis, note, pose_par)
    values ($1::text, $2::uuid, $3::text, $4::int, $5::text, coalesce($6::timestamptz, now()), $7::text, $8::text)
    returning ${RETOUR_DROIT}`,
  d.email, userId, d.coach, d.minutes, d.source, d.depuis, d.note, posePar)
  return l
}

/**
 * Corrige la quantite d'un droit de la table, en minutes (pas un pack : il se
 * complete par des heures offertes). L'ancienne colonne seances se vide : seule
 * minutes compte. null = introuvable ou retire.
 */
export async function corrigerDroit(c: ClientSql, id: string, minutes: number, note: string | null): Promise<DroitLu | null> {
  const [l] = await c.$queryRawUnsafe<DroitLu[]>(`
    update public.coaching_droits set minutes = $2::int, seances = null, note = coalesce($3::text, note)
     where id = $1::uuid and retire_le is null
    returning ${RETOUR_DROIT}`, id, minutes, note)
  return l ?? null
}

export async function retirerDroit(c: ClientSql, id: string, par: string): Promise<boolean> {
  const n = await c.$executeRawUnsafe(`
    update public.coaching_droits set retire_le = now(), retire_par = $2::text
     where id = $1::uuid and retire_le is null`, id, par)
  return n > 0
}

/**
 * Confirme une detection Meet : la seance (faite, source meet) se cree pour
 * l'email choisi par l'equipe, une seule fois par enregistrement. null =
 * detection introuvable ou deja traitee.
 */
export async function confirmerDetection(c: ClientSql, d: D<'confirmer_detection'>, par: string): Promise<SeanceLue | null> {
  const [det] = await c.$queryRawUnsafe<{ fichier_id: string; titre: string; debut: Date; duree_min: number | null }[]>(`
    select fichier_id, titre, debut, duree_min from public.coaching_detections
     where id = $1::uuid and statut = 'a_confirmer' for update`, d.id)
  if (!det) return null
  const userId = await compteDeLEmail(c, d.email)
  const duree = d.duree_min ?? (det.duree_min && det.duree_min >= 5 && det.duree_min <= 480 ? det.duree_min : 60)
  const note = `Enregistrement Meet : ${det.titre}`.slice(0, 500)
  const [s] = await c.$queryRawUnsafe<SeanceLue[]>(`
    insert into public.coaching_seances (email, user_id, coach, debut, duree_min, statut, source, reference, note, pose_par, statut_le, statut_par)
    values ($1::text, $2::uuid, $3::text, $4::timestamptz, $5::int, 'faite', 'meet', $6::text, $7::text, $8::text, now(), $8::text)
    on conflict (source, reference) where reference is not null do nothing
    returning ${COLS_SEANCE}`, d.email, userId, d.coach, det.debut, duree, det.fichier_id, note, par)
  const seance = s ?? (await c.$queryRawUnsafe<SeanceLue[]>(
    `select ${COLS_SEANCE} from public.coaching_seances where source = 'meet' and reference = $1::text`, det.fichier_id))[0]
  await c.$executeRawUnsafe(`
    update public.coaching_detections set statut = 'confirmee', seance_id = $2::uuid, traitee_le = now(), traitee_par = $3::text,
           email_suggere = $4::text
     where id = $1::uuid`, d.id, seance.id, par, d.email)
  return seance
}

export async function ecarterDetection(c: ClientSql, id: string, par: string): Promise<boolean> {
  const n = await c.$executeRawUnsafe(`
    update public.coaching_detections set statut = 'ecartee', traitee_le = now(), traitee_par = $2::text
     where id = $1::uuid and statut = 'a_confirmer'`, id, par)
  return n > 0
}

export async function listerDetections(c: ClientSql): Promise<Detection[]> {
  return c.$queryRawUnsafe<Detection[]>(SQL_DETECTIONS)
}
