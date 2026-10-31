// Les LECTURES du suivi des lots (31/10, lots-pur.ts) : un acces broker actif
// dont aucun depot n'a encore ses lots faits, avec son premier depot attendu,
// son entree (jeton utilise), la seconde relance et la declaration en cours.
// Lecture seule. Module leger (base + lots-pur) : lu par droits.ts, le
// passage quotidien et lots.ts, sans cycle d'import.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { fermetureDepotPerduActive, suiviLotsActif } from './config'
import { DEPOT_PERDU_DEPUIS, etatLots, type EtatLots, type SuiviLots } from './lots-pur'
import { jourParis } from './passage-regles'
import { messageErreur, relationAbsente } from './pur'

/** Un acces broker dont les premiers lots sont attendus, et son premier depot attendu. */
export type LigneSuiviLots = {
  accesId: string
  email: string
  telegramId: number | null
  /** 'YYYY-MM-DD' */
  debut: string
  jusquau: string
  commissionId: string
  depotLe: string
  /** Euros (le depot), null si inconnu. */
  montantBase: number | null
  /** Euros. */
  commissionAttendue: number
  client: string | null
  partenaire: string
  suivi: SuiviLots
  /** La declaration en cours (geste_id), ou null. */
  declarationId: number | null
}

type LigneSql = {
  acces_id: string; email: string; telegram_id: bigint | null; debut: string; jusquau: string
  commission_id: string; depot_le: string; montant_base: number | null; commission_attendue: number
  client: string | null; partenaire: string
  entree_le: Date | null; relance2_le: Date | null; declaration_id: bigint | null
}

/**
 * Les acces broker ACTIFS (ni retires, ni sortis, pas finis) dont un depot est
 * attendu sans lots faits, et dont AUCUN depot n'a ses lots faits ou n'est
 * recu (les premiers lots comptent une fois). Le depot pris est le plus
 * ancien attendu. `filtre` : la condition sur l'acces (alias a).
 */
async function lire(filtre: Prisma.Sql): Promise<LigneSuiviLots[]> {
  const lignes = await prisma.$queryRaw<LigneSql[]>`
    select a.acces_id::text as acces_id, a.email, a.telegram_id, a.debut::text as debut, a.jusquau::text as jusquau,
           c.commission_id::text as commission_id, c.le::text as depot_le, c.montant_base::float8 as montant_base,
           c.commission_attendue::float8 as commission_attendue, c.client, p.nom as partenaire,
           (select min(j.utilise_le) from public.cockpit_liveclub_jetons j
             where j.acces_id = a.acces_id and j.usage = 'entree' and j.utilise_le is not null) as entree_le,
           (select max(g.fait_le) from public.cockpit_liveclub_gestes g
             where g.geste = 'rappel' and g.regle = 'lots_relance_2' and g.resultat = 'fait'
               and g.details->>'commission_id' = c.commission_id::text) as relance2_le,
           (select max(d.geste_id) from public.cockpit_liveclub_gestes d
             where d.geste = 'acces_broker' and d.regle = 'lots_declares' and d.resultat = 'fait'
               and d.details->>'commission_id' = c.commission_id::text
               and not exists (
                 select 1 from public.cockpit_liveclub_gestes e
                 where e.geste = 'acces_broker' and e.regle in ('lots_confirmes', 'lots_pas_vus') and e.resultat = 'fait'
                   and e.details->>'declaration' = d.geste_id::text)) as declaration_id
    from public.cockpit_liveclub_acces a
    join lateral (
      select c1.commission_id, c1.partenaire_id, c1.le, c1.montant_base, c1.commission_attendue, c1.client
      from public.cockpit_commissions c1
      where c1.acces_id = a.acces_id and c1.nature = 'depot' and c1.statut = 'attendue' and c1.lots_faits_le is null
      order by c1.le, c1.pose_le
      limit 1
    ) c on true
    join public.cockpit_partenaires p on p.partenaire_id = c.partenaire_id
    where a.motif = 'broker' and a.retire_le is null and a.sorti_le is null and a.jusquau >= current_date
      and not exists (
        select 1 from public.cockpit_commissions c2
        where c2.acces_id = a.acces_id and c2.nature = 'depot'
          and (c2.lots_faits_le is not null or c2.statut = 'recue'))
      and ${filtre}
    order by a.debut`
  return lignes.map(l => ({
    accesId: l.acces_id,
    email: l.email,
    telegramId: l.telegram_id === null ? null : Number(l.telegram_id),
    debut: l.debut,
    jusquau: l.jusquau,
    commissionId: l.commission_id,
    depotLe: l.depot_le,
    montantBase: l.montant_base,
    commissionAttendue: l.commission_attendue,
    client: l.client,
    partenaire: l.partenaire,
    suivi: {
      debut: l.debut,
      entreeLe: l.entree_le ? jourParis(l.entree_le.toISOString()) : null,
      relance2Le: l.relance2_le ? jourParis(l.relance2_le.toISOString()) : null,
      declarationEnCours: l.declaration_id !== null,
    },
    declarationId: l.declaration_id === null ? null : Number(l.declaration_id),
  }))
}

