// LE CONNECTEUR MCP DE L'ASSISTANT D'ALEX (05/11/2026) : le cote serveur.
//
// 1. La cle : la ligne dediee de cockpit_tab_cles (portee alex_indicateur,
//    empreinte prefixee « mcp-alex-indicateur: », temps constant, 30 appels
//    par minute comptes dans cockpit_tab_acces). Tant que la migration
//    20261105250000 n'est pas passee (portee inconnue de la contrainte, ou
//    table des demandes absente), le connecteur rend 503 et ne lit rien.
// 2. Les lectures : cockpit_liveclub_indicateur seulement, les colonnes
//    utiles et rien d'autre (jamais l'identifiant Telegram, un email, un
//    abonnement ni un paiement). Dates du jour de Paris.

import { prisma } from '@/lib/db'
import { choisirCleAlex, DEBIT_PAR_MINUTE_ALEX, PORTEE_ALEX, SECRET_ALEX, type Lectures, type LigneDepart, type LigneMembre, type VerdictCleAlex } from '@/lib/mcp-alex/pur'

function raison(err: unknown): string {
  return err instanceof Error ? (err.message.split('\n').filter(Boolean).pop() ?? '') : String(err)
}

type LigneCle = { cle_id: string; empreinte: string; appels: number }

/** La contrainte de portee connait alex_indicateur et la table des demandes existe : la migration 20261105250000 est passee. */
async function enService(): Promise<boolean> {
  const r = await prisma.$queryRaw<{ def: string | null; demandes: string | null }[]>`
    select (select pg_get_constraintdef(c.oid) from pg_constraint c
             where c.conname = 'cockpit_tab_cles_portee_check' and c.conrelid = 'public.cockpit_tab_cles'::regclass) as def,
           to_regclass('public.cockpit_liveclub_indicateur')::text as demandes`
  return (r[0]?.def ?? '').includes(`'${PORTEE_ALEX}'`) && !!r[0]?.demandes
}

export async function verifierCleAlex(secret: string): Promise<VerdictCleAlex> {
  if (!SECRET_ALEX.test(secret)) return { ok: false, raison: 'inconnue', cleId: null }
  let cles: LigneCle[]
  try {
    if (!(await enService())) return { ok: false, raison: 'pas_en_service', cleId: null }
    cles = await prisma.$queryRaw<LigneCle[]>`
      select c.cle_id::text as cle_id, c.empreinte,
        (select count(*)::int from public.cockpit_tab_acces a
          where a.cle_id = c.cle_id and a.appele_le > now() - interval '1 minute') as appels
      from public.cockpit_tab_cles c
      where c.portee = 'alex_indicateur' and c.coupee_le is null`
  } catch (err) {
    console.error('[mcp-alex] cles illisibles', raison(err).slice(0, 200))
    return { ok: false, raison: 'base', cleId: null }
  }
  const c = cles.length ? choisirCleAlex(cles, secret) : null
  if (!c) return { ok: false, raison: 'inconnue', cleId: null }
  if (c.appels >= DEBIT_PAR_MINUTE_ALEX) return { ok: false, raison: 'debit', cleId: c.cle_id }
  return { ok: true, cleId: c.cle_id, appelsMinute: c.appels }
}

/** Le jour de Paris, AAAA-MM-JJ. */
export function aujourdhuiParis(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })
}

export const lecturesAlex: Lectures = {
  async membres({ depuis, max }): Promise<LigneMembre[]> {
    const lignes = await prisma.$queryRaw<{ prenom: string | null; pseudo_telegram: string | null; pseudo_tradingview: string; pseudo_transmis: string | null; demande_le: string }[]>`
      select prenom, pseudo_telegram, pseudo_tradingview, pseudo_transmis,
        to_char(demande_le at time zone 'Europe/Paris', 'YYYY-MM-DD') as demande_le
      from public.cockpit_liveclub_indicateur
      where depart_le is null
        and (${depuis}::date is null or (demande_le at time zone 'Europe/Paris')::date >= ${depuis}::date)
      order by demande_le, demande_id
      limit ${max}`
    return lignes.map((l) => ({
      prenom: l.prenom, pseudoTelegram: l.pseudo_telegram, pseudoTradingview: l.pseudo_tradingview,
      pseudoTransmis: l.pseudo_transmis, demandeLe: l.demande_le,
    }))
  },
  async departs({ depuis, max }): Promise<LigneDepart[]> {
    const lignes = await prisma.$queryRaw<{ prenom: string | null; pseudo_telegram: string | null; pseudo_tradingview: string; pseudo_transmis: string | null; depart_le: string }[]>`
      select prenom, pseudo_telegram, pseudo_tradingview, pseudo_transmis,
        to_char(depart_le at time zone 'Europe/Paris', 'YYYY-MM-DD') as depart_le
      from public.cockpit_liveclub_indicateur
      where depart_le is not null and (depart_le at time zone 'Europe/Paris')::date >= ${depuis}::date
      order by depart_le, demande_id
      limit ${max}`
    return lignes.map((l) => ({
      prenom: l.prenom, pseudoTelegram: l.pseudo_telegram, pseudoTradingview: l.pseudo_tradingview,
      pseudoTransmis: l.pseudo_transmis, departLe: l.depart_le,
    }))
  },
}
