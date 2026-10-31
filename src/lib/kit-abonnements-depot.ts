// Le depot des abonnements aux emails (31/10/2026) : ce que la logique
// (kit-abonnements-pur.ts) lit et ecrit en base. Tables de la migration
// 20261031223000_kit_abonnements.sql (profile_kit, profile_consentements,
// serveur seul) et fonction aok_email_communications (20261031211000).
//
// Prend un client Prisma ou une transaction : l'essai de la migration
// (scripts/essayer-migration-kit-abonnements.mjs) le joue dans une transaction
// toujours annulee. N'importe que des types : Node l'importe tel quel.

import type { DepotAbonnements, LigneConsentement } from './kit-abonnements-pur'

type Db = {
  $queryRawUnsafe<T = unknown>(requete: string, ...valeurs: unknown[]): Promise<T>
  $executeRawUnsafe(requete: string, ...valeurs: unknown[]): Promise<number>
}

/** Une violation d'unicite (abonne deja lie a un autre compte, course entre deux requetes). */
function doublon(err: unknown): boolean {
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; meta?: { code?: unknown } }
  return e.code === '23505' || e.meta?.code === '23505' || (e.code === 'P2010' && e.meta?.code === '23505')
}

export function depotPrisma(db: Db): DepotAbonnements {
  return {
    async adresse(userId) {
      const r = await db.$queryRawUnsafe<{ e: string | null }[]>(
        'select public.aok_email_communications($1::uuid) as e', userId)
      return r[0]?.e ?? null
    },
    async prenom(userId) {
      const r = await db.$queryRawUnsafe<{ p: string | null }[]>(
        'select nullif(btrim(first_name), \'\') as p from public.profiles where id = $1::uuid', userId)
      return r[0]?.p ?? null
    },
    async lien(userId) {
      const r = await db.$queryRawUnsafe<{ k: string }[]>(
        'select kit_abonne_id::text as k from public.profile_kit where profile_id = $1::uuid', userId)
      return r[0] ? Number(r[0].k) : null
    },
    async lier(userId, kitId) {
      try {
        const r = await db.$queryRawUnsafe<{ k: string }[]>(
          `insert into public.profile_kit (profile_id, kit_abonne_id)
           select $1::uuid, $2::bigint
            where not exists (select 1 from public.profile_kit
                               where kit_abonne_id = $2::bigint and profile_id <> $1::uuid)
           on conflict (profile_id) do update set kit_abonne_id = excluded.kit_abonne_id, maj_le = now()
           returning kit_abonne_id::text as k`, userId, kitId)
        return r.length === 1
      } catch (err) {
        if (doublon(err)) return false
        throw err
      }
    },
    async delier(userId) {
      await db.$executeRawUnsafe('delete from public.profile_kit where profile_id = $1::uuid', userId)
    },
    async consentir(userId, lignes: LigneConsentement[]) {
      for (const l of lignes) {
        await db.$executeRawUnsafe(
          `insert into public.profile_consentements (profile_id, type, kit_tag_id, valeur, source, kit_abonne_id)
           values ($1::uuid, $2, $3::bigint, $4, $5, $6::bigint)`,
          userId, l.type, l.tag, l.valeur, l.source, l.kitId)
      }
    },
  }
}
