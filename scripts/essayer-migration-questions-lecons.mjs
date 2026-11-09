/**
 * ESSAI de la migration 20261109090000_academie_questions_lecons.sql (les
 * questions sous les lecons, 09/11/2026) et des requetes EXACTES de
 * src/lib/academie/questions-lecons.ts, contre la vraie base, dans UNE
 * transaction TOUJOURS ANNULEE (rien ne reste) :
 *   1. la migration, jouee deux fois (rejouable) : RLS activee et forcee ;
 *      anon rien, authenticated lecture seule, service_role lecture seule ;
 *   2. les gestes du journal (role postgres) : poser, la limite de 5 sur
 *      24 heures, repondre (publier, prive), retoucher, ecarter, la boite ;
 *   3. ce que la page recoit (questionsDeLecon) pour l'auteur, un autre
 *      membre et un troisieme ;
 *   4. LECTURES REJOUEES sous le role authenticated, avec un VRAI sub et un
 *      VRAI email (claims du jeton) : deux membres du site et un compte de
 *      l'equipe ; et sous anon. Un membre ne lit que SES lignes, n'ecrit
 *      rien ; l'equipe lit tout ; anon rien ;
 *   5. les contraintes (statut inconnu, en attente avec reponse, publiee sans
 *      reponse, question vide ou trop longue) sont refusees.
 * Puis la transaction est annulee, et on verifie hors transaction que la
 * table n'est pas restee. Les comptes sont lus en base (lecture seule) ;
 * aucun email ni identifiant complet n'est affiche.
 *
 * Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
 *   node --env-file=.env.local scripts/essayer-migration-questions-lecons.mjs
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import {
  MAX_QUESTIONS_JOUR, ecarterQuestion, lireDemandeEquipe, listerPourEquipe, poseesSur24h, poserQuestion, premiereReponse,
  questionsDeLecon, repondreQuestion, signatureDuCompte,
} from '../src/lib/academie/questions-lecons.ts'

const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261109090000_academie_questions_lecons.sql'
const candidats = [
  process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${MIGRATION}`) : null,
  new URL(`../../../${MIGRATION}`, import.meta.url),
].filter(Boolean)
const fichier = candidats.find(u => existsSync(u))
if (!fichier) throw new Error(`migration introuvable : poser AOK_WORKSPACE (${MIGRATION})`)
// Pas de dollar-quoting dans cette migration : le decoupage sur les points-virgules suffit.
const ordres = readFileSync(fichier, 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  .split(';').map(o => o.trim()).filter(Boolean)

class Annulation extends Error {}
const prisma = new PrismaClient()
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const court = id => `${String(id).slice(0, 8)}...`
const motif = e => String(e?.message ?? e).split('\n').find(l => /permission|policy|violates|denied|row-level|check constraint/i.test(l))?.trim().slice(0, 110) ?? 'refus'

const existe = async c => (await c.$queryRawUnsafe(`select to_regclass('public.academie_questions_lecons') is not null as la`))[0].la
if (await existe(prisma)) throw new Error('La table existe DEJA en base : cet essai est fait pour la migration pas encore appliquee.')

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    let n = 0

    /** Un ordre sous un role et des claims donnes (vrai sub, vrai email), dans un savepoint toujours annule. */
    async function comme(role, compte, sql, ...params) {
      const sp = `sp${++n}`
      await tx.$executeRawUnsafe(`savepoint ${sp}`)
      try {
        const claims = JSON.stringify(compte ? { sub: compte.id, role, email: compte.email, aud: 'authenticated' } : { role })
        await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, claims)
        await tx.$executeRawUnsafe(`set local role ${role}`)
        const lignes = await tx.$queryRawUnsafe(sql, ...params)
        return { ok: true, lignes }
      } catch (e) {
        return { ok: false, motif: motif(e) }
      } finally {
        await tx.$executeRawUnsafe(`rollback to savepoint ${sp}`)
      }
    }
    async function doitEchouer(nom, sql, ...params) {
      const sp = `sp${++n}`
      await tx.$executeRawUnsafe(`savepoint ${sp}`)
      let erreur = null
      try { await tx.$executeRawUnsafe(sql, ...params) } catch (err) { erreur = err }
      await tx.$executeRawUnsafe(`rollback to savepoint ${sp}`)
      assert.ok(erreur, `${nom} : l'ordre aurait du etre refuse`)
      ok(`${nom} : refuse (${motif(erreur)})`)
    }

    // 1. La migration, deux fois.
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const [rls] = await tx.$queryRawUnsafe(`select relrowsecurity as rls, relforcerowsecurity as force from pg_class where oid = 'public.academie_questions_lecons'::regclass`)
    assert.deepEqual(rls, { rls: true, force: true })
    const [droits] = await tx.$queryRawUnsafe(`select
      has_table_privilege('anon', 'public.academie_questions_lecons', 'select') as anon_lit,
      has_table_privilege('anon', 'public.academie_questions_lecons', 'insert') as anon_ecrit,
      has_table_privilege('authenticated', 'public.academie_questions_lecons', 'select') as auth_lit,
      has_table_privilege('authenticated', 'public.academie_questions_lecons', 'insert') as auth_insert,
      has_table_privilege('authenticated', 'public.academie_questions_lecons', 'update') as auth_update,
      has_table_privilege('authenticated', 'public.academie_questions_lecons', 'delete') as auth_delete,
      has_table_privilege('service_role', 'public.academie_questions_lecons', 'select') as service_lit,
      has_table_privilege('service_role', 'public.academie_questions_lecons', 'insert') as service_ecrit`)
    assert.deepEqual(droits, {
      anon_lit: false, anon_ecrit: false, auth_lit: true, auth_insert: false, auth_update: false, auth_delete: false,
      service_lit: true, service_ecrit: false,
    })
    const pols = await tx.$queryRawUnsafe(`select policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' and tablename = 'academie_questions_lecons' order by policyname`)
    assert.deepEqual(pols.map(p => [p.policyname, p.cmd, p.roles]), [
      ['academie_questions_lecons_auteur', 'SELECT', '{authenticated}'],
      ['academie_questions_lecons_equipe', 'SELECT', '{authenticated}'],
    ])
    ok('migration jouee deux fois : RLS activee et forcee, deux policies de lecture, anon rien, authenticated et service_role en lecture seule')

    // Les comptes et la lecon, lus en base (lecture seule).
    const membres = await tx.$queryRawUnsafe(`
      select u.id::text as id, lower(u.email) as email from auth.users u
        join public.profiles p on p.id = u.id
       where p.role::text = 'member' and u.email is not null and u.email_confirmed_at is not null
         and not exists (select 1 from public.cockpit_allowlist c where c.user_id = u.id)
       order by u.created_at limit 3`)
    if (membres.length < 3) throw new Error('il faut trois comptes membres')
    const [A, B, C] = membres
    const [T] = await tx.$queryRawUnsafe(`
      select c.user_id::text as id, lower(u.email) as email from public.cockpit_allowlist c join auth.users u on u.id = c.user_id
       where c.label = 'Brice' limit 1`)
    assert.ok(T, 'compte de Brice dans l allowlist')
    const [L] = await tx.$queryRawUnsafe(`
      select l.id::text as id from public.academie_lecons l join public.academie_modules m on m.id = l.module_id
       where l.statut = 'publie' and m.statut = 'publie' order by m.ordre, l.ordre limit 1`)
    console.log(`comptes : A ${court(A.id)}, B ${court(B.id)}, C ${court(C.id)}, equipe ${court(T.id)} ; lecon ${court(L.id)}`)

    // 2. Les gestes du journal.
    const qA = await poserQuestion(tx, A.id, L.id, 'Question d essai de A (en attente)')
    const qB = await poserQuestion(tx, B.id, L.id, 'Question d essai de B, Brice')
    const qA2 = await poserQuestion(tx, A.id, L.id, 'Seconde question d essai de A (privee)')
    const qC = await poserQuestion(tx, C.id, L.id, 'Question d essai de C (ecartee)')
    for (const q of [qA, qB, qA2, qC]) assert.equal(q.statut, 'en_attente')
    assert.equal(await poseesSur24h(tx, A.id), 2)
    ok('poserQuestion : quatre questions en attente, poseesSur24h compte celles du compte')

    const X = randomUUID()
    for (let i = 0; i < MAX_QUESTIONS_JOUR; i++) assert.notEqual(await poserQuestion(tx, X, L.id, `Essai ${i}`), 'limite')
    assert.equal(await poserQuestion(tx, X, L.id, 'Une de trop'), 'limite')
    await tx.$executeRawUnsafe(`update public.academie_questions_lecons set cree_le = now() - interval '25 hours' where user_id = $1::uuid`, X)
    assert.notEqual(await poserQuestion(tx, X, L.id, 'Le lendemain'), 'limite')
    ok(`limite : ${MAX_QUESTIONS_JOUR} questions sur 24 heures, la suivante refusee, de nouveau possible 24 heures apres`)

    const signature = await signatureDuCompte(tx, T.id)
    assert.equal(signature, 'Brice')
    const rB = await repondreQuestion(tx, lireDemandeEquipe({ action: 'repondre', id: qB.id, reponse: 'Reponse publiee d essai', question: 'Question d essai de B', mode: 'publier' }), T.id, signature)
    assert.equal(rB.avant, 'en_attente')
    assert.equal(rB.statut, 'publiee')
    assert.equal(premiereReponse(rB.avant), true)
    assert.ok(rB.lecon_slug && rB.module_slug && rB.lecon_titre && rB.module_titre)
    assert.equal(typeof rB.email, 'string')
    const rA2 = await repondreQuestion(tx, lireDemandeEquipe({ action: 'repondre', id: qA2.id, reponse: 'Reponse privee d essai', mode: 'prive' }), T.id, signature)
    assert.equal(rA2.statut, 'privee')
    const retouche = await repondreQuestion(tx, lireDemandeEquipe({ action: 'repondre', id: qB.id, reponse: 'Reponse publiee retouchee', question: 'Question d essai de B', mode: 'publier' }), randomUUID(), 'Autre')
    assert.equal(retouche.avant, 'publiee')
    assert.equal(premiereReponse(retouche.avant), false, 'une retouche n envoie pas d email')
    assert.equal(retouche.signature, 'Brice', 'une retouche garde la signature')
    assert.equal(await ecarterQuestion(tx, qC.id, T.id), true)
    assert.equal(await ecarterQuestion(tx, qC.id, T.id), false, 'deja ecartee')
    assert.equal(await ecarterQuestion(tx, qB.id, T.id), false, 'une publiee ne s ecarte pas')
    assert.equal(await repondreQuestion(tx, lireDemandeEquipe({ action: 'repondre', id: randomUUID(), reponse: 'x', mode: 'prive' }), T.id, signature), null)
    ok('repondre (publier, prive), retouche sans email ni changement de signature, ecarter une seule fois, question inconnue')

    const attente = await listerPourEquipe(tx, 'attente')
    assert.ok(attente.questions.some(q => q.id === qA.id))
    assert.ok(attente.questions.every(q => q.statut === 'en_attente'))
    assert.ok(attente.attente >= 1 + MAX_QUESTIONS_JOUR + 1)
    const ligneA = attente.questions.find(q => q.id === qA.id)
    assert.ok(ligneA.email && ligneA.lecon_titre && ligneA.module_titre)
    const traitees = await listerPourEquipe(tx, 'traitees')
    assert.ok([qB.id, qA2.id, qC.id].every(id => traitees.questions.some(q => q.id === id)))
    assert.ok(traitees.questions.every(q => q.statut !== 'en_attente'))
    ok('la boite : en attente (avec lecon, module, email de l auteur) et traitees')

    // 3. Ce que la page recoit.
    const vueA = await questionsDeLecon(tx, L.id, A.id)
    const idsA = vueA.map(q => q.id)
    assert.ok(idsA.includes(qA.id) && idsA.includes(qA2.id) && idsA.includes(qB.id))
    assert.ok(!idsA.includes(qC.id), 'la question ecartee de C')
    assert.equal(vueA.find(q => q.id === qA2.id).reponse, 'Reponse privee d essai')
    assert.equal(vueA.find(q => q.id === qB.id).question, 'Question d essai de B', 'texte corrige')
    assert.equal(vueA.find(q => q.id === qB.id).mienne, false)
    const vueB = await questionsDeLecon(tx, L.id, B.id)
    assert.ok(!vueB.some(q => q.id === qA.id || q.id === qA2.id), 'B ne voit ni la question en attente de A ni sa reponse privee')
    assert.ok(vueB.find(q => q.id === qB.id).mienne)
    const vueC = await questionsDeLecon(tx, L.id, C.id)
    assert.ok(vueC.find(q => q.id === qC.id)?.statut === 'ecartee', 'C voit sa question ecartee')
    assert.ok(!vueC.some(q => q.id === qA.id || q.id === qA2.id))
    for (const q of [...vueA, ...vueB, ...vueC]) assert.ok(!('user_id' in q) && !('email' in q))
    ok('questionsDeLecon : l auteur voit ses questions et sa reponse privee, les autres seulement la publiee, aucun compte dans la reponse')

    // 4. Lectures rejouees sous authenticated (vrai sub, vrai email) et anon.
    const lecture = `select id::text as id, user_id::text as user_id, statut from public.academie_questions_lecons`
    const sA = await comme('authenticated', A, lecture)
    assert.ok(sA.ok, sA.motif)
    assert.deepEqual(new Set(sA.lignes.map(l => l.user_id)), new Set([A.id]), 'A ne lit que ses lignes')
    assert.deepEqual(sA.lignes.map(l => l.id).sort(), [qA.id, qA2.id].sort())
    const sB = await comme('authenticated', B, lecture)
    assert.ok(sB.ok && sB.lignes.length === 1 && sB.lignes[0].id === qB.id, 'B ne lit que la sienne (la publiee de A ne sort pas en direct)')
    ok('authenticated, membre A puis B (vrai sub et email) : chacun ne lit que SES lignes, rien des autres, rien de prive')

    const iA = await comme('authenticated', A, `insert into public.academie_questions_lecons (user_id, lecon_id, question) values ($1::uuid, $2::uuid, 'ecrite en direct') returning id`, A.id, L.id)
    assert.equal(iA.ok, false)
    const uA = await comme('authenticated', A, `update public.academie_questions_lecons set statut = 'publiee', reponse = 'moi', traitee_le = now() where user_id = $1::uuid returning id`, A.id)
    assert.equal(uA.ok, false)
    const dA = await comme('authenticated', A, `delete from public.academie_questions_lecons where user_id = $1::uuid returning id`, A.id)
    assert.equal(dA.ok, false)
    ok(`authenticated, membre A : insert, update et delete refuses (${iA.motif} / ${uA.motif} / ${dA.motif})`)

    const sT = await comme('authenticated', T, lecture)
    assert.ok(sT.ok, sT.motif)
    for (const id of [qA.id, qA2.id, qB.id, qC.id]) assert.ok(sT.lignes.some(l => l.id === id))
    const uT = await comme('authenticated', T, `update public.academie_questions_lecons set reponse = 'directe' where id = $1::uuid returning id`, qB.id)
    assert.equal(uT.ok, false, 'l equipe repond par la route, jamais en direct')
    ok('authenticated, equipe (vrai sub et email de Brice) : lit tout, n ecrit rien en direct')

    const sAnon = await comme('anon', null, lecture)
    assert.equal(sAnon.ok, false)
    ok(`anon : lecture refusee (${sAnon.motif})`)

    // 5. Les contraintes.
    const INS = `insert into public.academie_questions_lecons (user_id, lecon_id, question, statut, reponse, traitee_le) values ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz)`
    await doitEchouer('statut inconnu', INS, randomUUID(), L.id, 'q', 'visible', null, null)
    await doitEchouer('en attente avec une reponse', INS, randomUUID(), L.id, 'q', 'en_attente', 'r', null)
    await doitEchouer('publiee sans reponse', INS, randomUUID(), L.id, 'q', 'publiee', null, new Date().toISOString())
    await doitEchouer('question vide', INS, randomUUID(), L.id, '   ', 'en_attente', null, null)
    await doitEchouer('question de 1001 caracteres', INS, randomUUID(), L.id, 'x'.repeat(1001), 'en_attente', null, null)
    await doitEchouer('lecon inconnue', INS, randomUUID(), randomUUID(), 'q', 'en_attente', null, null)

    throw new Annulation()
  }, { timeout: 60_000 })
} catch (err) {
  if (!(err instanceof Annulation)) throw err
}

assert.equal(await existe(prisma), false)
ok('transaction annulee : la table n est pas restee')
await prisma.$disconnect()
console.log(`\n${etapes} etapes ok`)
