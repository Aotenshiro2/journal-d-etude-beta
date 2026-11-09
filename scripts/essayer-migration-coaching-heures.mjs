/**
 * ESSAI de la migration 20261109200000_coaching_heures.sql (Mon coaching en
 * heures, 09/11/2026) et des requetes EXACTES de src/lib/coaching/base.ts,
 * contre la vraie base, dans UNE transaction TOUJOURS ANNULEE (rien ne reste).
 * La migration des seances (20261109140000) est deja appliquee : celle-ci
 * vient par-dessus.
 *   1. AVANT la migration, l'ancien journal (en ligne) ecrit comme il le fait
 *      aujourd'hui : un ETM de 3 seances, une heure payee sur Cal (1 seance) ;
 *   2. la migration, jouee deux fois (rejouable) : ces lignes sont reprises en
 *      minutes (seances x 60), le pack 8 h vaut 480 min, la vue garde ses
 *      colonnes dans le meme ordre et gagne minutes a la fin, ses droits ne
 *      changent pas ;
 *   3. APRES la migration, l'ancien journal ecrit encore seances seul : ca
 *      passe, la vue le lit en minutes ;
 *   4. le nouveau journal : un ETM de 12 h, corrige a 6,5 h, une heure payee
 *      sur Cal de 50 min (son droit = 50 min), une seance de 30 min, un pack
 *      8 h achete, une seance annulee au dernier moment (ne compte pas) ;
 *   5. le calcul du reste sur ce que la base rend : les phrases en heures ;
 *   6. les lectures rejouees sous authenticated (vrai sub, vrai email) et anon :
 *      rien ne change cote droits ;
 *   7. les contraintes (ni minutes ni seances, 3 min, 7 000 min) refusees.
 * Puis la transaction est annulee, et on verifie hors transaction que la
 * colonne minutes n'est pas restee. Aucun email ni identifiant complet affiche.
 *
 * Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
 *   node --env-file=.env.local scripts/essayer-migration-coaching-heures.mjs
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import {
  accorderDroit, ajouterSeance, changerStatutSeance, corrigerDroit, droitsDuCompte, poserSeanceCal, retirerDroit, seancesDuCompte,
} from '../src/lib/coaching/base.ts'
import { lireEvenementCal, resumerCoaching } from '../src/lib/coaching/pur.ts'

const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261109200000_coaching_heures.sql'
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
// DIRECT_URL quand elle existe : le pooler (DATABASE_URL, pgbouncer) peut bloquer le DDL.
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const court = id => `${String(id).slice(0, 8)}...`
const motif = e => String(e?.message ?? e).split('\n').find(l => /permission|policy|violates|denied|row-level|check constraint|does not exist|null value/i.test(l))?.trim().slice(0, 110) ?? 'refus'

const colonneMinutes = async c => (await c.$queryRawUnsafe(`
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coaching_droits' and column_name = 'minutes') as la`))[0].la
if (!(await prisma.$queryRawUnsafe(`select to_regclass('public.coaching_seances') is not null as la`))[0].la) {
  throw new Error('La migration 20261109140000 (les tables) n est pas en base : cet essai vient par-dessus.')
}
if (await colonneMinutes(prisma)) throw new Error('La colonne minutes existe DEJA : cet essai est fait pour la migration pas encore appliquee.')

const COLONNES_VUE = `select string_agg(attname, ',' order by attnum) as cols from pg_attribute
  where attrelid = 'public.coaching_droits_tous'::regclass and attnum > 0 and not attisdropped`

// Les ordres de l'ANCIEN journal (origin/master 828483b), recopies tels quels : accorder un droit et l'heure payee sur Cal.
const ANCIEN_ACCORDER = `
  insert into public.coaching_droits (email, user_id, coach, seances, source, depuis, note, pose_par)
  values ($1::text, $2::uuid, $3::text, $4::int, $5::text, coalesce($6::timestamptz, now()), $7::text, $8::text)
  returning id::text as id`
const ANCIEN_DROIT_CAL = `
  insert into public.coaching_droits (email, user_id, coach, seances, source, reference, pose_par, note)
  values ($1::text, $2::uuid, $3::text, 1, 'cal', $4::text, 'cal', 'Heure payée sur Cal')
  returning id::text as id`

const evt = (declencheur, p) => ({
  triggerEvent: declencheur,
  payload: {
    type: 'essai-coaching', uid: p.uid, startTime: p.debut, endTime: new Date(Date.parse(p.debut) + p.duree * 60_000).toISOString(),
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

    const [avant] = await tx.$queryRawUnsafe(COLONNES_VUE)
    const [reelles] = await tx.$queryRawUnsafe(`select (select count(*) from public.coaching_droits)::int as droits, (select count(*) from public.coaching_seances)::int as seances`)
    console.log(`en base avant l essai : ${reelles.droits} droit(s), ${reelles.seances} seance(s)`)

    // 1. L'ancien journal ecrit, avant la migration.
    // Des dates de depart distinctes : dans une transaction, now() est le meme pour tous les ordres.
    const [etmAncien] = await tx.$queryRawUnsafe(ANCIEN_ACCORDER, A.email, A.id, 'melanie', 3, 'etm', dans(-60), 'Essai ancien', PAR)
    const [calAncien] = await tx.$queryRawUnsafe(ANCIEN_DROIT_CAL, B.email, B.id, 'brice', `essai_${randomUUID().slice(0, 8)}`)
    ok('avant la migration : l ancien journal pose un ETM de 3 seances et une heure payee sur Cal (1 seance)')

    // 2. La migration, deux fois.
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const repris = await tx.$queryRawUnsafe(`select id::text as id, seances, minutes from public.coaching_droits where id = any($1::uuid[])`, [etmAncien.id, calAncien.id])
    assert.deepEqual(Object.fromEntries(repris.map(r => [r.id, r.minutes])), { [etmAncien.id]: 180, [calAncien.id]: 60 }, 'reprise : seances x 60')
    const [toutes] = await tx.$queryRawUnsafe(`select count(*)::int as n from public.coaching_droits where minutes is null`)
    assert.equal(toutes.n, 0, 'plus aucune ligne sans minutes apres la reprise')
    const [pack] = await tx.$queryRawUnsafe(`select seances, duree_min, minutes from public.coaching_packs where offre_slug = 'coaching-8h'`)
    assert.deepEqual(pack, { seances: 8, duree_min: 60, minutes: 480 }, 'le pack 8 h donne 8 h')
    const [col] = await tx.$queryRawUnsafe(`select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'coaching_droits' and column_name = 'seances'`)
    assert.equal(col.is_nullable, 'YES')
    const [apres] = await tx.$queryRawUnsafe(COLONNES_VUE)
    assert.equal(apres.cols, `${avant.cols},minutes`, 'la vue garde ses colonnes dans le meme ordre et gagne minutes a la fin')
    const [opt] = await tx.$queryRawUnsafe(`select reloptions::text as o from pg_class where oid = 'public.coaching_droits_tous'::regclass`)
    assert.match(opt.o ?? '', /security_invoker=true/)
    const [droitsVue] = await tx.$queryRawUnsafe(`select
      has_table_privilege('anon', 'public.coaching_droits_tous', 'select') as anon,
      has_table_privilege('authenticated', 'public.coaching_droits_tous', 'select') as auth,
      has_table_privilege('authenticated', 'public.coaching_droits_tous', 'insert') as auth_ecrit,
      has_table_privilege('service_role', 'public.coaching_droits_tous', 'select') as service,
      has_table_privilege('authenticated', 'public.coaching_droits', 'update') as auth_maj`)
    assert.deepEqual(droitsVue, { anon: false, auth: true, auth_ecrit: false, service: true, auth_maj: false })
    ok(`migration jouee deux fois : reprise (ETM 3 seances = 180 min, Cal 1 seance = 60 min), pack 480 min, seances facultative, vue ${apres.cols.split(',').length} colonnes (minutes a la fin, security_invoker), droits inchanges`)

    // 3. L'ancien journal ecrit encore, apres la migration (fenetre avant le deploiement du nouveau).
    const [apresAncien] = await tx.$queryRawUnsafe(ANCIEN_ACCORDER, A.email, A.id, 'brice', 2, 'offert', dans(-50), 'Essai ancien apres', PAR)
    const [vueAncien] = await tx.$queryRawUnsafe(`select seances, minutes from public.coaching_droits_tous where id = $1::uuid`, apresAncien.id)
    assert.deepEqual(vueAncien, { seances: 2, minutes: 120 }, 'minutes vide en table, seances x 60 dans la vue')
    ok('apres la migration, l ancien journal ecrit seances seul : accepte, la vue le lit 120 min')

    // 4. Le nouveau journal.
    const etm = await accorderDroit(tx, { action: 'accorder_droit', email: A.email, coach: 'brice', minutes: 720, source: 'etm', depuis: dans(-40), note: 'Essai ETM 12 h' }, PAR)
    assert.deepEqual([etm.minutes, etm.seances, etm.user_id], [720, null, A.id], 'ETM 12 h, seances vide, compte rattache')
    const corrige = await corrigerDroit(tx, etm.id, 390, '2 x 30 min par semaine, revu')
    assert.deepEqual([corrige.minutes, corrige.seances], [390, null])
    const ancienCorrige = await corrigerDroit(tx, apresAncien.id, 90, null)
    assert.deepEqual([ancienCorrige.minutes, ancienCorrige.seances], [90, null], 'corriger une ligne de l ancien journal la passe en minutes')
    const [offreCoaching] = await tx.$queryRawUnsafe(`select id::text as id from public.academie_offres where slug = 'coaching-8h'`)
    assert.ok(offreCoaching, 'offre coaching-8h en base')
    const [acces] = await tx.$queryRawUnsafe(`
      insert into public.academie_acces (user_id, email, offre_id, source, pose_par, note, debut)
      values ($1::uuid, null, $2::uuid, 'offert', 'essai:coaching', 'essai annule', $3::timestamptz) returning id::text as id`, A.id, offreCoaching.id, dans(-30))
    const uid = `essai_${randomUUID().slice(0, 8)}`
    const cal = await poserSeanceCal(tx, lireEvenementCal(evt('BOOKING_PAID', { uid, debut: dans(3), duree: 50, email: A.email, plus: { paymentId: 1 } }), TYPES))
    assert.equal(cal.droit, 'cree_ou_lie')
    const [droitCal] = await tx.$queryRawUnsafe(`select d.minutes, d.seances from public.coaching_droits d join public.coaching_seances s on s.droit_id = d.id where s.id = $1::uuid`, cal.seance)
    assert.deepEqual(droitCal, { minutes: 50, seances: null }, 'l heure payee porte la duree du rendez-vous')
    const demi = await ajouterSeance(tx, { action: 'ajouter_seance', email: A.email, coach: 'brice', debut: dans(-2), duree_min: 30, statut: 'faite', note: null }, PAR)
    const derniere = await ajouterSeance(tx, { action: 'ajouter_seance', email: A.email, coach: 'brice', debut: dans(0.01), duree_min: 60, statut: 'prevue', note: null }, PAR)
    assert.equal((await changerStatutSeance(tx, derniere.id, 'annulee', PAR)).statut, 'annulee')
    ok('nouveau journal : ETM 12 h corrige a 6,5 h, ligne ancienne corrigee en minutes, pack 8 h achete, heure Cal de 50 min (droit 50 min), seance de 30 min, une annulee au dernier moment')

    // 5. Le calcul du reste sur ce que la base rend.
    const droitsA = await droitsDuCompte(tx, A.id)
    const seancesA = await seancesDuCompte(tx, A.id)
    assert.ok(droitsA.every(d => Number.isInteger(d.minutes) && d.minutes > 0), 'chaque droit rendu porte ses minutes')
    assert.equal(droitsA.find(d => d.id === acces.id)?.minutes, 480)
    const r = resumerCoaching(droitsA, seancesA)
    const phrase = cle => r.lignes.find(l => l.cle === cle)?.phrase
    // Brice : l'heure Cal (50 min) prend son droit ; la seance de 30 min prend le droit le plus ancien qui a du temps
    // (l'ancien offert, corrige a 1,5 h) ; l'annulee ne prend rien.
    assert.equal(phrase('brice:seances'), '1 h restante sur 2 h 20 avec Brice', 'offert 1,5 h + Cal 50 min, 30 + 50 min pris')
    assert.equal(phrase('brice:etm'), '6,5 h restantes sur 6,5 h avec Brice')
    assert.equal(phrase('brice:pack:coaching-8h'), '8 h restantes sur 8 h avec Brice', 'l annulee au dernier moment ne compte pas')
    assert.equal(phrase('melanie:etm'), '3 h restantes sur 3 h avec Mélanie', 'la ligne reprise de l ancien journal')
    assert.equal(r.historique.find(x => x.id === derniere.id).statut_affiche, 'annulee')
    assert.deepEqual(r.hors_droits_min, { brice: 0, melanie: 0 })
    assert.equal(await retirerDroit(tx, etm.id, PAR), true)
    ok(`calcul sur la base : ${r.lignes.map(l => l.phrase).join(' | ')}`)

    // 6. Les lectures rejouees.
    const lireVue = `select id::text as id, email, user_id::text as user_id, minutes, derive from public.coaching_droits_tous`
    const vueA = await comme('authenticated', A, lireVue)
    assert.ok(vueA.ok, vueA.motif)
    assert.ok(vueA.lignes.length > 0 && vueA.lignes.every(l => l.user_id === A.id || l.email === A.email), 'A ne lit que SES droits')
    assert.ok(vueA.lignes.every(l => Number.isInteger(l.minutes)), 'avec leurs minutes')
    const vueB = await comme('authenticated', B, lireVue)
    assert.ok(vueB.ok && vueB.lignes.some(l => l.id === calAncien.id) && !vueB.lignes.some(l => l.id === etm.id), 'B lit son heure Cal, pas l ETM de A')
    const vueT = await comme('authenticated', T, `${lireVue} where derive`)
    assert.ok(vueT.ok && vueT.lignes.some(l => l.id === acces.id && l.minutes === 480), 'l equipe voit le pack, 480 min')
    const ecrit = await comme('authenticated', A, `update public.coaching_droits set minutes = 6000 where email = $1 returning id`, A.email)
    assert.equal(ecrit.ok, false, 'A n ecrit rien')
    const anon = await comme('anon', null, `select count(*) from public.coaching_droits_tous`)
    assert.equal(anon.ok, false)
    ok('authenticated (A, B, equipe) : chacun lit ses droits avec leurs minutes, l equipe tout, personne n ecrit ; anon rien')

    // 7. Les contraintes.
    const INS = `insert into public.coaching_droits (email, coach, seances, minutes, source, pose_par) values ('essai@exemple.fr', 'brice', $1::int, $2::int, 'offert', 'essai')`
    await doitEchouer('droit sans minutes ni seances', INS, null, null)
    await doitEchouer('droit de 3 minutes', INS, null, 3)
    await doitEchouer('droit de 7 000 minutes', INS, null, 7000)
    await doitEchouer('pack sans minutes', `update public.coaching_packs set minutes = null where offre_slug = 'coaching-8h'`)

    throw new Annulation()
  }, { timeout: 90_000 })
} catch (err) {
  if (!(err instanceof Annulation)) throw err
}

assert.equal(await colonneMinutes(prisma), false)
const [reste] = await prisma.$queryRawUnsafe(`select (select count(*) from public.coaching_droits)::int as droits`)
ok(`transaction annulee : la colonne minutes n est pas restee, ${reste.droits} droit(s) en base`)
await prisma.$disconnect()
console.log(`\n${etapes} etapes ok`)