/** Tous les suivis en cours (passage quotidien). Jette sur une panne : le passage ne decide rien. */
export function suivisLotsATraiter(): Promise<LigneSuiviLots[]> {
  return lire(Prisma.sql`true`)
}

/** Le suivi d'un compte : son telegram_id, ou l'email de son rattachement. Jette sur une panne. */
export function suivisLotsDuCompte(telegramId: number, email: string | null): Promise<LigneSuiviLots[]> {
  return lire(Prisma.sql`(a.telegram_id = ${telegramId}
    or (${email}::text is not null and lower(a.email) = lower(${email}::text)))`)
}

/** Le suivi d'UN depot (relu juste avant d'envoyer), ou null s'il n'attend plus ses lots. Jette sur une panne. */
export async function suiviLotsDeCommission(commissionId: string): Promise<LigneSuiviLots | null> {
  const lignes = await lire(Prisma.sql`exists (
    select 1 from public.cockpit_commissions c3 where c3.acces_id = a.acces_id and c3.commission_id = ${commissionId}::uuid)`)
  return lignes.find(l => l.commissionId === commissionId) ?? null
}

/**
 * (31/10) Pour droitLiveClub : l'etat des lots de chaque acces broker donne
 * (acces_id -> EtatLots), au jour de Paris. NE JETTE JAMAIS : une lecture
 * ratee (ou le suivi coupe) rend une table vide, et l'acces garde son droit
 * (un 'inconnu' ne met personne en pause).
 */
export async function lotsDesAcces(accesIds: readonly string[], maintenant: Date = new Date()): Promise<Map<string, EtatLots & { commissionId: string }>> {
  const etats = new Map<string, EtatLots & { commissionId: string }>()
  if (!suiviLotsActif() || accesIds.length === 0) return etats
  try {
    const lignes = await lire(Prisma.sql`a.acces_id::text = any(${[...accesIds]}::text[])`)
    const aujourdhui = jourParis(maintenant.toISOString())
    for (const l of lignes) {
      if (!etats.has(l.accesId)) etats.set(l.accesId, { ...etatLots(l.suivi, aujourdhui), commissionId: l.commissionId })
    }
  } catch (err) {
    console.warn(`[liveclub/lots] suivi des lots illisible (droit garde) : ${relationAbsente(err) ? 'table absente' : messageErreur(err)}`)
  }
  return etats
}

// ---------------------------------------------------------------------------
// (31/10) Le DEPOT PERDU (lots-pur.ts) : « pas de commission, pas d'acces »
// ---------------------------------------------------------------------------

/** Un acces broker FERME par un depot perdu, et ce depot (le dernier marque perdu). */
export type LigneDepotPerdu = {
  accesId: string
  email: string
  telegramId: number | null
  commissionId: string
  /** 'YYYY-MM-DD' : le jour du depot. */
  depotLe: string
  /** Euros (le depot), null si inconnu. */
  montantBase: number | null
  client: string | null
  partenaire: string
}

type LigneSqlPerdu = {
  acces_id: string; email: string; telegram_id: bigint | null; commission_id: string; depot_le: string
  montant_base: number | null; client: string | null; partenaire: string
}

/**
 * Les acces broker ACTIFS FERMES par un depot perdu : un depot marque perdu
 * (maj_le, jour de Paris) depuis DEPOT_PERDU_DEPUIS, et AUCUN depot attendu
 * (lots faits ou non) ni recu sur cet acces. Un nouveau depot inscrit, ou la
 * commission remise en attendue, le rouvre : c'est un etat lu, rien n'est
 * ecrit sur l'acces. `filtre` : la condition sur l'acces (alias a).
 */
