/**
 * ESSAI de la migration 20261031150000_mails_achat_envoyes.sql (l'anti-doublon
 * des mails d'achat, brief F1, 30/10/2026) et des requetes EXACTES de
 * src/lib/mails-achat-pur.ts, contre la vraie base, dans UNE transaction
 * TOUJOURS ANNULEE (rien ne reste) :
 *   1. la migration, jouee deux fois (rejouable), table fermee (RLS) ;
 *   2. SQL_RESERVER_MAIL : la premiere reservation rend la cle, la seconde rien ;
 *   3. SQL_LIBERER_MAIL apres un echec : la cle se libere et se reserve a nouveau ;
 *   4. SQL_MAIL_PARTI puis SQL_LIBERER_MAIL : une cle partie ne se libere plus.
 * Puis la transaction est annulee, et on verifie hors transaction que rien
 * n'est reste. Aucun mail, aucune donnee personnelle (cles inventees).
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env.local scripts/essayer-migration-mails-achat.mjs
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { SQL_LIBERER_MAIL, SQL_MAIL_PARTI, SQL_RESERVER_MAIL, cleMailAchat } from '../src/lib/mails-achat-pur.ts'

const MIGRATION = new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261031150000_mails_achat_envoyes.sql', import.meta.url)
// Pas de dollar-quoting dans cette migration : le decoupage sur les points-virgules suffit.
const ordres = readFileSync(MIGRATION, 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  .split(';').map(o => o.trim()).filter(o => o && !/^notify /i.test(o))

class Annulation extends Error {}
const prisma = new PrismaClient()
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }

const existe = async c => (await c.$queryRawUnsafe(`select to_regclass('public.mails_achat_envoyes') is not null as la`))[0].la
const avant = await existe(prisma)
if (avant) console.log('La table existe DEJA : l essai joue sur la table en place.')

const SUB = `sub_essai${randomUUID().replace(/-/g, '').slice(0, 16)}`
const CLE = cleMailAchat('pilotage-premium', SUB)
const CLE2 = cleMailAchat('module', `cs_essai_${randomUUID().replace(/-/g, '').slice(0, 16)}`)

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const rls = await tx.$queryRawUnsafe(`select relrowsecurity as rls from pg_class where oid = 'public.mails_achat_envoyes'::regclass`)
    assert.equal(rls[0].rls, true)
    const droits = await tx.$queryRawUnsafe(`select has_table_privilege('anon', 'public.mails_achat_envoyes', 'select') as anon, has_table_privilege('authenticated', 'public.mails_achat_envoyes', 'insert') as auth`)
    assert.deepEqual(droits[0], { anon: false, auth: false })
    ok('migration jouee deux fois : table, RLS, aucun droit pour anon et authenticated')

    assert.deepEqual(await tx.$queryRawUnsafe(SQL_RESERVER_MAIL, CLE, 'pilotage-premium'), [{ cle: CLE }])
    assert.deepEqual(await tx.$queryRawUnsafe(SQL_RESERVER_MAIL, CLE, 'pilotage-premium'), [])
    ok('SQL_RESERVER_MAIL : la premiere reservation gagne, la seconde ne rend rien (un seul mail)')

    assert.deepEqual(await tx.$queryRawUnsafe(SQL_RESERVER_MAIL, CLE2, 'module'), [{ cle: CLE2 }])
    assert.equal(await tx.$executeRawUnsafe(SQL_LIBERER_MAIL, CLE2), 1)
    assert.deepEqual(await tx.$queryRawUnsafe(SQL_RESERVER_MAIL, CLE2, 'module'), [{ cle: CLE2 }])
    ok('SQL_LIBERER_MAIL apres un echec : la cle se reserve a nouveau')

    assert.equal(await tx.$executeRawUnsafe(SQL_MAIL_PARTI, CLE, 'id-essai'), 1)
    assert.equal(await tx.$executeRawUnsafe(SQL_LIBERER_MAIL, CLE), 0)
    const [l] = await tx.$queryRawUnsafe(`select produit, resend_id, envoye_le is not null as date from public.mails_achat_envoyes where cle = $1`, CLE)
    assert.deepEqual(l, { produit: 'pilotage-premium', resend_id: 'id-essai', date: true })
    ok('SQL_MAIL_PARTI : une cle partie ne se libere plus')

    throw new Annulation()
  }, { timeout: 30_000 })
} catch (err) {
  if (!(err instanceof Annulation)) throw err
}

assert.equal(await existe(prisma), avant)
if (avant) {
  const reste = await prisma.$queryRawUnsafe(`select count(*)::int as n from public.mails_achat_envoyes where cle = any($1::text[])`, [CLE, CLE2])
  assert.equal(reste[0].n, 0)
}
ok('transaction annulee : rien n est reste')
await prisma.$disconnect()
console.log(`\n${etapes} etapes ok`)
