/**
 * ESSAI de la migration 20261109140000_coaching_seances.sql (Mon coaching,
 * 09/11/2026) et des requetes EXACTES de src/lib/coaching/base.ts, contre la
 * vraie base, dans UNE transaction TOUJOURS ANNULEE (rien ne reste) :
 *   1. la migration, jouee deux fois (rejouable) : RLS activee et forcee sur
 *      les quatre tables ; anon rien, authenticated lecture seule, service_role
 *      lecture et insertion des seules detections ;
 *   2. les gestes : un droit offert (Melanie), une seance saisie au cockpit, un
 *      pack de 8 h achete (ligne academie_acces de l'essai), le parcours Cal
 *      d'un rendez-vous (cree, paye, reporte, annule, paiement en retard), le
 *      rattachement par l'email de l'invite (majuscules et espaces), une
 *      detection Meet inseree par service_role puis confirmee et une autre
 *      ecartee, corriger et retirer un droit ;
 *   3. le calcul du reste sur ce que la base rend pour le compte ;
 *   4. LECTURES REJOUEES sous le role authenticated, avec un VRAI sub et un
 *      VRAI email (claims du jeton) : deux membres du site et le compte de
 *      Brice dans l'allowlist ; et sous anon. Un membre ne lit que SES lignes
 *      et aucune detection, n'ecrit rien ; l'equipe lit tout, n'ecrit rien en
 *      direct ; anon rien ;
 *   5. les contraintes (coach inconnu, statut inconnu, email en majuscules,
 *      detection traitee sans date) sont refusees.
 * Puis la transaction est annulee, et on verifie hors transaction que les
 * tables ne sont pas restees. Les comptes sont lus en base (lecture seule) ;
 * aucun email ni identifiant complet n'est affiche.
 *
 * Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
 *   node --env-file=.env.local scripts/essayer-migration-coaching.mjs
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import {
  accorderDroit, ajouterSeance, annulerSeanceCal, changerStatutSeance, confirmerDetection, corrigerDroit, droitsDesEmails,
  droitsDuCompte, ecarterDetection, listerDetections, poserSeanceCal, retirerDroit, seancesDesEmails, seancesDuCompte,
} from '../src/lib/coaching/base.ts'
import { lireEvenementCal, resumerCoaching } from '../src/lib/coaching/pur.ts'

const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261109140000_coaching_seances.sql'
const candidats = [
  process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${MIGRATION}`) : null,
  new URL(`../../../${MIGRATION}`, import.meta.url),
].filter(Boolean)
const fichier = candidats.find(u => existsSync(u))
if (!fichier) throw new Error(`migration introuvable : poser AOK_WORKSPACE (${MIGRATION})`)

/** Le decoupage de scripts/appliquer-migration.mjs : sur les points-virgules, blocs $...$ intacts. */
function decouper(sql) {
  const ordres = []
  let courant = ''
  let tag = null
  let i = 0
  while (i < sql.length) {
    if (!tag) {
      const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (dollar) { tag = dollar[0]; courant += tag; i += tag.length; continue }
      if (sql[i] === ';') { if (courant.trim()) ordres.push(courant.trim()); courant = ''; i += 1; continue }
    } else if (sql.startsWith(tag, i)) { courant += tag; i += tag.length; tag = null; continue }
    courant += sql[i]
    i += 1
  }
  if (courant.trim()) ordres.push(courant.trim())
  return ordres
}
const ordres = decouper(readFileSync(fichier, 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n'))

class Annulation extends Error {}
// DIRECT_URL quand elle existe : le pooler (DATABASE_URL, pgbouncer) peut bloquer le DDL (apps/cockpit/CLAUDE.md).
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const court = id => `${String(id).slice(0, 8)}...`
const motif = e => String(e?.message ?? e).split('\n').find(l => /permission|policy|violates|denied|row-level|check constraint|does not exist/i.test(l))?.trim().slice(0, 110) ?? 'refus'
const TABLES = ['coaching_packs', 'coaching_droits', 'coaching_seances', 'coaching_detections']

const existe = async c => (await c.$queryRawUnsafe(`select to_regclass('public.coaching_seances') is not null as la`))[0].la
if (await existe(prisma)) throw new Error('La table existe DEJA en base : cet essai est fait pour la migration pas encore appliquee.')

const evt = (declencheur, p) => ({
  triggerEvent: declencheur,
  payload: {
    type: 'essai-coaching', uid: p.uid, startTime: p.debut, endTime: new Date(Date.parse(p.debut) + 50 * 60_000).toISOString(),
    organizer: { email: 'organisateur.essai@aoknowledge.com' }, attendees: [{ email: p.email }], status: 'ACCEPTED', ...p.plus,
  },
})
const TYPES = new Set(['essai-coaching'])
const dans = j => new Date(Date.now() + j * 24 * 3600 * 1000).toISOString()

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
    for (const t of TABLES) {
      const [r] = await tx.$queryRawUnsafe(`select relrowsecurity as rls, relforcerowsecurity as force from pg_class where oid = $1::regclass`, `public.${t}`)
      assert.deepEqual(r, { rls: true, force: true }, t)
      const [d] = await tx.$queryRawUnsafe(`select
        has_table_privilege('anon', $1, 'select') as anon_lit,
        has_table_privilege('authenticated', $1, 'select') as auth_lit,
        has_table_privilege('authenticated', $1, 'insert') or has_table_privilege('authenticated', $1, 'update')
          or has_table_privilege('authenticated', $1, 'delete') as auth_ecrit,
        has_table_privilege('service_role', $1, 'insert') as service_insert,
        has_table_privilege('service_role', $1, 'update') or has_table_privilege('service_role', $1, 'delete') as service_modifie`, `public.${t}`)
      assert.deepEqual(d, { anon_lit: false, auth_lit: true, auth_ecrit: false, service_insert: t === 'coaching_detections', service_modifie: false }, t)
    }
    const [vue] = await tx.$queryRawUnsafe(`select has_table_privilege('anon', 'public.coaching_droits_tous', 'select') as anon,
      has_table_privilege('authenticated', 'public.coaching_droits_tous', 'select') as auth,
      has_function_privilege('anon', 'public.aok_coaching_a_moi(uuid, text)', 'execute') as fn_anon`)
    assert.deepEqual(vue, { anon: false, auth: true, fn_anon: false })
    const [pack] = await tx.$queryRawUnsafe(`select coach, seances, libelle from public.coaching_packs where offre_slug = 'coaching-8h'`)
    assert.deepEqual(pack, { coach: 'brice', seances: 8, libelle: 'Pack 8 h' })
    ok('migration jouee deux fois : RLS activee et forcee sur les 4 tables, anon rien, authenticated lecture seule, service_role insere les seules detections, pack 8 h pose')

    // Les comptes, lus en base (lecture seule).
    const membres = await tx.$queryRawUnsafe(`
      select u.id::text as id, lower(u.email) as email from auth.users u
        join public.profiles p on p.id = u.id
       where p.role::text = 'member' and u.email is not null and u.email_confirmed_at is not null
         and not exists (select 1 from public.cockpit_allowlist c where c.user_id = u.id)
         and (select count(*) from auth.users v where lower(v.email) = lower(u.email)) = 1
         and not exists (select 1 from public.profile_emails pe where lower(pe.email) = lower(u.email) and pe.profile_id <> u.id)
       order by u.created_at limit 2`)
    if (membres.length < 2) throw new Error('il faut deux comptes membres')
    const [A, B] = membres
    const [T] = await tx.$queryRawUnsafe(`
      select c.user_id::text as id, lower(u.email) as email from public.cockpit_allowlist c join auth.users u on u.id = c.user_id
       where c.label = 'Brice' limit 1`)
    assert.ok(T, 'compte de Brice dans l allowlist')
    const PAR = `cockpit:${T.id}`
    console.log(`comptes : A ${court(A.id)}, B ${court(B.id)}, equipe ${court(T.id)}`)

    // 2. Les gestes.
    const offert = await accorderDroit(tx, { action: 'accorder_droit', email: A.email, coach: 'melanie', seances: 3, source: 'offert', depuis: null, note: 'Essai' }, PAR)
    assert.equal(offert.user_id, A.id, 'le compte du site est rattache par l email')
    const saisie = await ajouterSeance(tx, { action: 'ajouter_seance', email: A.email, coach: 'melanie', debut: dans(-3), duree_min: 60, statut: 'faite', note: null }, PAR)
    assert.equal(saisie.statut, 'faite')
    assert.equal(saisie.source, 'cockpit')
    const [offreCoaching] = await tx.$queryRawUnsafe(`select id::text as id from public.academie_offres where slug = 'coaching-8h'`)
    assert.ok(offreCoaching, 'offre coaching-8h en base (migration 20261108235500)')
    const [acces] = await tx.$queryRawUnsafe(`
      insert into public.academie_acces (user_id, email, offre_id, source, pose_par, note)
      values ($1::uuid, null, $2::uuid, 'offert', 'essai:coaching', 'essai annule') returning id::text as id`, A.id, offreCoaching.id)
    ok('accorder un droit offert, saisir une seance faite (cockpit), acheter le pack (ligne academie_acces de l essai, compte sans email)')

    // Le parcours Cal d'un rendez-vous.
    const uid1 = `essai_${randomUUID().slice(0, 8)}`
    const uid2 = `essai_${randomUUID().slice(0, 8)}`
    const emailCal = `  ${A.email.toUpperCase()} `
    const cree = lireEvenementCal(evt('BOOKING_CREATED', { uid: uid1, debut: dans(5), email: emailCal }), TYPES)
    assert.equal(cree.geste, 'poser')
    const r1 = await poserSeanceCal(tx, cree)
    assert.deepEqual([r1.etat, r1.droit], ['cree', 'aucun'])
    const r1b = await poserSeanceCal(tx, cree)
    assert.equal(r1b.etat, 'mis_a_jour', 'le meme evenement deux fois : une seule seance')
    assert.equal(r1b.seance, r1.seance)
    const paye = lireEvenementCal(evt('BOOKING_PAID', { uid: uid1, debut: dans(5), email: emailCal, plus: { paymentId: 1 } }), TYPES)
    const r2 = await poserSeanceCal(tx, paye)
    assert.equal(r2.droit, 'cree_ou_lie')
    const r2b = await poserSeanceCal(tx, paye)
    assert.equal(r2b.droit, 'deja', 'un seul droit par heure payee')
    const [lien] = await tx.$queryRawUnsafe(`select s.droit_id::text as droit, d.source, d.seances, d.user_id::text as user_id
      from public.coaching_seances s join public.coaching_droits d on d.id = s.droit_id where s.id = $1::uuid`, r1.seance)
    assert.deepEqual(lien && { source: lien.source, seances: lien.seances, user_id: lien.user_id }, { source: 'cal', seances: 1, user_id: A.id })
    const reporte = lireEvenementCal(evt('BOOKING_RESCHEDULED', { uid: uid2, debut: dans(7), email: emailCal, plus: { rescheduleUid: uid1 } }), TYPES)
    const r3 = await poserSeanceCal(tx, reporte)
    assert.equal(r3.etat, 'reporte')
    assert.equal(r3.seance, r1.seance, 'le report deplace la meme seance')
    const [apres] = await tx.$queryRawUnsafe(`select reference, droit_id::text as droit, statut from public.coaching_seances where id = $1::uuid`, r1.seance)
    assert.deepEqual(apres, { reference: uid2, droit: lien.droit, statut: 'prevue' }, 'et garde son droit')
    const annule = lireEvenementCal(evt('BOOKING_CANCELLED', { uid: uid2, debut: dans(7), email: emailCal }), new Set())
    assert.deepEqual(await annulerSeanceCal(tx, annule.uid), { annulee: true, droit_retire: true })
    assert.deepEqual(await annulerSeanceCal(tx, annule.uid), { annulee: false, droit_retire: false }, 'deja annulee')
    const tard = await poserSeanceCal(tx, lireEvenementCal(evt('BOOKING_PAID', { uid: uid2, debut: dans(7), email: emailCal, plus: { paymentId: 1 } }), TYPES))
    assert.equal(tard.etat, 'fige', 'un paiement en retard ne ressuscite pas une seance annulee')
    const [fige] = await tx.$queryRawUnsafe(`select statut from public.coaching_seances where id = $1::uuid`, r1.seance)
    assert.equal(fige.statut, 'annulee')
    const uid3 = `essai_${randomUUID().slice(0, 8)}`
    await poserSeanceCal(tx, lireEvenementCal(evt('BOOKING_CREATED', { uid: uid3, debut: dans(9), email: A.email }), TYPES))
    const uidB = `essai_${randomUUID().slice(0, 8)}`
    const rB = await poserSeanceCal(tx, lireEvenementCal(evt('BOOKING_CREATED', { uid: uidB, debut: dans(2), email: B.email.toUpperCase() }), TYPES))
    const [sB] = await tx.$queryRawUnsafe(`select user_id::text as user_id, email from public.coaching_seances where id = $1::uuid`, rB.seance)
    assert.equal(sB.user_id, B.id)
    assert.equal(sB.email, B.email)
    ok('Cal : cree (une seule fois), paye (un droit, lie), reporte (meme seance, droit garde), annule (droit Cal retire), paiement en retard sans effet, invite rattache par son email en majuscules')

    // Les detections Meet : inserees par service_role, confirmees ou ecartees par l'equipe.
    const fichierA = `essai${randomUUID().replace(/-/g, '')}`
    const fichierB = `essai${randomUUID().replace(/-/g, '')}`
    const ins = await comme('service_role', null, `
      insert into public.coaching_detections (fichier_id, titre, debut, duree_min, transcription, notes_gemini, raison)
      values ($1, 'Coaching essai', now() - interval '2 days', 55, true, true, 'essai'),
             ($2, 'Autre essai', now() - interval '1 day', 40, false, false, 'essai')
      returning id::text as id`, fichierA, fichierB)
    assert.ok(ins.ok, ins.motif)
    // Le savepoint de comme() est annule : on insere pour de bon dans la transaction (role postgres, meme ordre).
    const dets = await tx.$queryRawUnsafe(`
      insert into public.coaching_detections (fichier_id, titre, debut, duree_min, transcription, notes_gemini, raison)
      values ($1, 'Coaching essai', now() - interval '2 days', 55, true, true, 'essai'),
             ($2, 'Autre essai', now() - interval '1 day', 40, false, false, 'essai')
      returning id::text as id, fichier_id`, fichierA, fichierB)
    const dA = dets.find(x => x.fichier_id === fichierA)
    const dB = dets.find(x => x.fichier_id === fichierB)
    const sService = await comme('service_role', null, `insert into public.coaching_seances (email, coach, debut, duree_min, source, pose_par) values ('x@exemple.fr', 'brice', now(), 60, 'meet', 'script') returning id`)
    assert.equal(sService.ok, false, 'le script Meet ne pose jamais une seance')
    const sMeet = await confirmerDetection(tx, { action: 'confirmer_detection', id: dA.id, email: B.email, coach: 'brice', duree_min: null }, PAR)
    assert.equal(sMeet.statut, 'faite')
    assert.equal(sMeet.source, 'meet')
    assert.equal(sMeet.duree_min, 55)
    assert.equal(sMeet.user_id, B.id)
    assert.equal(await confirmerDetection(tx, { action: 'confirmer_detection', id: dA.id, email: B.email, coach: 'brice', duree_min: null }, PAR), null, 'deja confirmee')
    assert.equal(await ecarterDetection(tx, dB.id, PAR), true)
    assert.equal(await ecarterDetection(tx, dB.id, PAR), false)
    const liste = await listerDetections(tx)
    assert.ok(liste.some(x => x.id === dA.id && x.statut === 'confirmee' && x.seance_id === sMeet.id))
    ok(`Meet : service_role insere (${ins.ok ? 'ok' : ins.motif}) mais ne pose aucune seance (${sService.motif}) ; confirmer cree la seance faite une seule fois, ecarter une seule fois`)

    // Corriger, retirer, changer un statut.
    assert.equal((await corrigerDroit(tx, offert.id, 4, 'corrige')).seances, 4)
    assert.equal(await corrigerDroit(tx, acces.id, 9, null), null, 'un pack ne se corrige pas ici')
    assert.equal((await changerStatutSeance(tx, saisie.id, 'faite', PAR)).statut_par, PAR)
    assert.equal(await changerStatutSeance(tx, randomUUID(), 'faite', PAR), null)
    ok('corriger un droit de la table (pas un pack), changer un statut, seance inconnue')

    // 3. Le calcul du reste sur ce que la base rend.
    const droitsA = await droitsDuCompte(tx, A.id)
    const seancesA = await seancesDuCompte(tx, A.id)
    assert.ok(droitsA.some(d => d.id === acces.id && d.source === 'pack' && d.derive === true), 'le pack se deduit de academie_acces')
    assert.ok(droitsA.some(d => d.id === offert.id))
    const resA = resumerCoaching(droitsA, seancesA)
    const ligne = cle => resA.lignes.find(l => l.cle === cle)
    assert.equal(ligne('brice:pack:coaching-8h').phrase, '7 séances restantes sur 8 avec Brice', 'uid3 prevue consomme le pack')
    assert.equal(ligne('melanie:seances').phrase, '3 séances restantes sur 4 avec Mélanie')
    assert.equal(resA.prochain.id, seancesA.find(s => s.reference === uid3).id)
    const fiche = await droitsDesEmails(tx, [A.email])
    assert.ok(fiche.some(d => d.id === acces.id), 'la fiche retrouve le pack achete connecte (email vide) par le compte')
    assert.ok((await seancesDesEmails(tx, [B.email])).some(s => s.id === sMeet.id))
    assert.equal(await retirerDroit(tx, offert.id, PAR), true)
    assert.equal(await retirerDroit(tx, offert.id, PAR), false)
    assert.equal(await retirerDroit(tx, acces.id, PAR), false, 'un pack se retire par l acces de l academie')
    const apresRetrait = resumerCoaching(await droitsDuCompte(tx, A.id), await seancesDuCompte(tx, A.id))
    const mel = apresRetrait.lignes.find(l => l.coach === 'melanie')
    assert.deepEqual([mel.total, mel.phrase], [null, '1 séance avec Mélanie'], 'droit retire : la seance de Melanie reste, sans total')
    assert.equal(apresRetrait.hors_droits.melanie, 1)
    ok('calcul du reste sur la base : pack 7 sur 8, Melanie 3 sur 4, prochain rendez-vous, fiche par email et par compte, retrait')

    // 4. Lectures rejouees sous authenticated (vrai sub, vrai email) et anon.
    const lireTout = `select 'd' as t, id::text as id, email, user_id::text as user_id from public.coaching_droits
      union all select 's', id::text, email, user_id::text from public.coaching_seances`
    const aMoi = (c, l) => l.user_id === c.id || l.email === c.email
    for (const [nom, X] of [['A', A], ['B', B]]) {
      const r = await comme('authenticated', X, lireTout)
      assert.ok(r.ok, r.motif)
      assert.ok(r.lignes.length > 0, `${nom} lit ses lignes`)
      assert.ok(r.lignes.every(l => aMoi(X, l)), `${nom} ne lit que SES lignes`)
      const det = await comme('authenticated', X, `select id from public.coaching_detections`)
      assert.ok(det.ok && det.lignes.length === 0, `${nom} ne lit aucune detection`)
      const vueX = await comme('authenticated', X, `select id::text as id, derive from public.coaching_droits_tous`)
      assert.ok(vueX.ok && vueX.lignes.every(l => l.derive === false), `${nom} : la vue ne montre pas les packs (academie_acces est a l equipe)`)
    }
    const rA = await comme('authenticated', A, lireTout)
    assert.ok(rA.lignes.some(l => l.id === offert.id) && rA.lignes.some(l => l.id === saisie.id))
    assert.ok(!rA.lignes.some(l => l.id === sMeet.id), 'A ne voit pas la seance Meet de B')
    ok('authenticated, membres A puis B (vrai sub et email) : chacun ne lit que SES droits et SES seances, aucune detection, pas les packs dans la vue')

    for (const [geste, sql] of [
      ['insert', `insert into public.coaching_seances (email, coach, debut, duree_min, source, pose_par) values ('${A.email}', 'brice', now(), 60, 'cockpit', 'moi') returning id`],
      ['update', `update public.coaching_droits set seances = 99 where email = '${A.email}' returning id`],
      ['delete', `delete from public.coaching_seances where email = '${A.email}' returning id`],
      ['detection', `insert into public.coaching_detections (fichier_id, titre, debut) values ('essaiessaiessai', 'x', now()) returning id`],
    ]) {
      const r = await comme('authenticated', A, sql)
      assert.equal(r.ok, false, `A : ${geste} aurait du etre refuse`)
    }
    ok('authenticated, membre A : insert, update, delete et detection refuses')

    const rT = await comme('authenticated', T, lireTout)
    assert.ok(rT.ok, rT.motif)
    for (const id of [offert.id, saisie.id, sMeet.id, r1.seance, rB.seance]) assert.ok(rT.lignes.some(l => l.id === id))
    const detT = await comme('authenticated', T, `select id::text as id from public.coaching_detections`)
    assert.ok(detT.ok && detT.lignes.some(l => l.id === dA.id))
    const vueT = await comme('authenticated', T, `select id::text as id from public.coaching_droits_tous where derive`)
    assert.ok(vueT.ok && vueT.lignes.some(l => l.id === acces.id), 'l equipe voit les packs dans la vue')
    const uT = await comme('authenticated', T, `update public.coaching_seances set statut = 'faite' where id = $1::uuid returning id`, r1.seance)
    assert.equal(uT.ok, false, 'l equipe ecrit par la route, jamais en direct')
    ok('authenticated, equipe (vrai sub et email de Brice) : lit tout (droits, seances, detections, packs), n ecrit rien en direct')

    for (const t of [...TABLES, 'coaching_droits_tous']) {
      const r = await comme('anon', null, `select count(*) from public.${t}`)
      assert.equal(r.ok, false, `anon lit ${t}`)
    }
    ok('anon : aucune lecture')

    // 5. Les contraintes.
    const INS = `insert into public.coaching_seances (email, coach, debut, duree_min, statut, source, pose_par) values ($1, $2, now(), $3, $4, 'cockpit', 'essai')`
    await doitEchouer('coach inconnu', INS, 'a@exemple.fr', 'adil', 60, 'faite')
    await doitEchouer('statut inconnu', INS, 'a@exemple.fr', 'brice', 60, 'reportee')
    await doitEchouer('email en majuscules', INS, 'A@exemple.fr', 'brice', 60, 'faite')
    await doitEchouer('duree de 3 minutes', INS, 'a@exemple.fr', 'brice', 3, 'faite')
    await doitEchouer('droit de 0 seance', `insert into public.coaching_droits (email, coach, seances, source, pose_par) values ('a@exemple.fr', 'brice', 0, 'offert', 'essai')`)
    await doitEchouer('droit pack pose a la main', `insert into public.coaching_droits (email, coach, seances, source, pose_par) values ('a@exemple.fr', 'brice', 8, 'pack', 'essai')`)
    await doitEchouer('detection traitee sans date', `insert into public.coaching_detections (fichier_id, titre, debut, statut) values ('essai0000000000', 'x', now(), 'ecartee')`)
    await doitEchouer('deux seances Cal pour un meme uid', `insert into public.coaching_seances (email, coach, debut, duree_min, source, reference, pose_par) values ('a@exemple.fr', 'brice', now(), 60, 'cal', $1, 'essai')`, uid3)

    throw new Annulation()
  }, { timeout: 90_000 })
} catch (err) {
  if (!(err instanceof Annulation)) throw err
}

assert.equal(await existe(prisma), false)
ok('transaction annulee : les tables ne sont pas restees')
await prisma.$disconnect()
console.log(`\n${etapes} etapes ok`)
