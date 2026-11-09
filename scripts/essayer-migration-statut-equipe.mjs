/**
 * ESSAI de la migration 20261109210000_statut_equipe.sql (le statut equipe,
 * 09/11/2026) contre la vraie base, dans UNE transaction TOUJOURS ANNULEE
 * (rien ne reste, lock_timeout 5 s). Ce qui est verifie :
 *   0. les fichiers sur le disque sont bien ce qui tourne en prod : la vue
 *      cockpit_membres_signaux de 20261103090000 et aok_espaces_reels de
 *      20261018234500, rejouees, gardent leur empreinte md5 ;
 *   1. AVANT : les lignes de cockpit_membres_signaux et de cockpit_actions,
 *      les fiches de l equipe par l ancienne CTE (fiches_equipe) ;
 *   2. la migration, jouee DEUX fois (la garde accepte l empreinte d apres) ;
 *   3. APRES : les quatre comptes de l equipe (n 1, 2, 21252, 21265) sont
 *      aok_est_equipe, les autres comptes de Brice et Tab ne le sont pas ;
 *      cockpit_equipe_fiches() contient l ancienne equipe ; signaux identique
 *      ligne a ligne ; cockpit_actions = avant moins l equipe, rien d autre ;
 *      le profil public d un compte de l equipe peut montrer le Live Club ;
 *      la regle du journal (SQL_IDENTITE + estEquipe + preparerDroits) rend
 *      Live Club 'oui' pour les quatre ;
 *   4. sous authenticated (vrai sub, vrai email) : un compte du cockpit lit
 *      l equipe et les vues, un membre ordinaire ne lit rien de l equipe ni
 *      aok_est_equipe ; anon rien.
 * Puis la transaction est annulee et on verifie hors transaction que les deux
 * fonctions ne sont pas restees. Aucun email ni identifiant complet affiche.
 *
 * Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
 *   node --env-file=.env.local scripts/essayer-migration-statut-equipe.mjs
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { estEquipe, preparerDroits } from '../src/lib/academie/pur.ts'
import { SQL_IDENTITE } from '../src/lib/academie/requetes.ts'

const DOSSIER = 'sites/Aoknowledgecom/supabase/migrations'
function fichier(nom) {
  const candidats = [
    process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${DOSSIER}/${nom}`) : null,
    new URL(`../../../${DOSSIER}/${nom}`, import.meta.url),
  ].filter(Boolean)
  const u = candidats.find(x => existsSync(x))
  if (!u) throw new Error(`migration introuvable : poser AOK_WORKSPACE (${nom})`)
  return readFileSync(u, 'utf8')
}

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
const sansCommentaires = s => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
const ordres = decouper(sansCommentaires(fichier('20261109210000_statut_equipe.sql')))
const vueDu0311 = decouper(sansCommentaires(fichier('20261103090000_cockpit_membres_equipe_hors_contact.sql')))
  .find(o => /^create or replace view public\.cockpit_membres_signaux/i.test(o))
const reelsDu1810 = decouper(sansCommentaires(fichier('20261018234500_mon_espace_lot1.sql')))
  .find(o => /^create or replace function public\.aok_espaces_reels/i.test(o))
assert.ok(vueDu0311 && reelsDu1810, 'ordres de reference introuvables')

class Annulation extends Error {}
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const court = id => `${String(id).slice(0, 8)}...`
const motif = e => String(e?.message ?? e).split('\n').find(l => /permission|policy|violates|denied|row-level|does not exist|exception|change depuis/i.test(l))?.trim().slice(0, 140) ?? 'refus'
const json = v => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? Number(x) : x instanceof Date ? x.toISOString() : x))

const existe = async (c, sig) => (await c.$queryRawUnsafe(`select to_regprocedure($1) is not null as la`, sig))[0].la
if (await existe(prisma, 'public.aok_est_equipe(uuid)') || await existe(prisma, 'public.cockpit_equipe_fiches()')) {
  throw new Error('Les fonctions existent DEJA : cet essai est fait pour la migration pas encore appliquee.')
}

const EMPREINTES = `select md5(pg_get_viewdef('public.cockpit_actions'::regclass, true)) as actions,
  md5(pg_get_viewdef('public.cockpit_membres_signaux'::regclass, true)) as signaux,
  md5(pg_get_functiondef('public.aok_espaces_reels(uuid, text[])'::regprocedure)) as reels`

// L'ancienne definition de l'equipe (CTE fiches_equipe de 20261103090000), pour comparer.
const ANCIENNE_EQUIPE = `
with comptes_equipe as (
  select x.telegram_id, x.membre_id, lower(x.email) as email from public.cockpit_liveclub_exemptions x
  where x.retire_le is null and x.motif in ('fondateur', 'admin', 'equipe')
  union
  select c.telegram_id, null::uuid, null::text from public.cockpit_telegram_comptes c
), fiches_equipe as (
  select ce.membre_id from comptes_equipe ce where ce.membre_id is not null
  union select e.membre_id from comptes_equipe ce join public.cockpit_membre_emails e on lower(e.email) = ce.email
  union select r.membre_id from comptes_equipe ce join public.cockpit_liveclub_rattachements r on r.telegram_id = ce.telegram_id where r.membre_id is not null
  union select e.membre_id from public.cockpit_telegram_comptes c
    join public.profile_emails pe on pe.profile_id = c.user_id
    join public.cockpit_membre_emails e on lower(e.email) = lower(pe.email)
)
select membre_id::text as m from fiches_equipe where membre_id is not null order by 1`

const LIRE_SIGNAUX = `select * from public.cockpit_membres_signaux order by membre_id`
const LIRE_ACTIONS = `select * from public.cockpit_actions order by membre_id`

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '60s'`)
    let n = 0
    async function comme(role, compte, sql, ...params) {
      const sp = `sp${++n}`
      await tx.$executeRawUnsafe(`savepoint ${sp}`)
      try {
        const claims = JSON.stringify(compte ? { sub: compte.id, role, email: compte.email, aud: 'authenticated' } : { role })
        await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, claims)
        await tx.$executeRawUnsafe(`select set_config('request.jwt.claim.sub', $1, true)`, compte ? compte.id : '')
        await tx.$executeRawUnsafe(`set local role ${role}`)
        const lignes = await tx.$queryRawUnsafe(sql, ...params)
        return { ok: true, lignes }
      } catch (e) {
        return { ok: false, motif: motif(e) }
      } finally {
        await tx.$executeRawUnsafe(`rollback to savepoint ${sp}`)
      }
    }

    // 0. Le disque = la prod.
    const avant = (await tx.$queryRawUnsafe(EMPREINTES))[0]
    await tx.$executeRawUnsafe(vueDu0311)
    await tx.$executeRawUnsafe(reelsDu1810)
    const rejoue = (await tx.$queryRawUnsafe(EMPREINTES))[0]
    assert.equal(rejoue.signaux, avant.signaux, 'la vue signaux de 20261103090000 n est pas celle de la prod')
    assert.equal(rejoue.reels, avant.reels, 'aok_espaces_reels de 20261018234500 n est pas celle de la prod')
    ok(`le disque = la prod : signaux ${avant.signaux.slice(0, 8)}, actions ${avant.actions.slice(0, 8)}, espaces_reels ${avant.reels.slice(0, 8)}`)

    // 1. Avant.
    const signauxAvant = await tx.$queryRawUnsafe(LIRE_SIGNAUX)
    const actionsAvant = await tx.$queryRawUnsafe(LIRE_ACTIONS)
    const equipeAvant = (await tx.$queryRawUnsafe(ANCIENNE_EQUIPE)).map(l => l.m)
    const equipeDansActions = actionsAvant.filter(a => equipeAvant.includes(a.membre_id))
    ok(`avant : ${signauxAvant.length} ligne(s) a contacter, ${actionsAvant.length} ligne(s) d actions dont ${equipeDansActions.length} de l equipe `
      + `(${equipeDansActions.map(a => `${court(a.membre_id)} ${a.motif ?? 'sans motif'}`).join(', ')}), ${equipeAvant.length} fiche(s) d equipe`)

    // 2. La migration, deux fois.
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const apres = (await tx.$queryRawUnsafe(EMPREINTES))[0]
    console.log(`    empreintes apres : actions ${apres.actions}, signaux ${apres.signaux}`)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    ok(`migration jouee deux fois (${ordres.length} ordres), la garde accepte l empreinte d apres`)

    // 3. Apres.
    const comptes = await tx.$queryRawUnsafe(`
      select p.id::text as id, p.client_number::int as numero, lower(u.email) as email, public.aok_est_equipe(p.id) as equipe
        from public.profiles p join auth.users u on u.id = p.id
       where p.client_number in (1, 2, 21252, 21265, 21242, 21263) order by p.client_number`)
    const equipe = comptes.filter(c => [1, 2, 21252, 21265].includes(c.numero))
    assert.equal(equipe.length, 4, 'les quatre comptes de l equipe')
    assert.ok(equipe.every(c => c.equipe === true), 'les quatre sont aok_est_equipe')
    assert.ok(comptes.filter(c => [21242, 21263].includes(c.numero)).every(c => c.equipe === false), 'les autres comptes de Brice (gmail, Tab) ne le sont pas')
    const [{ total }] = await tx.$queryRawUnsafe(`select count(*)::int as total from public.profiles p where public.aok_est_equipe(p.id)`)
    assert.equal(total, 4, 'personne d autre')
    ok(`aok_est_equipe : n 1, 2, 21252, 21265 oui ; n 21242 (gmail de Brice) et 21263 (Tab) non ; ${total} compte(s) en tout`)

    const fiches = (await tx.$queryRawUnsafe(`select membre_id::text as m from public.cockpit_equipe_fiches() order by 1`)).map(l => l.m)
    for (const f of equipeAvant) assert.ok(fiches.includes(f), `fiche ${court(f)} de l ancienne equipe`)
    ok(`cockpit_equipe_fiches() (postgres) : ${fiches.length} fiche(s), l ancienne equipe comprise (${equipeAvant.length}), ${fiches.length - equipeAvant.length} de plus`)

    const signauxApres = await tx.$queryRawUnsafe(LIRE_SIGNAUX)
    assert.equal(json(signauxApres), json(signauxAvant.filter(s => !fiches.includes(s.membre_id))), 'signaux : memes lignes, memes valeurs')
    assert.equal(json(signauxApres), json(signauxAvant), 'signaux : rien ne change aujourd hui')
    const colonnesSignaux = await tx.$queryRawUnsafe(`select string_agg(attname, ',' order by attnum) as c from pg_attribute where attrelid = 'public.cockpit_membres_signaux'::regclass and attnum > 0 and not attisdropped`)
    ok(`cockpit_membres_signaux : ${signauxApres.length} ligne(s), identiques une a une, ${colonnesSignaux[0].c.split(',').length} colonnes`)

    const actionsApres = await tx.$queryRawUnsafe(LIRE_ACTIONS)
    assert.equal(json(actionsApres), json(actionsAvant.filter(a => !fiches.includes(a.membre_id))), 'actions : avant moins l equipe')
    assert.ok(!actionsApres.some(a => fiches.includes(a.membre_id)), 'aucune ligne de l equipe')
    ok(`cockpit_actions : ${actionsAvant.length} -> ${actionsApres.length} ligne(s), seules celles de l equipe sortent (${actionsAvant.length - actionsApres.length})`)

    const reels = await tx.$queryRawUnsafe(`select public.aok_espaces_reels($1::uuid, array['live_club', 'club_10']) as e`, equipe[3].id)
    assert.ok(reels[0].e.includes('live_club'), 'Adrien peut montrer le Live Club')
    const membre = (await tx.$queryRawUnsafe(`
      select u.id::text as id, lower(u.email) as email from auth.users u join public.profiles p on p.id = u.id
       where p.role::text = 'member' and u.email_confirmed_at is not null
         and not exists (select 1 from public.cockpit_allowlist c where c.user_id = u.id)
         and coalesce(public.aok_compte_de(u.id) -> 'live_club' ->> 'statut', '') not in ('active', 'trialing', 'past_due')
       order by p.client_number limit 1`))[0]
    const reelsMembre = await tx.$queryRawUnsafe(`select public.aok_espaces_reels($1::uuid, array['live_club']) as e`, membre.id)
    assert.deepEqual(reelsMembre[0].e, [], 'un membre sans abonnement ne montre pas le Live Club')
    ok('aok_espaces_reels : un compte de l equipe montre le Live Club sans abonnement, un membre sans abonnement non')

    // La regle du journal, sur ce que la base rend (SQL_IDENTITE, la requete de droitsAcademie).
    for (const c of equipe) {
      const id = (await tx.$queryRawUnsafe(SQL_IDENTITE, c.id))[0]
      const d = preparerDroits({ admin: id.role === 'admin', equipe: estEquipe(id.role), etm: false, secoursEssai: false, liveClub: 'non_lu', lignes: [] })
      assert.equal(d.liveClub, 'oui', `n ${c.numero}`)
      assert.equal(d.equipe, true)
    }
    const idMembre = (await tx.$queryRawUnsafe(SQL_IDENTITE, membre.id))[0]
    assert.equal(estEquipe(idMembre.role), false)
    ok('journal : SQL_IDENTITE + estEquipe + preparerDroits rendent Live Club oui et equipe pour les quatre, pas pour un membre')

    // 4. Sous les roles de PostgREST.
    const cockpit = comptes.find(c => c.numero === 1)
    const vuCockpit = await comme('authenticated', cockpit, `select count(*)::int as n from public.cockpit_equipe_fiches()`)
    assert.ok(vuCockpit.ok && vuCockpit.lignes[0].n === fiches.length, `le cockpit lit l equipe (${json(vuCockpit)})`)
    const actionsCockpit = await comme('authenticated', cockpit, `select count(*)::int as n from public.cockpit_actions`)
    assert.ok(actionsCockpit.ok && actionsCockpit.lignes[0].n === actionsApres.length, `le cockpit lit A traiter (${json(actionsCockpit)})`)
    const signauxCockpit = await comme('authenticated', cockpit, `select count(*)::int as n from public.cockpit_membres_signaux`)
    assert.ok(signauxCockpit.ok && signauxCockpit.lignes[0].n === signauxApres.length, `le cockpit lit a contacter (${json(signauxCockpit)})`)
    const risque = await comme('authenticated', cockpit, `select (select count(*) from public.cockpit_membres_risque)::int as r, (select count(*) from public.cockpit_membres_a_venir)::int as v`)
    assert.ok(risque.ok, `risque et a venir lisibles (${json(risque)})`)
    ok(`authenticated, compte du cockpit (n 1) : equipe ${vuCockpit.lignes[0].n}, A traiter ${actionsCockpit.lignes[0].n}, a contacter ${signauxCockpit.lignes[0].n}, risque ${risque.lignes[0].r}, a venir ${risque.lignes[0].v}`)

    const vuMembre = await comme('authenticated', membre, `select count(*)::int as n from public.cockpit_equipe_fiches()`)
    assert.ok(vuMembre.ok && vuMembre.lignes[0].n === 0, `un membre ne lit pas l equipe (${json(vuMembre)})`)
    const regleMembre = await comme('authenticated', membre, `select public.aok_est_equipe($1::uuid) as e`, cockpit.id)
    assert.equal(regleMembre.ok, false, 'un membre n appelle pas aok_est_equipe')
    const actionsMembre = await comme('authenticated', membre, `select count(*)::int as n from public.cockpit_actions`)
    assert.ok(!actionsMembre.ok || actionsMembre.lignes[0].n === 0, 'un membre ne lit pas A traiter')
    const anonFiches = await comme('anon', null, `select count(*)::int as n from public.cockpit_equipe_fiches()`)
    assert.equal(anonFiches.ok, false, 'anon n appelle pas cockpit_equipe_fiches')
    const anonRegle = await comme('anon', null, `select public.aok_est_equipe($1::uuid) as e`, cockpit.id)
    assert.equal(anonRegle.ok, false)
    ok(`authenticated, membre ordinaire : equipe vide, aok_est_equipe refusee (${regleMembre.motif}), A traiter ${actionsMembre.ok ? actionsMembre.lignes[0].n : 'refuse'} ; anon refuse (${anonFiches.motif})`)

    throw new Annulation()
  }, { timeout: 120_000 })
} catch (err) {
  if (!(err instanceof Annulation)) throw err
}

assert.equal(await existe(prisma, 'public.aok_est_equipe(uuid)'), false)
assert.equal(await existe(prisma, 'public.cockpit_equipe_fiches()'), false)
const fin = (await prisma.$queryRawUnsafe(EMPREINTES))[0]
ok(`transaction annulee : aucune fonction restee, vues inchangees (actions ${fin.actions.slice(0, 8)}, signaux ${fin.signaux.slice(0, 8)})`)
await prisma.$disconnect()
console.log(`\n${etapes} etapes ok`)
