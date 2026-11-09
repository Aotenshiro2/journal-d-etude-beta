/**
 * ESSAI de la migration 20261109235900_aok_profils_par_numero.sql (les profils
 * par numero suivent la regle de l annuaire, 10/11/2026) contre la vraie base,
 * dans UNE transaction TOUJOURS ANNULEE (rien ne reste). Le lot 1
 * (20261109234500) et l annuaire (20261109235500) ne sont pas appliques :
 * l essai les joue d abord, dans la meme transaction.
 *
 * COURTE A DESSEIN : le lot 1 prend un verrou exclusif sur profiles (il bloque
 * aussi les lectures du site en ligne) jusqu a l annulation. Tout ce qui peut
 * se preparer se prepare AVANT le begin (lectures, audit d avant, comptes en
 * JSON), lock_timeout 5 s, et la duree entre le begin et le rollback est
 * mesuree et affichee.
 *
 * Ce qui est verifie :
 *   0. la garde refuse le fichier tant que l annuaire n est pas passe ,
 *   1. lot 1, annuaire puis ce fichier passent, ce fichier est rejouable ,
 *      aok_profil_public(bigint) remplacee par (bigint, boolean), volatile,
 *      fonctions internes fermees a anon et authenticated ,
 *   2. 26 profils publics d essai (24 dans l ordre fixe, 1 « membres » hors des
 *      24, 1 « web » hors des 24), 1 prive, un visiteur gratuit, un payant :
 *      - les 24 de aok_annuaire_gratuits = les 24 de l annuaire du gratuit ,
 *      - le gratuit lit un profil « membres » de ses 24, pas un autre : la
 *        meme reponse ({vue: limitee}) pour hors des 24, inconnu et prive ,
 *      - le payant les lit tous , un profil « web » est lisible par tous ,
 *        l anonyme ne lit que le web ,
 *      - les badges suivent la meme regle , la regle de la photo
 *        (aok_profil_visible, la requete de la route du journal) aussi ,
 *      - un profil de l equipe reste lisible du gratuit (en tete des 24) ,
 *   3. plafond : chaque lecture compte (pas la sienne, pas l anonyme), partage
 *      avec l annuaire , au 61e « plafond compte », un profil web se lit
 *      encore, un autre compte passe , 5 000 pour le site : « plafond site » ,
 *      menage des lignes de plus de 2 jours ,
 *   4. les controles de verifier:rls rejoues dans la transaction : rien de neuf.
 * Puis la transaction est annulee, et on verifie hors transaction que rien
 * n est reste. Aucun email, nom ni identifiant complet affiche.
 *
 * Lancement (depuis le worktree du journal) :
 *   AOK_WORKSPACE=<racine du workspace> node --env-file=.env --env-file=.env.local scripts/essayer-migration-profils-par-numero.mjs
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

const LOT1 = '20261109234500_anciens_membres_numeros.sql'
const ANNUAIRE = '20261109235500_aok_annuaire.sql'
const NOM_MIGRATION = '20261109235900_aok_profils_par_numero.sql'
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
const ordres1 = decouper(sansCommentaires(fichier(LOT1)))
const ordres2 = decouper(sansCommentaires(fichier(ANNUAIRE)))
const ordres = decouper(sansCommentaires(fichier(NOM_MIGRATION)))
const garde = ordres.find(o => /^do \$garde\$/.test(o))
assert.ok(garde, 'bloc de garde introuvable')
for (const o of ordres) assert.match(o, /^(do|create|comment|alter|revoke|grant|drop|notify)\b/i, `ordre suspect (point-virgule mal place ?) : ${o.slice(0, 60)}`)

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
const motif = e => String(e?.meta?.message ?? e?.message ?? e).split('\n').map(l => l.trim()).filter(Boolean)
  .find(l => /permission|policy|violates|denied|row-level|does not exist|Refus|Reserve|exception|introuvable|connexion|lock|timeout/i.test(l))?.slice(0, 160) ?? 'refus'
const num = v => (v === null || v === undefined ? null : Number(v))
const json = x => JSON.parse(JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? Number(v) : v)))
const tri = a => [...a].sort((x, y) => x - y)

// --- Avant le begin : tout ce qui se lit et se prepare ---------------------------
const existe = async sig => (await prisma.$queryRawUnsafe(`select to_regprocedure($1) is not null as la`, sig))[0].la
for (const [sig, quoi] of [['public.aok_anciens_activer(uuid)', 'le lot 1'], ['public.aok_annuaire(text, jsonb, integer)', 'l annuaire'],
  ['public.aok_annuaire_gratuits()', 'cette migration'], ['public.aok_profil_public(bigint, boolean)', 'cette migration']]) {
  if (await existe(sig)) throw new Error(`${sig} existe DEJA : ${quoi} est applique, cet essai le rejouerait. Adapter l essai.`)
}
assert.equal(await existe('public.aok_profil_public(bigint)'), true, 'aok_profil_public(bigint) absente : la base n est pas celle attendue')
const ETAT = `select (select last_value from public.member_number_seq) as seq, (select is_called from public.member_number_seq) as appele,
  (select count(*) from public.profiles) as comptes, (select max(client_number) from public.profiles) as maxi,
  (select count(*) from public.profiles where profil_public) as publics,
  (select md5(string_agg(id::text || ':' || client_number::text || ':' || profil_public::text || ':' || masquer_moteurs::text || ':' || coalesce(role::text, ''), ',' order by id)) from public.profiles) as empreinte,
  (select md5(p.prosrc) || ':' || p.provolatile::text || ':' || coalesce(p.proacl::text, '') from pg_proc p where p.oid = to_regprocedure('public.aok_profil_public(bigint)')) as profil_fn,
  (select md5(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace) as fonctions,
  to_regclass('public.aok_annuaire_appels') is not null as appels_la, to_regclass('public.aok_anciens_membres') is not null as lot1_la`
const avantHors = (await prisma.$queryRawUnsafe(ETAT))[0]
assert.equal(num(avantHors.publics), 0, 'des profils publics existent : la garde du lot 1 refusera, l essai ne peut pas passer')
const auditAvant = await auditer(prisma)
const offreModule = (await prisma.$queryRawUnsafe(`select id::text as id from public.academie_offres where slug = 'module-journaling'`))[0]?.id
assert.ok(offreModule, 'offre module-journaling introuvable')

const SUFFIXE = randomUUID().slice(0, 8)
const compte = cle => ({ cle, id: randomUUID(), email: `essai-profils-${cle}-${SUFFIXE}@exemple.invalid`, nom: `Essai Profils ${cle}` })
// 24 dans l ordre fixe (points du mois precedent 100 a 77), puis un « membres » et un « web » hors des 24.
const dans = Array.from({ length: 24 }, (_, i) => ({ ...compte(`d${String(i + 1).padStart(2, '0')}`), pts: 100 - i, web: false }))
const mDans = dans[0]
const mHors = { ...compte('hors'), pts: 10, web: false }
const mWeb = { ...compte('web'), pts: 5, web: true }
const publics = [...dans, mHors, mWeb]
const mPrive = compte('prive')
const vGratuit = compte('vg')
const vPayant = compte('vp')
const tous = [...publics, mPrive, vGratuit, vPayant]
const INCONNU = 999999999

let tBegin = 0
let tRollback = 0
let tMigrations = 0
const mesures = {}
try {
  tBegin = Date.now()
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '30s'`)
    let n = 0
    const sql = (s, ...p) => tx.$queryRawUnsafe(s, ...p)
    const exec = (s, ...p) => tx.$executeRawUnsafe(s, ...p)
    async function comme(role, c, s, ...p) {
      await exec(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
        JSON.stringify(c ? { sub: c.id, role, email: c.email, aud: 'authenticated' } : { role }), c ? c.id : '')
      await exec(`set local role ${role}`)
      // Une erreur ici casse la transaction : on la laisse remonter telle quelle.
      const r = await sql(s, ...p)
      await exec(`reset role`)
      return json(r)
    }
    /** Doit echouer (savepoint annule). */
    async function refuse(fn) {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      try { await fn(); return { ok: true } } catch (e) { return { ok: false, motif: motif(e) } } finally {
        await exec(`rollback to savepoint ${sp}`)
        await exec(`reset role`)
      }
    }
    const profil = async (c, numero, etat = true) =>
      (await comme(c ? 'authenticated' : 'anon', c, `select public.aok_profil_public($1::bigint, $2::boolean) as r`, numero, etat))[0].r
    const profil1 = async (c, numero) =>
      (await comme(c ? 'authenticated' : 'anon', c, `select public.aok_profil_public($1::bigint) as r`, numero))[0].r
    const badges = async (c, numeros) =>
      (await comme(c ? 'authenticated' : 'anon', c, `select numero from public.aok_badges_membres(array(select jsonb_array_elements_text($1::jsonb)::bigint))`,
        JSON.stringify(numeros))).map(x => x.numero)
    const annuaire = async c => (await comme('authenticated', c, `select public.aok_annuaire(null, '{}'::jsonb, 1) as r`))[0].r
    const compteur = async c => num((await sql(`select n from public.aok_annuaire_appels where user_id = $1::uuid and heure = date_trunc('hour', now())`, c.id))[0]?.n ?? 0)
    const pret = (r, c) => r && r.numero === c.numero && typeof r.nom === 'string' && r.progression && Array.isArray(r.espaces)

    // --- 0. La garde ---------------------------------------------------------------
    const g = await refuse(() => exec(garde))
    assert.equal(g.ok, false)
    assert.match(g.motif, /Refus/)
    ok(`garde : refuse tant que l annuaire n est pas passe (« ${g.motif.slice(0, 60)}... »)`)

    // --- 1. Les trois migrations ------------------------------------------------------
    const tm = Date.now()
    for (const o of ordres1) await exec(o)
    for (const o of ordres2) await exec(o)
    for (const o of ordres) await exec(o)
    tMigrations = Date.now() - tm
    for (const o of ordres) await exec(o)
    const sig = json(await sql(`select to_regprocedure('public.aok_profil_public(bigint)') is null as ancienne_partie,
        (select provolatile::text from pg_proc where oid = to_regprocedure('public.aok_profil_public(bigint, boolean)')) as volatil,
        has_function_privilege('anon', 'public.aok_profil_public(bigint, boolean)', 'execute') as anon_profil,
        has_function_privilege('authenticated', 'public.aok_profil_public(bigint, boolean)', 'execute') as auth_profil,
        has_function_privilege('anon', 'public.aok_badges_membres(bigint[])', 'execute') as anon_badges,
        has_function_privilege('anon', 'public.aok_profil_visible(uuid, uuid)', 'execute') as anon_visible,
        has_function_privilege('authenticated', 'public.aok_profil_visible(uuid, uuid)', 'execute') as auth_visible,
        has_function_privilege('anon', 'public.aok_annuaire_gratuits()', 'execute') as anon_gratuits,
        has_function_privilege('authenticated', 'public.aok_annuaire_gratuits()', 'execute') as auth_gratuits,
        (select count(*) from pg_proc where proname = 'aok_profil_public' and pronamespace = 'public'::regnamespace
           and prosrc like '%masquer_moteurs = false%')::int as repere_verificateur`))[0]
    assert.deepEqual(sig, { ancienne_partie: true, volatil: 'v', anon_profil: true, auth_profil: true, anon_badges: true,
      anon_visible: false, auth_visible: false, anon_gratuits: false, auth_gratuits: false, repere_verificateur: 1 })
    ok(`lot 1 (${ordres1.length} ordres), annuaire (${ordres2.length}), puis ce fichier (${ordres.length}) en ${tMigrations} ms, rejouable ; aok_profil_public(bigint, boolean) volatile remplace (bigint), anon et authenticated l executent, aok_profil_visible et aok_annuaire_gratuits fermees a anon et authenticated`)

    // --- 2. Les comptes d essai (4 ordres) ------------------------------------------------
    await exec(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
      select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x.email, now(),
             jsonb_build_object('full_name', x.nom), '{"provider":"google","providers":["google"]}'::jsonb, now(), now()
        from jsonb_to_recordset($1::jsonb) as x(id uuid, email text, nom text)`, JSON.stringify(tous.map(c => ({ id: c.id, email: c.email, nom: c.nom }))))
    const nums = json(await sql(`select id::text as id, client_number as n from public.profiles where id = any(array(select jsonb_array_elements_text($1::jsonb))::uuid[])`,
      JSON.stringify(tous.map(c => c.id))))
    for (const c of tous) { c.numero = nums.find(x => x.id === c.id)?.n; assert.ok(c.numero, 'profil cree par le declencheur') }
    await exec(`update public.profiles p set profil_public = true, masquer_moteurs = not x.web, nom_affiche = x.nom
      from jsonb_to_recordset($1::jsonb) as x(id uuid, web boolean, nom text) where p.id = x.id`,
      JSON.stringify(publics.map(c => ({ id: c.id, web: c.web, nom: c.nom }))))
    await exec(`insert into public.aok_annuaire_mesures (profile_id, niveau, progres, pts_mois, mois, calcule_le)
      select x.id, 1, 0, x.pts, (date_trunc('month', ((date_trunc('month', now() at time zone 'Europe/Paris'))::date - 1)))::date, now()
        from jsonb_to_recordset($1::jsonb) as x(id uuid, pts integer)`, JSON.stringify(publics.map(c => ({ id: c.id, pts: c.pts }))))
    await exec(`insert into public.academie_acces (user_id, offre_id, source, pose_par) values ($1::uuid, $2::uuid, 'stripe', 'essai')`, vPayant.id, offreModule)
    const statuts = json(await sql(`select public.aok_annuaire_acces($1::uuid) ->> 'statut' as g, public.aok_annuaire_acces($2::uuid) ->> 'statut' as p`, vGratuit.id, vPayant.id))[0]
    assert.deepEqual(statuts, { g: 'communaute', p: 'eleve' })
    ok(`comptes d essai : ${publics.length} publics (24 dans l ordre fixe, 1 « membres » et 1 « web » hors des 24), 1 prive, un visiteur gratuit (communaute) et un payant (eleve, module)`)

    // --- 3. Les 24 du gratuit : la meme liste que l annuaire -------------------------------
    const attenduG = { n: 0 }
    const ann = await annuaire(vGratuit); attenduG.n++
    assert.equal(ann.vue, 'limitee')
    const vingtQuatre = json(await sql(`select p.client_number as n from public.aok_annuaire_gratuits() with ordinality as g(id, rang)
        join public.profiles p on p.id = g.id order by g.rang`)).map(x => x.n)
    assert.deepEqual(ann.membres.map(m => m.numero), vingtQuatre, 'meme liste, meme ordre que l annuaire')
    assert.deepEqual(vingtQuatre, dans.map(c => c.numero))
    assert.ok(!vingtQuatre.includes(mHors.numero) && !vingtQuatre.includes(mWeb.numero))
    ok(`aok_annuaire_gratuits = les 24 de l annuaire du gratuit, dans le meme ordre ; « hors » et « web » n y sont pas`)

    // --- 4. Le gratuit -----------------------------------------------------------------------
    let t = Date.now()
    const gDans = await profil(vGratuit, mDans.numero); attenduG.n++
    mesures.lectureDans = Date.now() - t
    assert.ok(pret(gDans, mDans), 'le gratuit lit un profil « membres » de ses 24')
    assert.ok(!JSON.stringify(gDans).includes('@') && !JSON.stringify(gDans).includes(mDans.id), 'ni adresse ni uuid')
    t = Date.now()
    const gHors = await profil(vGratuit, mHors.numero); attenduG.n++
    mesures.lectureHors = Date.now() - t
    assert.deepEqual(gHors, { vue: 'limitee' })
    assert.equal(await profil1(vGratuit, mHors.numero), null); attenduG.n++
    assert.equal(await profil(vGratuit, mHors.numero, false), null); attenduG.n++
    assert.deepEqual(await profil(vGratuit, INCONNU), gHors); attenduG.n++
    assert.deepEqual(await profil(vGratuit, mPrive.numero), gHors); attenduG.n++
    assert.deepEqual(await profil(vGratuit, 0), gHors); attenduG.n++
    assert.ok(pret(await profil(vGratuit, mWeb.numero), mWeb), 'profil web hors des 24 : lisible'); attenduG.n++
    assert.equal(await profil(vGratuit, vGratuit.numero), null, 'sa propre fiche privee : null, sans compter')
    assert.equal(await compteur(vGratuit), attenduG.n)
    ok(`gratuit : lit « membres » dans ses 24 (${mesures.lectureDans} ms) et « web » hors des 24 ; hors des 24 : {vue: limitee}, la MEME reponse pour un numero inconnu, un profil prive et le numero 0 ; sans p_etat : null (contrat d avant) ; ${attenduG.n} lectures comptees, sa propre fiche non`)

    t = Date.now()
    assert.deepEqual(tri(await badges(vGratuit, [mDans.numero, mHors.numero, mWeb.numero, mPrive.numero, INCONNU])), tri([mDans.numero, mWeb.numero]))
    mesures.badges = Date.now() - t
    assert.equal(await compteur(vGratuit), attenduG.n, 'les badges ne comptent pas')
    // La regle de la photo : la requete de la route du journal, en role postgres.
    const ROUTE = `select public.aok_profil_visible($1::uuid, $2::uuid) as ok`
    const vu = async (l, c) => (await sql(ROUTE, l, c))[0].ok
    t = Date.now()
    assert.equal(await vu(vGratuit.id, mDans.id), true)
    mesures.photo = Date.now() - t
    assert.equal(await vu(vGratuit.id, mHors.id), false)
    assert.equal(await vu(vGratuit.id, mWeb.id), true)
    assert.equal(await vu(vGratuit.id, mPrive.id), false)
    assert.equal(await vu(vPayant.id, mHors.id), true)
    assert.equal(await vu(mHors.id, mHors.id), true)
    assert.deepEqual(json(await sql(`select public.aok_profil_visible(null, $1::uuid) as a, public.aok_profil_visible(null, $2::uuid) as b,
      public.aok_profil_visible($3::uuid, null) as c`, mDans.id, mWeb.id, vGratuit.id))[0], { a: false, b: true, c: false })
    assert.equal(await compteur(vGratuit), attenduG.n, 'la photo ne compte pas')
    ok(`badges du gratuit : ceux de ses 24 et du web, rien hors des 24 ni prive (${mesures.badges} ms) ; photo (requete de la route) : oui dans ses 24 et web, non hors des 24 et prive, oui pour le payant et pour soi (${mesures.photo} ms) ; ni badges ni photo ne comptent`)

    // --- 5. Le payant et l anonyme ---------------------------------------------------------
    let attenduP = 0
    for (const c of [mDans, mHors, mWeb]) { assert.ok(pret(await profil(vPayant, c.numero), c), `payant lit ${c.cle}`); attenduP++ }
    assert.equal(await profil(vPayant, mPrive.numero), null, 'prive : null, pas « limitee » pour un payant'); attenduP++
    assert.equal(await profil(vPayant, INCONNU), null); attenduP++
    assert.equal(await compteur(vPayant), attenduP)
    assert.deepEqual(tri(await badges(vPayant, [mDans.numero, mHors.numero, mWeb.numero, mPrive.numero])), tri([mDans.numero, mHors.numero, mWeb.numero]))
    ok(`payant (eleve) : lit les trois (dans les 24, hors des 24, web), prive et inconnu : null ; badges des trois ; ${attenduP} lectures comptees`)

    const lignesAvant = num((await sql(`select count(*) as n from public.aok_annuaire_appels`))[0].n)
    assert.ok(pret(await profil(null, mWeb.numero), mWeb), 'anonyme : web lisible')
    assert.equal(await profil(null, mDans.numero), null)
    assert.equal(await profil(null, mHors.numero), null)
    assert.ok(pret(await profil1(null, mWeb.numero), mWeb), 'anonyme, appel a un seul parametre (la fonction /api/membre du site)')
    assert.deepEqual(await badges(null, [mDans.numero, mHors.numero, mWeb.numero]), [mWeb.numero])
    assert.equal(num((await sql(`select count(*) as n from public.aok_annuaire_appels`))[0].n), lignesAvant, 'l anonyme ne compte pas')
    ok(`anonyme : le web seulement (appel a 1 ou 2 parametres), « membres » : null ; badges du web seulement ; aucune ligne de compteur`)

    // --- 6. L equipe : en tete des 24, lisible du gratuit -------------------------------------
    {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      await exec(`update public.profiles set role = 'admin' where id = $1::uuid`, mHors.id)
      const premier = num((await sql(`select p.client_number as n from public.aok_annuaire_gratuits() with ordinality as g(id, rang)
          join public.profiles p on p.id = g.id order by g.rang limit 1`))[0].n)
      assert.equal(premier, mHors.numero)
      assert.ok(pret(await profil(vGratuit, mHors.numero), mHors), 'profil « membres » de l equipe lisible du gratuit')
      await exec(`rollback to savepoint ${sp}`)
    }
    ok(`equipe : un profil « membres » de l equipe passe en tete des 24, le gratuit le lit`)

    // --- 7. Le plafond -------------------------------------------------------------------------
    {
      const sp = `sp${++n}`
      await exec(`savepoint ${sp}`)
      await exec(`update public.aok_annuaire_appels set n = 59 where user_id = $1::uuid and heure = date_trunc('hour', now())`, vGratuit.id)
      assert.ok(pret(await profil(vGratuit, mDans.numero), mDans), '60e lecture : passe')
      const coupe = await profil(vGratuit, mDans.numero)
      assert.equal(coupe.plafond, 'compte')
      assert.ok(coupe.reprise && !('numero' in coupe) && !('vue' in coupe))
      assert.equal(await profil(vGratuit, mDans.numero, false), null, 'sans p_etat : null')
      assert.deepEqual(Object.keys(await profil(vGratuit, INCONNU)).sort(), ['plafond', 'reprise'], 'inconnu : la meme reponse au plafond')
      assert.ok(pret(await profil(vGratuit, mWeb.numero), mWeb), 'un profil web se lit encore')
      assert.equal((await annuaire(vGratuit)).plafond, 'compte', 'le plafond est partage avec l annuaire')
      assert.equal(await compteur(vGratuit), 65)
      assert.ok(pret(await profil(vPayant, mHors.numero), mHors), 'un autre compte passe')
      await exec(`insert into public.aok_annuaire_appels (user_id, heure, n) values ($1::uuid, date_trunc('hour', now()), 5000)`, mPrive.id)
      assert.equal((await profil(vPayant, mHors.numero)).plafond, 'site')
      assert.ok(pret(await profil(vPayant, mWeb.numero), mWeb), 'web au plafond du site : se lit encore')
      // Le menage : une ligne de plus de deux jours part au premier appel d une heure.
      await exec(`insert into public.aok_annuaire_appels (user_id, heure, n) values ($1::uuid, date_trunc('hour', now()) - interval '3 days', 4)`, mDans.id)
      await profil(mWeb, mDans.numero)
      assert.equal(num((await sql(`select count(*) as n from public.aok_annuaire_appels where heure < now() - interval '2 days'`))[0].n), 0)
      await exec(`rollback to savepoint ${sp}`)
    }
    ok(`plafond : 60e lecture servie, 61e « plafond compte » sans profil (null sans p_etat, meme reponse pour un inconnu), un profil web se lit encore, l annuaire est coupe aussi (compteur partage), un autre compte passe ; 5 000 pour le site : « plafond site » ; lignes de plus de 2 jours effacees`)

    // --- 8. verifier:rls dans la transaction ------------------------------------------------------
    const auditApres = await auditer(tx)
    const nouvelles = auditApres.filter(a => !auditAvant.includes(a))
    assert.deepEqual(nouvelles, [], `alertes nouvelles : ${nouvelles.join(' | ')}`)
    ok(`controles de verifier:rls rejoues apres les trois migrations : ${auditApres.length} alerte(s), toutes deja la avant (${auditApres.join(' | ') || 'aucune'}), aucune nouvelle`)

    throw new Annulation()
  }, { timeout: 60000, maxWait: 10000 })
} catch (e) {
  if (!(e instanceof Annulation)) { console.error('ECHEC :', motif(e), '\n', String(e?.stack ?? e).split('\n').slice(0, 8).join('\n')); process.exitCode = 1 }
}
tRollback = Date.now()
console.log(`\nduree du begin au rollback : ${tRollback - tBegin} ms (dont les trois migrations : ${tMigrations} ms)`)

// --- Hors transaction : rien n est reste -------------------------------------------------
const apresHors = (await prisma.$queryRawUnsafe(ETAT))[0]
assert.deepEqual(json(apresHors), json(avantHors), 'etat de la base identique')
for (const sig of ['public.aok_profil_public(bigint, boolean)', 'public.aok_annuaire_gratuits()', 'public.aok_profil_visible(uuid, uuid)',
  'public.aok_annuaire(text, jsonb, integer)', 'public.aok_anciens_activer(uuid)']) assert.equal(await existe(sig), false, sig)
assert.equal(await existe('public.aok_profil_public(bigint)'), true)
const restes = num((await prisma.$queryRawUnsafe(`select count(*) as n from auth.users where email like 'essai-profils-%@exemple.invalid'`))[0].n)
assert.equal(restes, 0)
ok(`annule : aok_profil_public(bigint) intacte (source, volatilite, droits), aucune fonction ni table restee (lot 1 et annuaire compris), ${avantHors.comptes} comptes aux memes numeros, visibilites et roles, ${avantHors.publics} public, sequence intacte (last_value ${avantHors.seq}), aucun compte d essai`)
await prisma.$disconnect()
console.log(`\n${etapes} etapes, ${process.exitCode ? 'ECHEC' : 'tout est bon'}.`)
