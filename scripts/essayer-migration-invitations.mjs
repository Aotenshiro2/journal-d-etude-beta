/**
 * ESSAI de la migration 20261108200000_academie_invitations.sql (invitations des membres de Skool, 08/11/2026)
 * et des requetes EXACTES du script d'envoi (scripts/inviter-membres-skool.mjs) et de la route
 * (src/lib/academie/invitations-pur.ts), contre la vraie base, dans UNE transaction TOUJOURS ANNULEE :
 *   1. la migration, jouee deux fois (rejouable), table fermee (RLS forcee, aucun droit anon ni authenticated) ;
 *   2. contraintes : email en minuscules, version connue, jeton seulement pour un payant, (lot, email) unique ;
 *   3. envoi : SQL_PREPARER, SQL_RESERVER (une seule reservation), SQL_REUSSI, puis SQL_PREPARER ne rend plus rien ;
 *      payant devenu payant-compte avant l'envoi : le jeton est retire ;
 *   4. route : SQL_TROUVER par jeton_hash, SQL_NOTER (premier clic garde, clics comptes) ;
 *   5. relance : SQL_RESERVER relance, SQL_REUSSI relance, SQL_ECHEC.
 * Puis la transaction est annulee, et on verifie hors transaction que rien n'est reste. Aucun email, aucun
 * compte cree (adresses @example.com inventees ; le user_id de SQL_NOTER est celui d'un compte existant, lu
 * dans la transaction, jamais affiche).
 *
 * PAS LANCE le 08/11 (consigne : lectures seules en base avant le go de Brice). A lancer avant d'appliquer la
 * migration, depuis apps/journal-d-etude :
 *   node --env-file=.env.local scripts/essayer-migration-invitations.mjs
 * La migration cree une cle etrangere vers auth.users : verrou court sur auth.users pendant l'essai (lock_timeout 5 s).
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { SQL_NOTER, SQL_TROUVER, deriverJeton, hacherJeton } from '../src/lib/academie/invitations-pur.ts'
import { SQL_ECHEC, SQL_PREPARER, SQL_RESERVER, SQL_REUSSI } from './inviter-membres-skool.mjs'

const MIGRATION = new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261108200000_academie_invitations.sql', import.meta.url)
// Comme scripts/appliquer-migration.mjs : lignes de commentaire retirees, coupe aux points-virgules (pas de bloc
// dollar dans cette migration). notify n'a d'effet qu'a la validation : retire de l'essai.
const ordres = readFileSync(process.env.MIGRATION_FICHIER ?? MIGRATION, 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  .split(';').map(o => o.trim()).filter(o => o && !/^notify /i.test(o))

class Annulation extends Error {}
const prisma = new PrismaClient()
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const existe = async c => (await c.$queryRawUnsafe(`select to_regclass('public.academie_invitations') is not null as la`))[0].la

if (await existe(prisma)) {
  console.log('La table existe DEJA (migration appliquee ?) : essai arrete, rien n est fait.')
  await prisma.$disconnect()
  process.exit(1)
}

const LOT = `essai-${randomUUID().slice(0, 8)}`
const A = `essai-a-${randomUUID().slice(0, 8)}@example.com`
const B = `essai-b-${randomUUID().slice(0, 8)}@example.com`
const SECRET = 'secret-de-l-essai-de-migration-0123456789-abcdef'

/** Un ordre qui doit echouer : joue sous un point de sauvegarde, rend le code SQL. */
async function refuse(tx, sql, ...params) {
  await tx.$executeRawUnsafe('savepoint essai')
  try {
    await tx.$executeRawUnsafe(sql, ...params)
  } catch (e) {
    await tx.$executeRawUnsafe('rollback to savepoint essai')
    return e?.meta?.code ?? e?.code ?? 'erreur'
  }
  await tx.$executeRawUnsafe('release savepoint essai')
  throw new Error(`ordre accepte alors qu il devait etre refuse : ${sql.slice(0, 80)}`)
}

