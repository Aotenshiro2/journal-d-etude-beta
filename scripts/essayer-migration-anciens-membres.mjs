/**
 * ESSAI de la migration 20261109234500_anciens_membres_numeros.sql (anciens
 * membres et numeros de membre, 09/11/2026) contre la vraie base, dans UNE
 * transaction TOUJOURS ANNULEE (rien ne reste, lock_timeout 5 s). Ce qui est
 * verifie :
 *   0. la garde du fichier refuse un profil public et un numero de 3 a 300
 *      deja porte ;
 *   1. la migration passe, l equipe porte 1, 2, 3, 4 (Brice, Melanie, Adil,
 *      Adrien), les autres comptes 301 et suivants dans l ordre d inscription,
 *      la sequence est a 300 + leur nombre ;
 *   2. avec des reservations FACTICES (numeros 21 a 24, personnes, fiches et
 *      adresses d essai, en .invalid) :
 *      - une inscription Google dont l adresse est celle d une fiche liee
 *        « certain » a la personne : activee tout de suite (email) ;
 *      - une inscription au meme nom seulement : numero suivant de la
 *        sequence, une proposition, pas d activation ;
 *      - une inscription sans rien : numero suivant, aucune proposition ;
 *      - un rattachement Telegram du Live Club qui arrive apres l inscription :
 *        activee (telegram) ;
 *      - une inscription par email pas encore confirme : rien, puis activee a
 *        la confirmation ;
 *      - une panne de l activation ne bloque pas l inscription ;
 *      - aucun compte existant ne correspond aux reservations factices ;
 *   3. RLS : anon ne lit rien, un membre ordinaire ne lit ni la table ni les
 *      propositions et ne peut rien confirmer, un compte du cockpit lit tout
 *      et confirme la proposition (« c est bien lui ») ; le badge public suit
 *      la visibilite du profil ;
 *   4. la renumerotation refuse un profil public et un numero de destination
 *      deja pris ;
 *   5. les controles de verifier:rls (audit-rls.mjs) rejoues DANS la
 *      transaction : aucune alerte nouvelle apres la migration.
 * Puis la transaction est annulee, et on verifie hors transaction que rien
 * n est reste : tables et fonctions absentes, numeros et sequence intacts.
 * Aucun email ni identifiant complet affiche.
 *
 * Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
 *   node --env-file=.env.local scripts/essayer-migration-anciens-membres.mjs
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

// OBSOLETE depuis le 10/11/2026 : le lot 1 (20261109234500) ne renumerote plus
// et ne recree plus la sequence member_number_seq dans la migration. Cet essai
// attend l'ancienne version (301 et +) et inscrit des comptes d'essai : sur la
// vraie sequence, non transactionnelle, il brulerait des numeros pour de bon.
// L'essai a jour : scripts/essayer-migration-statuts-anciens.mjs.
if (!process.env.ESSAI_ANCIEN_FORCE) {
  console.error('Essai obsolete depuis le 10/11/2026 : utiliser scripts/essayer-migration-statuts-anciens.mjs.')
  process.exit(1)
}

const NOM_MIGRATION = '20261109234500_anciens_membres_numeros.sql'
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
const ordres = decouper(sansCommentaires(fichier(NOM_MIGRATION)))
const garde = ordres.find(o => /^do \$garde\$/.test(o))
assert.ok(garde, 'bloc de garde introuvable')

/** Les controles de scripts/audit-rls.mjs (verifier:rls), memes requetes, pour les rejouer DANS la transaction. */
const LECTURE_PUBLIQUE_ASSUMEE = new Set(['courses', 'modules', 'lessons', 'upcoming_sessions', 'learnybox_articles', 'sync_status'])
const ECRITURE_ANONYME_ASSUMEE = new Set(['masterclass_leads'])
async function auditer(c) {
  const alertes = []
  for (const t of await c.$queryRawUnsafe(`select c.relname as tbl from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)) alertes.push(`table sans RLS : ${t.tbl}`)
  for (const o of await c.$queryRawUnsafe(`select tablename, policyname, cmd, roles::text as roles from pg_policies
      where schemaname = 'public' and cmd in ('SELECT', 'ALL', 'UPDATE', 'DELETE') and coalesce(qual, 'true') = 'true'
        and (roles::text like '%public%' or roles::text like '%anon%')`)) {
    if (!(LECTURE_PUBLIQUE_ASSUMEE.has(o.tablename) && o.cmd === 'SELECT')) alertes.push(`acces ouvert : ${o.tablename} -> "${o.policyname}" (${o.cmd})`)
  }
  for (const e of await c.$queryRawUnsafe(`select tablename, policyname from pg_policies where schemaname = 'public' and cmd = 'INSERT'
      and coalesce(with_check, 'true') = 'true' and (roles::text like '%public%' or roles::text like '%anon%')`)) {
    if (!ECRITURE_ANONYME_ASSUMEE.has(e.tablename)) alertes.push(`ecriture ouverte : ${e.tablename} -> "${e.policyname}"`)
  }
  for (const v of await c.$queryRawUnsafe(`select c.relname as vue, coalesce(array_to_string(c.reloptions, ','), '') as options,
      pg_get_viewdef(c.oid, true) as def, has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
      has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('v', 'm')`)) {
    if (!v.anon_select && !v.auth_select) continue
    if (!v.options.includes('security_invoker=true') && !/is_cockpit_member\(\)|auth\.uid\(\)|auth\.jwt\(\)/.test(v.def)) alertes.push(`vue sans garde : ${v.vue}`)
  }
  return alertes.sort()
}

class Annulation extends Error {}
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const court = id => `${String(id).slice(0, 8)}...`
const motif = e => String(e?.meta?.message ?? e?.message ?? e).split('\n').map(l => l.trim()).filter(Boolean)
  .find(l => /permission|policy|violates|denied|row-level|does not exist|Refus|Reserve|exception|introuvable|deja/i.test(l))?.slice(0, 160) ?? 'refus'
const num = v => (v === null || v === undefined ? null : Number(v))

const existe = async (c, sig) => (await c.$queryRawUnsafe(`select to_regprocedure($1) is not null as la`, sig))[0].la
if (await existe(prisma, 'public.aok_anciens_activer(uuid)')) {
  throw new Error('aok_anciens_activer existe DEJA : cet essai est fait pour la migration pas encore appliquee.')
}
const ETAT = `select (select last_value from public.member_number_seq) as seq, (select is_called from public.member_number_seq) as appele,
  (select count(*) from public.profiles) as comptes, (select max(client_number) from public.profiles) as maxi,
  (select md5(string_agg(id::text || ':' || client_number::text, ',' order by id)) from public.profiles) as empreinte,
  to_regclass('public.aok_anciens_membres') is not null as table_la`
const avantHors = (await prisma.$queryRawUnsafe(ETAT))[0]

const SUFFIXE = randomUUID().slice(0, 8)
const adresse = n => `essai-anciens-${n}-${SUFFIXE}@exemple.invalid`

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '60s'`)
    let n = 0
    const sql = (s, ...p) => tx.$queryRawUnsafe(s, ...p)
    const exec = (s, ...p) => tx.$executeRawUnsafe(s, ...p)
    async function poser(role, compte) {
      const claims = JSON.stringify(compte ? { sub: compte.id, role, email: compte.email, aud: 'authenticated' } : { role })
      await exec(`select set_config('request.jwt.claims', $1, true)`, claims)
      await exec(`select set_config('request.jwt.claim.sub', $1, true)`, compte ? compte.id : '')
      await exec(`set local role ${role}`)
    }
    async function lever() {
      await exec(`reset role`)
      await exec(`select set_config('request.jwt.claims', '', true)`)
      await exec(`select set_config('request.jwt.claim.sub', '', true)`)
    }
    /** Lit sous un role, puis annule ce qu il a fait (savepoint). */
    async function comme(role, compte, s, ...params) {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      try {
        await poser(role, compte)
        return { ok: true, lignes: await sql(s, ...params) }
      } catch (e) {
        return { ok: false, motif: motif(e) }
      } finally {
        await exec(`rollback to savepoint ${sp}`)
        await lever()
      }
    }
    /** Doit echouer (savepoint annule). */
    async function refuse(s, attendu) {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      try {
        await exec(s)
        return { ok: true }
      } catch (e) {
        const m = motif(e)
        if (attendu) assert.match(m, attendu)
        return { ok: false, motif: m }
      } finally {
        await exec(`rollback to savepoint ${sp}`)
      }
    }

    // --- 0. La garde du fichier --------------------------------------------
    const avant = await sql(`select id::text as id, client_number::bigint as numero, role::text as role, created_at
        from public.profiles order by created_at, id`)
    const unProfil = avant.find(p => p.role !== 'admin')
    let r
    {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      await exec(`update public.profiles set profil_public = true where id = $1::uuid`, unProfil.id)
      const g = await refuse(garde, /Refus/)
      await exec(`rollback to savepoint ${sp}`)
      assert.equal(g.ok, false)
      ok(`garde : un profil public bloque le fichier (« ${g.motif.slice(0, 60)}... »)`)
    }
    {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      await exec(`update public.profiles set client_number = 150 where id = $1::uuid`, unProfil.id)
      const g = await refuse(garde, /Refus/)
      await exec(`rollback to savepoint ${sp}`)
      assert.equal(g.ok, false)
      ok(`garde : un numero de 3 a 300 deja porte bloque le fichier`)
    }

    // --- 1. La migration ----------------------------------------------------
    const auditAvant = await auditer(tx)
    for (const o of ordres) await exec(o)
    ok(`migration jouee : ${ordres.length} ordres`)

    const apres = await sql(`select id::text as id, client_number::bigint as numero, role::text as role from public.profiles`)
    const numeroDe = new Map(apres.map(p => [p.id, num(p.numero)]))
    const ancienNumero = new Map(avant.map(p => [p.id, num(p.numero)]))
    const equipe = avant.filter(p => p.role === 'admin')
    const attenduEquipe = new Map([[1, 1], [2, 2], [21252, 3], [21265, 4]])
    for (const p of equipe) assert.equal(numeroDe.get(p.id), attenduEquipe.get(ancienNumero.get(p.id)), `equipe ${ancienNumero.get(p.id)}`)
    const autres = avant.filter(p => p.role !== 'admin')
    autres.forEach((p, i) => assert.equal(numeroDe.get(p.id), 301 + i, `compte ${court(p.id)} : ${numeroDe.get(p.id)} au lieu de ${301 + i}`))
    ok(`numeros : equipe 1, 2, 3, 4 (21252 -> 3, 21265 -> 4) ; ${autres.length} comptes de 301 a ${300 + autres.length}, dans l ordre d inscription`)
    const seq = (await sql(`select last_value::bigint as v, is_called as c from public.member_number_seq`))[0]
    assert.equal(num(seq.v), 300 + autres.length)
    assert.equal(seq.c, true)
    const defaut = (await sql(`select column_default as d from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'client_number'`))[0].d
    assert.match(defaut, /nextval\('member_number_seq'/)
    ok(`sequence : last_value ${num(seq.v)}, prochain inscrit ${num(seq.v) + 1}, defaut ${defaut}`)
    const acl = (await sql(`select relacl::text as a from pg_class where oid = 'public.member_number_seq'::regclass`))[0].a
    for (const role of ['anon', 'authenticated', 'service_role']) assert.match(acl, new RegExp(`${role}=rwU`))
    ok(`sequence : memes droits qu avant (anon, authenticated, service_role rwU)`)

    // Rejouable : la garde et l equipe passent une seconde fois, la renumerotation ne change rien.
    const EMPREINTE = `select md5(string_agg(id::text || ':' || client_number::text, ',' order by id)) as e from public.profiles`
    const apres1 = (await sql(EMPREINTE))[0].e
    await exec(garde)
    const rejeu = num((await sql(`select public.aok_numeros_renumeroter() as n`))[0].n)
    assert.equal((await sql(EMPREINTE))[0].e, apres1)
    assert.equal(rejeu, 0)
    ok(`rejouable : garde rejouee, renumerotation rejouee sans effet (${rejeu} ligne(s) reecrite(s))`)

    // --- 2. Les reservations factices et les inscriptions --------------------
    const brice = (await sql(`select p.id::text as id, lower(u.email) as email from public.profiles p join auth.users u on u.id = p.id where p.client_number = 1`))[0]
    const fiche = async (nom) => (await sql(`insert into public.cockpit_membres (nom, prenom, source_entree) values ($1, $2, 'essai') returning membre_id::text as id`, nom, nom.split(' ')[0]))[0].id
    const ficheA = await fiche('Essai Alpha')
    const ficheD = await fiche('Essai Delta')
    await exec(`insert into public.cockpit_membre_emails (email, membre_id, principal, verifie) values ($1, $2::uuid, true, true), ($3, $4::uuid, true, true)`,
      adresse('alpha'), ficheA, adresse('delta'), ficheD)
    await exec(`insert into public.cockpit_arch_personnes (personne_id, nom, nature, palier, tg_ids, membre_id, membre_lie_par, membre_confiance)
      values ('p-essai-alpha-${SUFFIXE}', 'Essai Alpha', 'eleve', 'epais', '{}', $1::uuid, 'essai', 'certain'),
             ('p-essai-bravo-${SUFFIXE}', 'Bravo Homonyme', 'eleve', 'epais', '{}', null, null, null),
             ('p-essai-charlie-${SUFFIXE}', 'Essai Charlie', 'eleve', 'solide', '{99999990${SUFFIXE.replace(/\D/g, '').slice(0, 6).padEnd(6, '7')}}', null, null, null),
             ('p-essai-delta-${SUFFIXE}', 'Essai Delta', 'eleve', 'mince', '{}', null, null, null)`, ficheA)
    await exec(`insert into public.cockpit_membre_fonds_manuel (membre_id, personne_id, pose_par) values ($1::uuid, 'p-essai-delta-${SUFFIXE}', $2::uuid)`, ficheD, brice.id)
    const tgCharlie = (await sql(`select tg_ids[1] as t from public.cockpit_arch_personnes where personne_id = 'p-essai-charlie-${SUFFIXE}'`))[0].t
    await exec(`insert into public.aok_anciens_membres (numero, personne_id, nom, epoque, premiere_activite) values
        (21, 'p-essai-alpha-${SUFFIXE}', 'Essai Alpha', 'izitrade', '2018-06-02'),
        (22, 'p-essai-bravo-${SUFFIXE}', 'Bravo Homonyme', 'izitrade', '2019-01-01'),
        (23, 'p-essai-charlie-${SUFFIXE}', 'Essai Charlie', 'learnybox', '2023-02-20'),
        (24, 'p-essai-delta-${SUFFIXE}', 'Essai Delta', 'learnybox', '2023-03-05')`)
    ok(`reservations factices 21 a 24 posees (fiches, adresses .invalid, personnes p-essai-*)`)

    // Aucun compte existant ne correspond a ces reservations.
    const existants = await sql(`select count(*) filter (where (public.aok_anciens_activer(p.id)->>'active') is not null)::int as actives
        from public.profiles p where p.role::text <> 'admin'`)
    assert.equal(existants[0].actives, 0)
    const propsExistants = num((await sql(`select count(*) as n from public.aok_anciens_propositions`))[0].n)
    assert.equal(propsExistants, 0)
    ok(`les ${autres.length} comptes existants passes a aok_anciens_activer : aucune activation, aucune proposition`)

    async function inscrire(nomComplet, email, confirme = true) {
      const id = randomUUID()
      await exec(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
        values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, ${confirme ? 'now()' : 'null'},
                jsonb_build_object('full_name', $3::text), '{"provider":"google","providers":["google"]}'::jsonb, now(), now())`, id, email, nomComplet)
      const p = (await sql(`select client_number::bigint as n from public.profiles where id = $1::uuid`, id))[0]
      return { id, email, numero: num(p?.n) }
    }
    const reservation = async (numero) => (await sql(`select profile_id::text as p, active_mode as m, active_par::text as par from public.aok_anciens_membres where numero = $1`, numero))[0]

    const alpha = await inscrire('Alpha Essai', adresse('alpha'))
    assert.equal(alpha.numero, 21)
    let res = await reservation(21)
    assert.equal(res.p, alpha.id)
    assert.equal(res.m, 'email')
    ok(`inscription Google, adresse de la fiche liee « certain » : activee tout de suite, n 21 (email)`)

    const bravo = await inscrire('Homonyme Bravo', adresse('bravo'))
    assert.equal(bravo.numero, 300 + autres.length + 2)
    res = await reservation(22)
    assert.equal(res.p, null)
    const propB = await sql(`select proposition_id::text as id, motif, statut from public.aok_anciens_propositions where profile_id = $1::uuid`, bravo.id)
    assert.equal(propB.length, 1)
    assert.equal(propB[0].motif, 'nom')
    ok(`inscription au meme nom seulement : n ${bravo.numero} (sequence, le 1er inscrit a libere ${300 + autres.length + 1}), une proposition « nom », pas d activation`)

    const sansRien = await inscrire('Personne Inconnue', adresse('inconnu'))
    assert.equal(sansRien.numero, bravo.numero + 1)
    assert.equal(num((await sql(`select count(*) as n from public.aok_anciens_propositions where profile_id = $1::uuid`, sansRien.id))[0].n), 0)
    ok(`inscription sans rien : n ${sansRien.numero}, le numero suivant, aucune proposition`)

    const charlie = await inscrire('Charlie Autre', adresse('charlie'))
    assert.equal(charlie.numero, sansRien.numero + 1)
    await exec(`insert into public.cockpit_liveclub_rattachements (telegram_id, email, source) values ($1::bigint, $2, 'bot')`, tgCharlie, adresse('charlie'))
    res = await reservation(23)
    assert.equal(res.p, charlie.id)
    assert.equal(res.m, 'telegram')
    assert.equal(num((await sql(`select client_number::bigint as n from public.profiles where id = $1::uuid`, charlie.id))[0].n), 23)
    ok(`rattachement Telegram du Live Club apres l inscription : activee, n ${charlie.numero} -> 23 (telegram)`)

    const delta = await inscrire('Delta Essai', adresse('delta'), false)
    assert.equal(delta.numero, charlie.numero + 1)
    assert.equal((await reservation(24)).p, null)
    await exec(`update auth.users set email_confirmed_at = now() where id = $1::uuid`, delta.id)
    res = await reservation(24)
    assert.equal(res.p, delta.id)
    assert.equal(res.m, 'email')
    ok(`email pas encore confirme : rien a l inscription (n ${delta.numero}), activee a la confirmation -> 24 (lien manuel du cockpit, « certain »)`)

    {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      await exec(`create or replace function public.aok_anciens_activer(p_user uuid) returns jsonb language plpgsql security definer set search_path to '' as $f$ begin raise exception 'panne d essai'; end $f$`)
      const panne = await inscrire('Panne Essai', adresse('panne'))
      assert.ok(panne.numero > delta.numero)
      await exec(`rollback to savepoint ${sp}`)
      ok(`une panne de l activation ne bloque pas l inscription (compte cree, n ${panne.numero}, simple avertissement)`)
    }

    // --- 3. RLS et fonctions, sous les vrais roles ----------------------------
    const cockpit = (await sql(`select a.user_id::text as id, lower(u.email) as email from public.cockpit_allowlist a join auth.users u on u.id = a.user_id
        join public.profiles p on p.id = a.user_id where p.role::text = 'admin' order by p.client_number limit 1`))[0]
    const membre = (await sql(`select p.id::text as id, lower(u.email) as email from public.profiles p join auth.users u on u.id = p.id
        where p.role::text <> 'admin' and p.id not in (select user_id from public.cockpit_allowlist) and p.client_number > 300
        order by p.client_number limit 1`))[0]

    r = await comme('anon', null, `select count(*)::int as n from public.aok_anciens_membres`)
    assert.equal(r.ok, false)
    r = await comme('anon', null, `select count(*)::int as n from public.aok_anciens_propositions`)
    assert.equal(r.ok, false)
    r = await comme('anon', null, `select public.aok_anciens_a_confirmer()`)
    assert.equal(r.ok, false)
    ok(`anon : ni la table, ni les propositions, ni la liste a confirmer (permission refusee)`)

    r = await comme('authenticated', membre, `select count(*)::int as n from public.aok_anciens_membres`)
    assert.equal(r.ok, true); assert.equal(r.lignes[0].n, 0)
    r = await comme('authenticated', membre, `select count(*)::int as n from public.aok_anciens_propositions`)
    assert.equal(r.ok, true); assert.equal(r.lignes[0].n, 0)
    r = await comme('authenticated', membre, `select count(*)::int as n from public.aok_anciens_a_confirmer()`)
    assert.equal(r.ok, true); assert.equal(r.lignes[0].n, 0)
    r = await comme('authenticated', membre, `select public.aok_anciens_confirmer('${propB[0].id}'::uuid)`)
    assert.equal(r.ok, false)
    r = await comme('authenticated', membre, `select public.aok_anciens_refuser('${propB[0].id}'::uuid)`)
    assert.equal(r.ok, false)
    for (const f of [`public.aok_anciens_activer('${membre.id}'::uuid)`, `public.aok_numeros_renumeroter()`, `public.aok_anciens_correspondances('${membre.id}'::uuid)`,
      `public.aok_anciens_poser(22, '${membre.id}'::uuid, 'email', null)`]) {
      r = await comme('authenticated', membre, `select ${f}`)
      assert.equal(r.ok, false, f)
    }
    ok(`membre ordinaire (n ${numeroDe.get(membre.id)}) : table 0 ligne, propositions 0, liste 0, confirmer/refuser refuses, activer, poser, correspondances, renumeroter refuses`)

    r = await comme('authenticated', cockpit, `select count(*)::int as n from public.aok_anciens_membres`)
    assert.equal(r.ok, true); assert.equal(r.lignes[0].n, 4)
    r = await comme('authenticated', cockpit, `select * from public.aok_anciens_a_confirmer()`)
    assert.equal(r.ok, true); assert.equal(r.lignes.length, 1); assert.equal(num(r.lignes[0].numero), 22); assert.equal(num(r.lignes[0].compte_numero), bravo.numero)
    assert.ok(!JSON.stringify(r.lignes, (k, x) => (typeof x === 'bigint' ? Number(x) : x)).includes('@'), 'la liste a confirmer ne doit porter aucune adresse')
    // « C est bien lui » : garde l effet.
    await poser('authenticated', cockpit)
    const conf = (await sql(`select public.aok_anciens_confirmer($1::uuid) as r`, propB[0].id))[0].r
    await lever()
    assert.equal(num(conf.numero), 22)
    assert.equal(num(conf.ancien_numero), bravo.numero)
    res = await reservation(22)
    assert.equal(res.p, bravo.id); assert.equal(res.m, 'confirmation'); assert.equal(res.par, cockpit.id)
    assert.equal((await sql(`select statut from public.aok_anciens_propositions where proposition_id = $1::uuid`, propB[0].id))[0].statut, 'confirmee')
    r = await comme('authenticated', cockpit, `select public.aok_anciens_confirmer('${propB[0].id}'::uuid)`)
    assert.equal(r.ok, false)
    ok(`compte du cockpit : lit les 4 reservations, voit 1 proposition sans adresse, « c est bien lui » -> n ${bravo.numero} -> 22 (confirmation, par lui), une seconde fois refusee`)

    // Le badge : public seulement, ou pour soi.
    r = await comme('anon', null, `select * from public.aok_anciennete_badges(array[21, 22, 23, 24]::bigint[])`)
    assert.equal(r.ok, true); assert.equal(r.lignes.length, 0)
    r = await comme('authenticated', { id: alpha.id, email: alpha.email }, `select * from public.aok_anciennete_badges(array[21]::bigint[])`)
    assert.equal(r.ok, true); assert.equal(r.lignes[0]?.libelle, 'Depuis IziTrade')
    {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      await exec(`update public.profiles set profil_public = true, masquer_moteurs = false where id = $1::uuid`, charlie.id)
      r = await comme('anon', null, `select * from public.aok_anciennete_badges(array[21, 22, 23, 24]::bigint[])`)
      assert.equal(r.ok, true); assert.equal(r.lignes.length, 1); assert.equal(r.lignes[0].libelle, 'Depuis LearnyBox')
      r = await comme('authenticated', membre, `select * from public.aok_anciennete_badges(array[21, 22, 23, 24]::bigint[])`)
      assert.equal(r.lignes.length, 1)
      await exec(`rollback to savepoint ${sp}`)
    }
    ok(`badge : rien pour un profil prive, « Depuis IziTrade » pour soi, « Depuis LearnyBox » pour tous une fois le profil public`)

    // --- 4. Les gardes de la renumerotation ------------------------------------
    {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      await exec(`update public.profiles set profil_public = true where id = $1::uuid`, sansRien.id)
      const g = await refuse(`select public.aok_numeros_renumeroter()`, /Refus/)
      await exec(`rollback to savepoint ${sp}`)
      assert.equal(g.ok, false)
    }
    {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      // 57 comptes reels + l inscrit « sans rien » : cibles 301 a 358, et 358 est libre (le 1er inscrit l a quitte pour 21).
      await exec(`update public.profiles set client_number = $1::bigint where client_number = 4 and role::text = 'admin'`, 300 + autres.length + 1)
      const g = await refuse(`select public.aok_numeros_renumeroter()`, /Refus/)
      await exec(`rollback to savepoint ${sp}`)
      assert.equal(g.ok, false)
    }
    ok(`renumerotation : refusee si un profil est public, refusee si un numero de destination est deja porte (equipe)`)

    // --- 5. verifier:rls dans la transaction ------------------------------------
    const auditApres = await auditer(tx)
    const nouvelles = auditApres.filter(a => !auditAvant.includes(a))
    assert.deepEqual(nouvelles, [], `alertes nouvelles : ${nouvelles.join(' | ')}`)
    ok(`controles de verifier:rls rejoues apres la migration : ${auditApres.length} alerte(s), toutes deja la avant (${auditApres.join(' | ') || 'aucune'}), aucune nouvelle`)

    throw new Annulation()
  }, { timeout: 180000, maxWait: 20000 })
} catch (e) {
  if (!(e instanceof Annulation)) { console.error('ECHEC :', motif(e), '\n', String(e?.stack ?? e).split('\n').slice(0, 6).join('\n')); process.exitCode = 1 }
}

// --- Hors transaction : rien n est reste ---------------------------------------
const apresHors = (await prisma.$queryRawUnsafe(ETAT))[0]
assert.equal(await existe(prisma, 'public.aok_anciens_activer(uuid)'), false)
assert.equal(apresHors.table_la, false)
assert.equal(String(apresHors.seq), String(avantHors.seq))
assert.equal(apresHors.appele, avantHors.appele)
assert.equal(String(apresHors.comptes), String(avantHors.comptes))
assert.equal(apresHors.empreinte, avantHors.empreinte)
ok(`annule : aucune table ni fonction restee, ${avantHors.comptes} comptes aux memes numeros (max ${avantHors.maxi}), sequence intacte (last_value ${avantHors.seq})`)
await prisma.$disconnect()
console.log(`\n${etapes} etapes, ${process.exitCode ? 'ECHEC' : 'tout est bon'}.`)
