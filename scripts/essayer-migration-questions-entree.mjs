/**
 * ESSAI de la migration 20261031170000_academie_questions_entree.sql (les
 * questions d'entree de l'academie, 30/10/2026) et des requetes EXACTES de
 * src/lib/academie/questions-entree.ts, contre la vraie base, dans UNE
 * transaction TOUJOURS ANNULEE (rien ne reste) :
 *   1. la migration, jouee deux fois (rejouable) : RLS activee et forcee, aucun
 *      droit pour anon et authenticated, lecture pour service_role ;
 *   2. etatQuestions : un compte inconnu est « a_poser » ;
 *   3. enregistrerQuestions : la premiere ecriture passe, la seconde (meme
 *      compte, « passe » cette fois) ne remplace rien ;
 *   4. un « passe » s'ecrit sans reponse ;
 *   5. questionsDesComptes et listerQuestions relisent les deux lignes ;
 *   6. les contraintes (passe avec une reponse, ni passe ni reponse, reponse
 *      trop longue, version 0) sont refusees.
 * Puis la transaction est annulee, et on verifie hors transaction que rien
 * n'est reste. Comptes inventes (uuid aleatoires), reponses inventees : aucune
 * donnee de membre n'est lue ni affichee.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env.local scripts/essayer-migration-questions-entree.mjs
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import {
  enregistrerQuestions, etatQuestions, lireSaisieQuestions, listerQuestions, questionsDesComptes,
} from '../src/lib/academie/questions-entree.ts'

const MIGRATION = new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261031170000_academie_questions_entree.sql', import.meta.url)
// Pas de dollar-quoting dans cette migration : le decoupage sur les points-virgules suffit.
const ordres = readFileSync(MIGRATION, 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  .split(';').map(o => o.trim()).filter(o => o && !/^notify /i.test(o))

class Annulation extends Error {}
const prisma = new PrismaClient()
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }

async function doitEchouer(tx, nom, sql, ...params) {
  await tx.$executeRawUnsafe('savepoint essai')
  let erreur = null
  try { await tx.$executeRawUnsafe(sql, ...params) } catch (err) { erreur = err }
  await tx.$executeRawUnsafe('rollback to savepoint essai')
  assert.ok(erreur, `${nom} : l'ordre aurait du etre refuse`)
  const code = /\b(23\d{3})\b/.exec(String(erreur.message ?? erreur))?.[1] ?? 'refuse'
  ok(`${nom} : refuse (${code})`)
}

const existe = async c => (await c.$queryRawUnsafe(`select to_regclass('public.academie_questions_entree') is not null as la`))[0].la
const avant = await existe(prisma)
if (avant) console.log('La table existe DEJA : l essai joue sur la table en place.')

const A = randomUUID()
const B = randomUUID()
const INSERT = `insert into public.academie_questions_entree (user_id, version, question_1, reponse_1, question_2, reponse_2, passe)
values ($1::uuid, $2::int, 'Q1', $3, 'Q2', $4, $5::boolean)`

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const [rls] = await tx.$queryRawUnsafe(`select relrowsecurity as rls, relforcerowsecurity as force from pg_class where oid = 'public.academie_questions_entree'::regclass`)
    assert.deepEqual(rls, { rls: true, force: true })
    const [droits] = await tx.$queryRawUnsafe(`select
      has_table_privilege('anon', 'public.academie_questions_entree', 'select') as anon_lit,
      has_table_privilege('anon', 'public.academie_questions_entree', 'insert') as anon_ecrit,
      has_table_privilege('authenticated', 'public.academie_questions_entree', 'select') as auth_lit,
      has_table_privilege('authenticated', 'public.academie_questions_entree', 'insert') as auth_ecrit,
      has_table_privilege('service_role', 'public.academie_questions_entree', 'select') as service_lit`)
    assert.deepEqual(droits, { anon_lit: false, anon_ecrit: false, auth_lit: false, auth_ecrit: false, service_lit: true })
    const [pol] = await tx.$queryRawUnsafe(`select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'academie_questions_entree'`)
    assert.equal(pol.n, 0)
    ok('migration jouee deux fois : RLS activee et forcee, aucune policy, rien pour anon et authenticated, lecture service_role')

    assert.equal(await etatQuestions(tx, A), 'a_poser')
    ok('etatQuestions : un compte sans ligne est a_poser')

    const reponses = lireSaisieQuestions({ version: 1, reponse_1: 'Reponse d essai 1', reponse_2: '' })
    const passe = lireSaisieQuestions({ version: 1, passe: true })
    assert.equal(await enregistrerQuestions(tx, A, reponses), 'enregistre')
    assert.equal(await enregistrerQuestions(tx, A, passe), 'deja')
    assert.equal(await etatQuestions(tx, A), 'faites')
    const [a] = await questionsDesComptes(tx, [A])
    assert.equal(a.passe, false)
    assert.deepEqual(a.reponses, ['Reponse d essai 1', null])
    assert.deepEqual(a.questions, [...reponses.questions])
    assert.equal(a.version, 1)
    ok('enregistrerQuestions : une seule fois (la seconde ecriture rend deja et ne remplace rien), questions gardees mot pour mot')

    assert.equal(await enregistrerQuestions(tx, B, passe), 'enregistre')
    const [b] = await questionsDesComptes(tx, [B])
    assert.deepEqual({ passe: b.passe, reponses: b.reponses }, { passe: true, reponses: [null, null] })
    ok('un « passe » s ecrit sans reponse')

    const deux = await questionsDesComptes(tx, [A, B, randomUUID()])
    assert.deepEqual(deux.map(l => l.user_id).sort(), [A, B].sort())
    const liste = await listerQuestions(tx, new Date(Date.now() - 3600 * 1000), 1000)
    assert.ok(liste.some(l => l.user_id === A) && liste.some(l => l.user_id === B))
    assert.ok(liste.every(l => typeof l.repondu_le === 'string'))
    const futur = await listerQuestions(tx, new Date(Date.now() + 24 * 3600 * 1000), 1000)
    assert.equal(futur.length, 0)
    const sansDate = await listerQuestions(tx, null, 1)
    assert.equal(sansDate.length, 1)
    ok('questionsDesComptes et listerQuestions relisent les lignes (filtre de date, limite)')

    await doitEchouer(tx, 'passe avec une reponse', INSERT, randomUUID(), 1, 'x', null, true)
    await doitEchouer(tx, 'ni passe ni reponse', INSERT, randomUUID(), 1, null, null, false)
    await doitEchouer(tx, 'reponse de 2001 caracteres', INSERT, randomUUID(), 1, 'x'.repeat(2001), null, false)
    await doitEchouer(tx, 'reponse vide (chaine)', INSERT, randomUUID(), 1, '', 'y', false)
    await doitEchouer(tx, 'version 0', INSERT, randomUUID(), 0, 'x', null, false)

    throw new Annulation()
  }, { timeout: 30_000 })
} catch (err) {
  if (!(err instanceof Annulation)) throw err
}

assert.equal(await existe(prisma), avant)
if (avant) {
  const [reste] = await prisma.$queryRawUnsafe(`select count(*)::int as n from public.academie_questions_entree where user_id = any($1::uuid[])`, [A, B])
  assert.equal(reste.n, 0)
}
ok('transaction annulee : rien n est reste')
await prisma.$disconnect()
console.log(`\n${etapes} etapes ok`)