try {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    for (const passe of [1, 2]) {
      for (const o of ordres) await tx.$executeRawUnsafe(o)
      ok(`migration jouee (passe ${passe}, ${ordres.length} ordres)`)
    }
    const [rls] = await tx.$queryRawUnsafe(`
      select c.relrowsecurity as rls, c.relforcerowsecurity as force,
             has_table_privilege('anon', c.oid, 'select') as anon_lit,
             has_table_privilege('authenticated', c.oid, 'select') as auth_lit,
             has_table_privilege('authenticated', c.oid, 'insert') as auth_ecrit,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = 'academie_invitations') as policies
        from pg_class c where c.oid = 'public.academie_invitations'::regclass`)
    assert.deepEqual(rls, { rls: true, force: true, anon_lit: false, auth_lit: false, auth_ecrit: false, policies: 0 })
    ok('table fermee : RLS forcee, aucune policy, aucun droit anon ni authenticated')

    // 2. Contraintes.
    const ins = `insert into public.academie_invitations (lot, email, version, jeton_hash, expire_le) values ($1, $2, $3, $4, $5::timestamptz)`
    const demain = new Date(Date.now() + 86400000).toISOString()
    assert.equal(await refuse(tx, ins, LOT, A.toUpperCase(), 'gratuit', null, null), '23514')
    assert.equal(await refuse(tx, ins, LOT, A, 'premium', null, null), '23514')
    assert.equal(await refuse(tx, ins, LOT, A, 'gratuit', 'a'.repeat(64), demain), '23514')
    assert.equal(await refuse(tx, ins, LOT, A, 'payant', 'a'.repeat(64), null), '23514')
    assert.equal(await refuse(tx, ins, LOT, A, 'payant', 'XYZ', demain), '23514')
    assert.equal(await refuse(tx, ins, 'Lot Faux', A, 'gratuit', null, null), '23514')
    ok('contraintes : minuscules, version, jeton pour payant seulement, jeton et expiration ensemble, lot')

    // 3. Envoi.
    const [a] = await tx.$queryRawUnsafe(SQL_PREPARER, LOT, A, 'payant', 'Alice', 'agent:essai')
    assert.equal(a.jeton_numero, 0)
    assert.equal(a.envoye_le, null)
    const jeton = deriverJeton(SECRET, a.id, 1)
    const expire = new Date(Date.now() + 14 * 86400000).toISOString()
    assert.equal((await tx.$queryRawUnsafe(SQL_RESERVER.envoi, a.id, hacherJeton(jeton), 1, expire, 30)).length, 1)
    assert.equal((await tx.$queryRawUnsafe(SQL_RESERVER.envoi, a.id, hacherJeton(jeton), 1, expire, 30)).length, 0, 'deja reservee')
    await tx.$executeRawUnsafe(SQL_REUSSI.envoi, a.id, 're_essai_1')
    assert.equal((await tx.$queryRawUnsafe(SQL_PREPARER, LOT, A, 'payant', 'Alice', 'agent:essai')).length, 0, 'deja envoyee')
    assert.equal(await refuse(tx, ins, LOT, A, 'gratuit', null, null), '23505')
    ok('envoi : preparer, reserver une fois, reussi ; un second passage ne reprend pas la ligne ; (lot, email) unique')

    const [b] = await tx.$queryRawUnsafe(SQL_PREPARER, LOT, B, 'payant', null, 'agent:essai')
    await tx.$queryRawUnsafe(SQL_RESERVER.envoi, b.id, hacherJeton(deriverJeton(SECRET, b.id, 1)), 1, expire, 0)
    await tx.$executeRawUnsafe(SQL_ECHEC, b.id, 'Resend : essai')
    const [b2] = await tx.$queryRawUnsafe(SQL_PREPARER, LOT, B, 'payant-compte', 'Bruno', 'agent:essai')
    assert.equal(b2.version, 'payant-compte')
    assert.equal(b2.jeton_hash, null)
    assert.equal(b2.expire_le, null)
    assert.equal(b2.prenom, 'Bruno')
    assert.equal(b2.erreur, 'Resend : essai')
    assert.equal(b2.reserve_le, null)
    ok('echec puis compte cree entre-temps : la ligne passe en payant-compte, jeton retire')

    // 4. Route.
    const [t] = await tx.$queryRawUnsafe(SQL_TROUVER, hacherJeton(jeton))
    assert.equal(t.id, a.id)
    assert.equal(t.email, A)
    assert.equal(t.version, 'payant')
    assert.ok(t.expire_le instanceof Date)
    assert.equal((await tx.$queryRawUnsafe(SQL_TROUVER, hacherJeton(deriverJeton(SECRET, a.id, 2)))).length, 0)
    const [u] = await tx.$queryRawUnsafe(`select id::text as id from auth.users order by created_at limit 1`)
    await tx.$executeRawUnsafe(SQL_NOTER, a.id, u.id, true)
    const [n1] = await tx.$queryRawUnsafe(`select ouvert_le, compte_le, clics, compte_cree, user_id::text as user_id from public.academie_invitations where id = $1::uuid`, a.id)
    await tx.$executeRawUnsafe(SQL_NOTER, a.id, u.id, false)
    const [n2] = await tx.$queryRawUnsafe(`select ouvert_le, compte_le, clics, compte_cree from public.academie_invitations where id = $1::uuid`, a.id)
    assert.equal(n1.clics, 1)
    assert.equal(n2.clics, 2)
    assert.equal(n1.compte_cree, true)
    assert.equal(n2.compte_cree, true, 'cree reste vrai')
    assert.equal(n2.ouvert_le.getTime(), n1.ouvert_le.getTime(), 'premier clic garde')
    assert.equal(n1.user_id, u.id)
    ok('route : trouver par jeton_hash, noter (premier clic garde, clics, compte)')

    // 5. Relance.
    assert.equal((await tx.$queryRawUnsafe(SQL_RESERVER.relance, b.id, null, 0, null, 30)).length, 0, 'jamais envoyee : pas de relance')
    const jeton2 = deriverJeton(SECRET, a.id, 2)
    assert.equal((await tx.$queryRawUnsafe(SQL_RESERVER.relance, a.id, hacherJeton(jeton2), 2, expire, 30)).length, 1)
    await tx.$executeRawUnsafe(SQL_REUSSI.relance, a.id, 're_essai_2')
    assert.equal((await tx.$queryRawUnsafe(SQL_RESERVER.relance, a.id, hacherJeton(jeton2), 2, expire, 0)).length, 0, 'deja relancee')
    assert.equal((await tx.$queryRawUnsafe(SQL_TROUVER, hacherJeton(jeton2)))[0].id, a.id, 'le nouveau lien ouvre la ligne')
    ok('relance : reservee une fois, nouveau jeton actif')

    throw new Annulation()
  }, { timeout: 60_000, maxWait: 20_000 })
} catch (e) {
  if (!(e instanceof Annulation)) {
    console.error('ECHEC :', String(e?.message ?? e).split('\n').slice(-4).join(' ').replace(/[^\s@;,()]+@[^\s@;,()]+/g, '[email]'))
    process.exitCode = 1
  }
}

assert.equal(await existe(prisma), false, 'la table ne doit pas rester')
ok('transaction annulee : rien n est reste en base')
await prisma.$disconnect()
console.log(`\n${etapes} etapes${process.exitCode ? ' (ECHEC plus haut)' : ' ok'}`)
