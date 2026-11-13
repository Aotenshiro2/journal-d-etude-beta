/**
 * ESSAI de la migration 20261113231500_academie_quiz.sql (le quiz de fin de module, 13/11/2026) et des requetes
 * EXACTES de src/lib/academie/quiz-academie.ts et de l'import (importer-catalogue-academie.mjs, champ « quiz »), contre la
 * vraie base, dans UNE transaction TOUJOURS ANNULEE (rien ne reste) :
 *   0. AVANT la migration (dans des savepoints) : quizDuModule dit 'migration', dernierResultat null,
 *      envoisSurUneHeure 0, noterResultat null (la route marche avant la migration, sans quiz) ; l'import du module
 *      avec son quiz passe, le quiz attend (avertissement) ;
 *   1. la migration, jouee deux fois (rejouable) : RLS activee et forcee ; anon rien, authenticated et
 *      service_role en lecture seule ; deux policies de lecture ;
 *   2. l'import du module Novice en trading AVEC son quiz (le vrai fichier du catalogue), puis le quiz seul
 *      (poserQuiz) : quizDuModule relit le meme quiz, vueQuiz ne laisse sortir aucune bonne reponse ;
 *   3. les gestes de la route : corriger, noterResultat, dernierResultat, envoisSurUneHeure ;
 *   4. LECTURES REJOUEES sous le role authenticated, avec un VRAI sub et un VRAI email (claims du jeton) : deux
 *      membres et un compte de l'equipe ; et sous anon. Un membre ne lit que SES resultats et pas le quiz
 *      (academie_modules reste fermee aux membres) ; l'equipe lit tout ; anon rien ; personne n'ecrit en direct ;
 *   5. les contraintes (score > total, total 0, module inconnu, quiz sans questions ou au statut inconnu).
 * Puis la transaction est annulee, et on verifie hors transaction que ni la colonne ni la table ne sont restees.
 * Les comptes sont lus en base (lecture seule) ; aucun email ni identifiant complet n'est affiche.
 *
 * Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
 *   node --env-file=.env.local scripts/essayer-migration-quiz-academie.mjs [--fichier <novice-en-trading.json>]
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  corriger, dernierResultat, envoisSurUneHeure, noterResultat, quizDuModule, vueQuiz,
} from '../src/lib/academie/quiz-academie.ts'
import { importerModule, lireQuizDuFichier, poserQuiz } from './importer-catalogue-academie.mjs'

const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261113231500_academie_quiz.sql'
const candidats = [
  process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${MIGRATION}`) : null,
  new URL(`../../../${MIGRATION}`, import.meta.url),
].filter(Boolean)
const fichierMigration = candidats.find(u => existsSync(u))
if (!fichierMigration) throw new Error(`migration introuvable : poser AOK_WORKSPACE (${MIGRATION})`)
// Pas de dollar-quoting dans cette migration : le decoupage sur les points-virgules suffit.
const ordres = readFileSync(fichierMigration, 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  .split(';').map(o => o.trim()).filter(Boolean)

const args = process.argv.slice(2)
const iFichier = args.indexOf('--fichier')
const FICHIER = iFichier >= 0 ? args[iFichier + 1] : '/mnt/d/6_Societe/Pilotage/Academie/catalogue/modules/novice-en-trading.json'
const donnees = JSON.parse(readFileSync(FICHIER, 'utf8'))

class Annulation extends Error {}
const prisma = new PrismaClient()
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const court = id => `${String(id).slice(0, 8)}...`
const motif = e => String(e?.message ?? e).split('\n').find(l => /permission|policy|violates|denied|row-level|check constraint|foreign key/i.test(l))?.trim().slice(0, 110) ?? 'refus'

const etatBase = async c => (await c.$queryRawUnsafe(`select
  to_regclass('public.academie_quiz_resultats') is not null as table_la,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'academie_modules' and column_name = 'quiz') as colonne_la`))[0]
const avant = await etatBase(prisma)
if (avant.table_la || avant.colonne_la) throw new Error('La migration est DEJA (en partie) en base : cet essai est fait pour la migration pas encore appliquee.')

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    let n = 0
    const dansSavepoint = async f => {
      const sp = `sp${++n}`
      await tx.$executeRawUnsafe(`savepoint ${sp}`)
      try { return await f() } finally { await tx.$executeRawUnsafe(`rollback to savepoint ${sp}`) }
    }

    /** Un ordre sous un role et des claims donnes (vrai sub, vrai email), dans un savepoint toujours annule. */
    async function comme(role, compte, sql, ...params) {
      return dansSavepoint(async () => {
        try {
          const claims = JSON.stringify(compte ? { sub: compte.id, role, email: compte.email, aud: 'authenticated' } : { role })
          await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, claims)
          await tx.$executeRawUnsafe(`set local role ${role}`)
          return { ok: true, lignes: await tx.$queryRawUnsafe(sql, ...params) }
        } catch (e) {
          return { ok: false, motif: motif(e) }
        }
      })
    }
    async function doitEchouer(nom, sql, ...params) {
      const erreur = await dansSavepoint(async () => {
        try { await tx.$executeRawUnsafe(sql, ...params); return null } catch (err) { return err }
      })
      assert.ok(erreur, `${nom} : l'ordre aurait du etre refuse`)
      ok(`${nom} : refuse (${motif(erreur)})`)
    }

    const [mod] = await tx.$queryRawUnsafe(`select id::text as id from public.academie_modules where slug = $1`, donnees.module.slug)
    assert.ok(mod, `module ${donnees.module.slug} en base`)

    // 0. Avant la migration : la route lit « pas de quiz » et ne garde rien, sans tomber.
    assert.equal(await dansSavepoint(() => quizDuModule(tx, mod.id)), 'migration')
    assert.equal(await dansSavepoint(() => dernierResultat(tx, randomUUID(), mod.id)), null)
    assert.equal(await dansSavepoint(() => envoisSurUneHeure(tx, randomUUID())), 0)
    assert.equal(await dansSavepoint(() => noterResultat(tx, randomUUID(), mod.id, 1, 1, 1, { q1: 'a' })), null)
    ok('avant la migration : quizDuModule = migration, aucun resultat lu ni garde, aucune erreur')
    const bilanAvant = await dansSavepoint(() => importerModule(tx, donnees, dirname(FICHIER)))
    assert.equal(bilanAvant.quiz, undefined)
    assert.ok(bilanAvant.avertissements.some(a => /quiz NON pose/.test(a)), JSON.stringify(bilanAvant.avertissements))
    ok('avant la migration : le module avec son quiz s\'importe quand meme, le quiz attend (avertissement)')

    // 1. La migration, deux fois.
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const [rls] = await tx.$queryRawUnsafe(`select relrowsecurity as rls, relforcerowsecurity as force from pg_class where oid = 'public.academie_quiz_resultats'::regclass`)
    assert.deepEqual(rls, { rls: true, force: true })
    const [droits] = await tx.$queryRawUnsafe(`select
      has_table_privilege('anon', 'public.academie_quiz_resultats', 'select') as anon_lit,
      has_table_privilege('anon', 'public.academie_quiz_resultats', 'insert') as anon_ecrit,
      has_table_privilege('authenticated', 'public.academie_quiz_resultats', 'select') as auth_lit,
      has_table_privilege('authenticated', 'public.academie_quiz_resultats', 'insert') as auth_insert,
      has_table_privilege('authenticated', 'public.academie_quiz_resultats', 'update') as auth_update,
      has_table_privilege('authenticated', 'public.academie_quiz_resultats', 'delete') as auth_delete,
      has_table_privilege('service_role', 'public.academie_quiz_resultats', 'select') as service_lit,
      has_table_privilege('service_role', 'public.academie_quiz_resultats', 'insert') as service_ecrit`)
    assert.deepEqual(droits, {
      anon_lit: false, anon_ecrit: false, auth_lit: true, auth_insert: false, auth_update: false, auth_delete: false,
      service_lit: true, service_ecrit: false,
    })
    const pols = await tx.$queryRawUnsafe(`select policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' and tablename = 'academie_quiz_resultats' order by policyname`)
    assert.deepEqual(pols.map(p => [p.policyname, p.cmd, p.roles]), [
      ['academie_quiz_resultats_auteur', 'SELECT', '{authenticated}'],
      ['academie_quiz_resultats_equipe', 'SELECT', '{authenticated}'],
    ])
    ok('migration jouee deux fois : RLS activee et forcee, deux policies de lecture, anon rien, authenticated et service_role en lecture seule')

    // 2. L'import du module avec son quiz (le vrai fichier), puis le quiz seul.
    const lu = lireQuizDuFichier(donnees)
    assert.equal(lu.present, true)
    assert.ok(lu.quiz && lu.quiz.questions.length >= 1)
    const bilan = await importerModule(tx, donnees, dirname(FICHIER))
    assert.equal(bilan.quiz, `v${lu.quiz.version} ${lu.quiz.statut}, ${lu.quiz.questions.length} questions`)
    const relu = await quizDuModule(tx, mod.id)
    assert.deepEqual(relu, lu.quiz)
    const vue = vueQuiz(relu)
    assert.equal(JSON.stringify(vue).includes('"bonne"'), false)
    assert.equal(JSON.stringify(vue).includes('explication'), false)
    assert.equal(vue.brouillon, lu.quiz.statut !== 'publie')
    ok(`import du module ${donnees.module.slug} avec son quiz (${bilan.quiz}) : relu a l'identique, la vue de la page sans reponse ni explication`)
    assert.equal(await poserQuiz(tx, mod.id, null), 'retire')
    assert.equal(await quizDuModule(tx, mod.id), null)
    assert.equal(await poserQuiz(tx, mod.id, lu.quiz), bilan.quiz)
    const sansChamp = { ...donnees }
    delete sansChamp.quiz
    const bilan2 = await importerModule(tx, sansChamp, dirname(FICHIER))
    assert.equal(bilan2.quiz, undefined)
    assert.deepEqual(await quizDuModule(tx, mod.id), lu.quiz)
    ok('quiz seul : retire puis repose ; un fichier SANS champ quiz ne touche pas a la colonne')

    // 3. Les gestes de la route, avec de vrais comptes (lecture seule).
    const membres = await tx.$queryRawUnsafe(`
      select u.id::text as id, lower(u.email) as email from auth.users u
        join public.profiles p on p.id = u.id
       where p.role::text = 'member' and u.email is not null and u.email_confirmed_at is not null
         and not exists (select 1 from public.cockpit_allowlist c where c.user_id = u.id)
       order by u.created_at limit 2`)
    if (membres.length < 2) throw new Error('il faut deux comptes membres')
    const [A, B] = membres
    const [T] = await tx.$queryRawUnsafe(`
      select c.user_id::text as id, lower(u.email) as email from public.cockpit_allowlist c join auth.users u on u.id = c.user_id
       where c.label = 'Brice' limit 1`)
    assert.ok(T, 'compte de Brice dans l allowlist')
    console.log(`comptes : A ${court(A.id)}, B ${court(B.id)}, equipe ${court(T.id)} ; module ${court(mod.id)}`)

    const toutJuste = Object.fromEntries(lu.quiz.questions.map(q => [q.id, q.bonne]))
    const unFaux = { ...toutJuste, [lu.quiz.questions[0].id]: lu.quiz.questions[0].choix.find(c => c.id !== lu.quiz.questions[0].bonne).id }
    const c1 = corriger(lu.quiz, unFaux)
    const c2 = corriger(lu.quiz, toutJuste)
    assert.equal(c1.bonnes, c1.total - 1)
    assert.equal(c2.bonnes, c2.total)
    const f1 = await noterResultat(tx, A.id, mod.id, lu.quiz.version, c1.bonnes, c1.total, unFaux)
    assert.ok(f1)
    await tx.$executeRawUnsafe(`update public.academie_quiz_resultats set fait_le = now() - interval '2 minutes' where user_id = $1::uuid`, A.id)
    const f2 = await noterResultat(tx, A.id, mod.id, lu.quiz.version, c2.bonnes, c2.total, toutJuste)
    assert.ok(f2)
    await noterResultat(tx, B.id, mod.id, lu.quiz.version, c1.bonnes, c1.total, unFaux)
    const dA = await dernierResultat(tx, A.id, mod.id)
    assert.deepEqual({ ...dA, fait_le: undefined }, { version: lu.quiz.version, bonnes: c2.total, total: c2.total, fait_le: undefined })
    assert.equal(await envoisSurUneHeure(tx, A.id), 2)
    assert.equal(await envoisSurUneHeure(tx, B.id), 1)
    assert.equal(await dernierResultat(tx, randomUUID(), mod.id), null)
    ok('corriger, noterResultat (A deux fois, B une fois), dernierResultat = le plus recent, envoisSurUneHeure par compte')

    // 4. Les lectures rejouees.
    const lecture = `select user_id::text as user_id, bonnes, total from public.academie_quiz_resultats order by fait_le`
    const sA = await comme('authenticated', A, lecture)
    assert.ok(sA.ok, sA.motif)
    assert.equal(sA.lignes.length, 2)
    assert.ok(sA.lignes.every(l => l.user_id === A.id))
    const sB = await comme('authenticated', B, lecture)
    assert.ok(sB.ok, sB.motif)
    assert.equal(sB.lignes.length, 1)
    ok('authenticated, membres (vrais sub et email) : chacun lit SES resultats seulement')
    const qA = await comme('authenticated', A, `select quiz from public.academie_modules where id = $1::uuid`, mod.id)
    assert.ok(!qA.ok || qA.lignes.length === 0, 'un membre ne lit pas le quiz (ni ses bonnes reponses) en direct')
    ok(`authenticated, membre : le quiz en base reste illisible en direct (${qA.ok ? '0 ligne' : qA.motif})`)
    const iA = await comme('authenticated', A, `insert into public.academie_quiz_resultats (user_id, module_id, version, bonnes, total, reponses) values ($1::uuid, $2::uuid, 1, 7, 7, '{}'::jsonb) returning id`, A.id, mod.id)
    assert.equal(iA.ok, false)
    const uA = await comme('authenticated', A, `update public.academie_quiz_resultats set bonnes = total returning id`)
    assert.equal(uA.ok, false)
    ok('authenticated, membre : ni insert ni update en direct (le score passe par la route)')
    const sT = await comme('authenticated', T, lecture)
    assert.ok(sT.ok, sT.motif)
    assert.ok(sT.lignes.length >= 3)
    const qT = await comme('authenticated', T, `select quiz from public.academie_modules where id = $1::uuid`, mod.id)
    assert.ok(qT.ok && qT.lignes.length === 1 && qT.lignes[0].quiz, 'l equipe du cockpit lit le quiz')
    ok('authenticated, equipe (vrai sub et email de Brice) : lit tous les resultats et le quiz')
    const sAnon = await comme('anon', null, lecture)
    assert.equal(sAnon.ok, false)
    ok(`anon : lecture refusee (${sAnon.motif})`)

    // 5. Les contraintes.
    const INS = `insert into public.academie_quiz_resultats (user_id, module_id, version, bonnes, total, reponses) values ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)`
    await doitEchouer('score plus grand que le total', INS, randomUUID(), mod.id, 1, 8, 7, '{}')
    await doitEchouer('total nul', INS, randomUUID(), mod.id, 1, 0, 0, '{}')
    await doitEchouer('module inconnu', INS, randomUUID(), randomUUID(), 1, 1, 1, '{}')
    await doitEchouer('reponses qui ne sont pas un objet', INS, randomUUID(), mod.id, 1, 1, 1, '[]')
    await doitEchouer('quiz sans questions', `update public.academie_modules set quiz = '{"version":1,"statut":"publie","questions":[]}'::jsonb where id = $1::uuid`, mod.id)
    await doitEchouer('quiz au statut inconnu', `update public.academie_modules set quiz = jsonb_set(quiz, '{statut}', '"visible"') where id = $1::uuid`, mod.id)

    throw new Annulation()
  }, { timeout: 90_000, maxWait: 20_000 })
} catch (err) {
  if (!(err instanceof Annulation)) throw err
}

const apres = await etatBase(prisma)
assert.deepEqual(apres, { table_la: false, colonne_la: false })
ok('transaction annulee : ni la colonne ni la table ne sont restees')
await prisma.$disconnect()
console.log(`\n${etapes} etapes ok`)