async function lireFermes(filtre: Prisma.Sql): Promise<LigneDepotPerdu[]> {
  const lignes = await prisma.$queryRaw<LigneSqlPerdu[]>`
    select a.acces_id::text as acces_id, a.email, a.telegram_id,
           c.commission_id::text as commission_id, c.le::text as depot_le, c.montant_base::float8 as montant_base,
           c.client, p.nom as partenaire
    from public.cockpit_liveclub_acces a
    join lateral (
      select c1.commission_id, c1.partenaire_id, c1.le, c1.montant_base, c1.client
      from public.cockpit_commissions c1
      where c1.acces_id = a.acces_id and c1.nature = 'depot' and c1.statut = 'perdue'
        and (coalesce(c1.maj_le, c1.pose_le) at time zone 'Europe/Paris')::date >= ${DEPOT_PERDU_DEPUIS}::date
      order by coalesce(c1.maj_le, c1.pose_le) desc
      limit 1
    ) c on true
    join public.cockpit_partenaires p on p.partenaire_id = c.partenaire_id
    where a.motif = 'broker' and a.retire_le is null and a.sorti_le is null and a.jusquau >= current_date
      and not exists (
        select 1 from public.cockpit_commissions c2
        where c2.acces_id = a.acces_id and c2.nature = 'depot' and c2.statut in ('attendue', 'recue'))
      and ${filtre}
    order by a.debut`
  return lignes.map(l => ({
    accesId: l.acces_id,
    email: l.email,
    telegramId: l.telegram_id === null ? null : Number(l.telegram_id),
    commissionId: l.commission_id,
    depotLe: l.depot_le,
    montantBase: l.montant_base,
    client: l.client,
    partenaire: l.partenaire,
  }))
}

/** Tous les acces fermes par un depot perdu (passage quotidien). Jette sur une panne. */
export function accesFermesParDepot(): Promise<LigneDepotPerdu[]> {
  return lireFermes(Prisma.sql`true`)
}

/** L'acces de CETTE commission, s'il est ferme par elle (relu juste avant d'agir). Jette sur une panne. */
export async function accesFermeDeCommission(commissionId: string): Promise<LigneDepotPerdu | null> {
  const lignes = await lireFermes(Prisma.sql`exists (
    select 1 from public.cockpit_commissions c3 where c3.acces_id = a.acces_id and c3.commission_id = ${commissionId}::uuid)`)
  return lignes[0] ?? null
}

/** L'acces de cette commission, ferme ou non : pour la carte et le resultat d'Agent AOK. Jette sur une panne. */
export async function accesDeCommission(commissionId: string): Promise<{ accesId: string; telegramId: number | null; ferme: boolean } | null> {
  const lignes = await prisma.$queryRaw<{ acces_id: string; telegram_id: bigint | null }[]>`
    select a.acces_id::text as acces_id, a.telegram_id
    from public.cockpit_commissions c
    join public.cockpit_liveclub_acces a on a.acces_id = c.acces_id
    where c.commission_id = ${commissionId}::uuid and c.nature = 'depot'
      and a.motif = 'broker' and a.retire_le is null and a.sorti_le is null and a.jusquau >= current_date`
  const l = lignes[0]
  if (!l) return null
  const ferme = fermetureDepotPerduActive() && (await lireFermes(Prisma.sql`a.acces_id = ${l.acces_id}::uuid`)).length > 0
  return { accesId: l.acces_id, telegramId: l.telegram_id === null ? null : Number(l.telegram_id), ferme }
}

/**
 * (31/10) Pour droitLiveClub : les acces donnes qui sont FERMES par un depot
 * perdu (acces_id -> commission). NE JETTE JAMAIS : une lecture ratee (ou la
 * regle coupee) rend une table vide, et l'acces garde son droit (un
 * 'inconnu' ne ferme rien).
 */
export async function depotsPerdusDesAcces(accesIds: readonly string[]): Promise<Map<string, { commissionId: string }>> {
  const fermes = new Map<string, { commissionId: string }>()
  if (!fermetureDepotPerduActive() || accesIds.length === 0) return fermes
  try {
    const lignes = await lireFermes(Prisma.sql`a.acces_id::text = any(${[...accesIds]}::text[])`)
    for (const l of lignes) if (!fermes.has(l.accesId)) fermes.set(l.accesId, { commissionId: l.commissionId })
  } catch (err) {
    console.warn(`[liveclub/lots] depots perdus illisibles (droit garde) : ${relationAbsente(err) ? 'table absente' : messageErreur(err)}`)
  }
  return fermes
}

/**
 * Un acces broker de ce compte a-t-il deja ses lots faits (ou un depot recu) ?
 * Pour dire « c'est deja bon » plutot que « rien a verifier ». Jette sur une panne.
 */
export async function lotsDejaFaits(telegramId: number, email: string | null): Promise<boolean> {
  const lignes = await prisma.$queryRaw<{ n: number }[]>`
    select 1 as n from public.cockpit_liveclub_acces a
    join public.cockpit_commissions c on c.acces_id = a.acces_id and c.nature = 'depot'
    where a.motif = 'broker' and a.retire_le is null
      and (c.lots_faits_le is not null or c.statut = 'recue')
      and (a.telegram_id = ${telegramId}
        or (${email}::text is not null and lower(a.email) = lower(${email}::text)))
    limit 1`
  return lignes.length > 0
}
