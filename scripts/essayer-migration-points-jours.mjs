/**
 * ESSAI de la migration 20261109234000_aok_points_jours.sql (la table des
 * points par jour et aok_classement qui la lit, 09/11/2026) contre la vraie
 * base, dans UNE transaction TOUJOURS ANNULEE, en lecture repetable (toutes
 * les comparaisons voient la meme photo de la base, lock_timeout 5 s). Les
 * DEUX migrations sont jouees dans la transaction : 20261109233000 (la RPC
 * d avant, mesuree) puis 20261109234000. Ce qui est verifie :
 *   1. avant : aok_points_calcul de chaque compte (fonctions en production) ;
 *   2. la duree de l ancienne aok_classement (20261109233000) ;
 *   3. la migration, jouee DEUX fois (garde md5 avant et apres), puis
 *      20261109233000 rejouee apres elle : refusee par sa garde ;
 *   4. les gardes : fonctions, droits, RLS des trois tables (les controles de
 *      verifier:rls rejoues dans la transaction) ;
 *   5. aok_points_calcul IDENTIQUE pour chaque compte, avant et apres (detail
 *      ou non) : les regles partagees ne changent rien (et son temps) ;
 *   6. table vide : calcule_le null, seul l appelant classe ;
 *   7. premier passage (complet) : la table = aok_activite_par_jour de chaque
 *      compte, ligne pour ligne ;
 *   8. aok_classement = le calcul direct (aok_points_calcul par compte) : pages
 *      recousues, rang, ex aequo, valeur, prive = numero seul, equipe absente,
 *      paliers (une quinzaine d appelants), sur 7j, 30j et tout ;
 *   9. les durees : aller-retour de l appel seul et temps du serveur (explain
 *      analyze), plus les passages complet et incremental ;
 *  10. le PLAFOND des lecons (20 par jour) pose dans un point de sauvegarde
 *      annule : le classement suit le bareme sans recalcul de la table ;
 *  11. l appelant en direct : une lecon du jour compte tout de suite pour lui,
 *      les autres le voient au passage suivant ;
 *  12. l INCREMENTAL : un passage sans changement n ecrit rien, une lecon
 *      deplacee, une note mise a la corbeille, un oubli Telegram font
 *      recalculer leur compte et seulement les jours changes, la table reste
 *      = le calcul direct ; fenetre de 3 jours, filet hebdomadaire, complet a
 *      la demande.
 * Puis la transaction est annulee et on verifie hors transaction que rien
 * n est reste (fonctions, tables) et que les fonctions remplacees ont repris
 * leur empreinte de production. Aucun nom, email, uuid ni numero affiche.
 *
 * Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
 *   node --env-file=.env.local scripts/essayer-migration-points-jours.mjs
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const DOSSIER = 'sites/Aoknowledgecom/supabase/migrations'
const CLASSEMENT = '20261109233000_aok_classement.sql'
const MIGRATION = '20261109234000_aok_points_jours.sql'
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
const texteMigration = fichier(MIGRATION)
const ordresClassement = decouper(sansCommentaires(fichier(CLASSEMENT)))
const ordres = decouper(sansCommentaires(texteMigration))

// Le fichier lui-meme : aucun point-virgule dans un commentaire ni dans un texte de comment on.
for (const ligne of texteMigration.split('\n').filter(l => l.trim().startsWith('--'))) {
  assert.ok(!ligne.includes(';'), `point-virgule dans un commentaire : ${ligne.trim()}`)
}
for (const m of texteMigration.matchAll(/comment on [^']+'([^']*)'/g)) assert.ok(!m[1].includes(';'), m[1])
assert.ok(!/\u2014/.test(texteMigration), 'pas de tiret cadratin')

class Annulation extends Error {}
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const motif = e => String(e?.message ?? e).split('\n').find(l => /permission|denied|does not exist|exception|syntax|error|ERROR/i.test(l))?.trim().slice(0, 200) ?? 'refus'
const SIG = 'public.aok_classement(text, text, integer)'
const SIG_RAF = 'public.aok_points_jours_rafraichir(boolean, text)'
const AIDES = [
  'public.aok_points_bareme_tableau()', 'public.aok_points_du_jour(integer, integer, integer, integer[])',
  'public.aok_niveau_de(integer)', 'public.aok_telegram_du_compte(uuid)',
]
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const mediane = a => { const t = [...a].sort((x, y) => x - y); return t.length ? t[Math.floor(t.length / 2)] : 0 }
const MD5 = `select md5(pg_get_functiondef('public.aok_activite_par_jour(uuid, text)'::regprocedure)) as activite,
                    md5(pg_get_functiondef('public.aok_points_calcul(uuid, boolean)'::regprocedure)) as calcul`

const reste = async c => (await c.$queryRawUnsafe(`
  select to_regprocedure($1) is not null as classement, to_regprocedure($2) is not null as rafraichir,
         to_regclass('public.aok_points_jours') is not null as table_, to_regprocedure('public.aok_points_du_jour(integer, integer, integer, integer[])') is not null as aide`, SIG, SIG_RAF))[0]
const avantTout = await reste(prisma)
if (avantTout.classement || avantTout.rafraichir || avantTout.table_ || avantTout.aide) {
  throw new Error('aok_classement ou la table des points existe DEJA : cet essai est fait pour les migrations pas encore appliquees.')
}
const [md5Prod] = await prisma.$queryRawUnsafe(MD5)

// ---------------------------------------------------------------- Le calcul direct et la regle du labo (en JS)

function valeurDe(c, periode) {
  if (periode === 'tout') return Number(c?.points ?? 0)
  const n = periode === '7j' ? 7 : 30
  const auj = Date.UTC(Number(c.aujourdhui.slice(0, 4)), Number(c.aujourdhui.slice(5, 7)) - 1, Number(c.aujourdhui.slice(8, 10)))
  const borne = new Date(auj - n * 86400000).toISOString().slice(0, 10)
  return Object.entries(c?.jours ?? {}).filter(([j]) => j > borne).reduce((s, [, v]) => s + Number(v), 0)
}
function classerDirect(comptes, periode) {
  const avec = comptes.map(x => ({ ...x, valeur: valeurDe(x.c, periode) })).filter(x => x.valeur > 0)
  avec.sort((a, b) => b.valeur - a.valeur || a.numero - b.numero)
  return avec.map(x => ({ ...x, rang: 1 + avec.filter(y => y.valeur > x.valeur).length, exaequo: avec.filter(y => y.valeur === x.valeur).length > 1 }))
}
function palierLabo(lignes, id) {
  const moi = lignes.find(l => l.id === id)
  if (!moi) return null
  const n = lignes.length
  const b = { top10: Math.min(10, n), tiers1: Math.max(10, Math.ceil(n / 3)), tiers2: Math.max(10, Math.ceil((2 * n) / 3)), tiers3: n }
  const palier = moi.rang <= b.top10 ? 'top10' : moi.rang <= b.tiers1 ? 'tiers1' : moi.rang <= b.tiers2 ? 'tiers2' : 'tiers3'
  const ordre = ['tiers3', 'tiers2', 'tiers1', 'top10']
  let prochain = null
  for (let k = ordre.indexOf(palier) + 1; k < ordre.length; k++) {
    const vide = k < ordre.length - 1 && b[ordre[k]] <= b[ordre[k + 1]]
    if (!vide && b[ordre[k]] < moi.rang) { prochain = ordre[k]; break }
  }
  if (!prochain) return { palier, prochain: null }
  const autres = lignes.filter(l => l.id !== id)
  const cible = autres[Math.min(b[prochain], autres.length) - 1]?.valeur ?? moi.valeur
  return {
    palier, prochain,
    manque: Math.max(1, cible - moi.valeur),
    part: Math.max(6, Math.min(94, Math.round((100 * moi.valeur) / Math.max(cible, 1)))),
  }
}
const sansDetail = c => { const { detail, bareme, ...reste } = c; void detail; void bareme; return reste }

const CLES_PRIVE = ['exaequo', 'moi', 'numero', 'prive', 'rang', 'valeur']
const CLES_PUBLIC = ['exaequo', 'moi', 'niveau', 'nom', 'numero', 'photo', 'prive', 'rang', 'valeur']
const CLES_CLASSIQUE = ['calcule_le', 'equipe', 'lignes', 'moi', 'page', 'pages', 'periode', 'sans_valeur', 'taille', 'total', 'vue']
const CLES_PALIERS = ['calcule_le', 'equipe', 'moi', 'periode', 'reste', 'sans_valeur', 'top', 'total', 'vue']

const durees = { ancienne: [], nouvelle: [], serveur: [], autres: [] }

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '120s'`)
    let n = 0
    async function comme(role, id, sql, ...params) {
      const sp = `sp${++n}`
      await tx.$executeRawUnsafe(`savepoint ${sp}`)
      try {
        const claims = JSON.stringify(id ? { sub: id, role, aud: 'authenticated' } : { role })
        await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, claims)
        await tx.$executeRawUnsafe(`select set_config('request.jwt.claim.sub', $1, true)`, id ?? '')
        await tx.$executeRawUnsafe(`set local role ${role}`)
        const t0 = performance.now()
        const lignes = await tx.$queryRawUnsafe(sql, ...params)
        return { ok: true, lignes, ms: Math.round(performance.now() - t0) }
      } catch (e) {
        return { ok: false, motif: motif(e) }
      } finally {
        await tx.$executeRawUnsafe(`rollback to savepoint ${sp}`)
      }
    }
    const classement = async (id, periode, vue, page = 1, cle = 'nouvelle') => {
      const r = await comme('authenticated', id, `select public.aok_classement($1::text, $2::text, $3::integer) as r`, periode, vue, page)
      assert.ok(r.ok, `appel refuse : ${r.motif}`)
      durees[cle].push(r.ms)
      return r.lignes[0].r
    }
    const serveur = async (id, periode, vue) => {
      const r = await comme('authenticated', id, `explain (analyze, format json) select public.aok_classement($1::text, $2::text, 1)`, periode, vue)
      assert.ok(r.ok, `explain refuse : ${r.motif}`)
      const t = Number(r.lignes[0]['QUERY PLAN'][0]['Execution Time'])
      durees.serveur.push(t)
      return t
    }
    /** Temps serveur de aok_points_calcul(compte, true) (Mon espace), mediane de 3. */
    const tempsCalcul = async (id) => {
      const t = []
      for (let i = 0; i < 3; i++) {
        const r = await tx.$queryRawUnsafe(`explain (analyze, format json) select public.aok_points_calcul($1::uuid, true)`, id)
        t.push(Number(r[0]['QUERY PLAN'][0]['Execution Time']))
      }
      return mediane(t)
    }
    const passage = async (complet = false, par = 'essai') => {
      const t0 = performance.now()
      const [r] = await tx.$queryRawUnsafe(`select public.aok_points_jours_rafraichir($1::boolean, $2::text) as r`, complet, par)
      return { ...r.r, ms: Math.round(performance.now() - t0) }
    }
    /** La table = aok_activite_par_jour de chaque compte, ligne pour ligne (manquants, en trop). */
    const ecartTable = async () => {
      const [e] = await tx.$queryRawUnsafe(`
        with d as materialized (
          select p.id as user_id, a.jour, a.lecons, a.notes, a.messages
            from public.profiles p
            cross join lateral public.aok_activite_par_jour(p.id, coalesce(p.fuseau, 'Europe/Paris')) a
        ), t as (
          select user_id, jour, lecons, notes, messages from public.aok_points_jours
        )
        select (select count(*) from (select * from d except select * from t) x)::int as manquants,
               (select count(*) from (select * from t except select * from d) y)::int as en_trop,
               (select count(*) from t)::int as lignes`)
      return e
    }
    const calculs = async (detail) => {
      const l = await tx.$queryRawUnsafe(`
        select p.id::text as id, p.client_number::bigint as numero, coalesce(p.profil_public, false) as public,
               public.aok_est_equipe(p.id) as equipe, public.aok_points_calcul(p.id, $1::boolean) as c
          from public.profiles p order by p.id`, detail)
      for (const x of l) x.numero = Number(x.numero)
      return l
    }
    const recalcules = async () => new Set((await tx.$queryRawUnsafe(`
      select c.user_id::text as id from public.aok_points_jours_comptes c
       where c.calcule_le = (select max(debut) from public.aok_points_jours_passages)`)).map(x => x.id))

    // 1. Avant : chaque compte par les fonctions de production.
    const avant = await calculs(true)
    const equipe = avant.filter(x => x.equipe)
    const comptes = avant.filter(x => !x.equipe).map(x => ({ ...x, c: sansDetail(x.c) }))
    const directs = { '7j': classerDirect(comptes, '7j'), '30j': classerDirect(comptes, '30j'), tout: classerDirect(comptes, 'tout') }
    ok(`avant : ${avant.length} comptes dont ${equipe.length} de l equipe, ${comptes.filter(x => x.public).length} profil(s) public(s) ; classes : 7j ${directs['7j'].length}, 30j ${directs['30j'].length}, tout ${directs.tout.length}`)
    const ref = directs['7j'].length ? directs['7j'] : directs.tout
    const appelant = ref[Math.floor(ref.length / 2)]
    assert.ok(appelant, 'un compte classe')
    const calculAvant = await tempsCalcul(appelant.id)

    // 2. L ancienne RPC (20261109233000), mesuree.
    for (const o of ordresClassement) await tx.$executeRawUnsafe(o)
    for (let i = 0; i < 3; i++) await classement(appelant.id, ['7j', '30j', 'tout'][i], 'classique', 1, 'ancienne')
    ok(`ancienne aok_classement (aok_points_calcul par compte) : mediane ${mediane(durees.ancienne)} ms sur ${durees.ancienne.length} appels`)

    // 3. La migration, deux fois.
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const [md5Apres] = await tx.$queryRawUnsafe(MD5)
    console.log(`    md5 apres : aok_activite_par_jour ${md5Apres.activite}, aok_points_calcul ${md5Apres.calcul}`)
    try {
      for (const o of ordres) await tx.$executeRawUnsafe(o)
    } catch (e) {
      throw new Error(`seconde application refusee (poser les md5 apres dans la garde ?) : ${motif(e)}`)
    }
    ok(`migration jouee deux fois (${ordres.length} ordres), garde md5 : avant ${md5Prod.activite.slice(0, 8)}/${md5Prod.calcul.slice(0, 8)}, apres ${md5Apres.activite.slice(0, 8)}/${md5Apres.calcul.slice(0, 8)}`)
    await tx.$executeRawUnsafe(`savepoint rejeu`)
    let rejeu = null
    try { for (const o of ordresClassement) await tx.$executeRawUnsafe(o) } catch (e) { rejeu = motif(e) }
    await tx.$executeRawUnsafe(`rollback to savepoint rejeu`)
    assert.ok(rejeu && /deja appliquee/.test(rejeu), `20261109233000 rejouee apres : refusee (${rejeu})`)
    ok('20261109233000 rejouee apres 20261109234000 : refusee par sa garde (la version lente ne revient pas)')

    // 4. Les gardes.
    const fonctions = await tx.$queryRawUnsafe(`
      select p.oid::regprocedure::text as sig, p.prosecdef as definer, coalesce(array_to_string(p.proconfig, ','), '') as config,
             p.provolatile as vol,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as auth,
             has_function_privilege('service_role', p.oid, 'execute') as service,
             exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_
        from pg_proc p where p.oid = any(array[to_regprocedure($1), to_regprocedure($2), to_regprocedure($3), to_regprocedure($4), to_regprocedure($5), to_regprocedure($6),
                                               to_regprocedure('public.aok_activite_par_jour(uuid, text)'), to_regprocedure('public.aok_points_calcul(uuid, boolean)')])`,
      SIG, SIG_RAF, ...AIDES)
    assert.equal(fonctions.length, 8)
    for (const f of fonctions) {
      assert.ok(/search_path=("")?$/.test(f.config) || f.config === 'search_path=""', `${f.sig} : search_path vide (${f.config})`)
      assert.equal(f.anon, false, `${f.sig} : anon`)
      assert.equal(f.public_, false, `${f.sig} : public`)
      if (f.sig.startsWith('aok_classement')) {
        assert.equal(f.definer, true); assert.equal(f.auth, true); assert.equal(f.vol, 's')
      } else {
        assert.equal(f.auth, false, `${f.sig} : authenticated`)
        assert.equal(f.service, false, `${f.sig} : service_role`)
      }
      if (/rafraichir|telegram|activite|calcul/.test(f.sig)) assert.equal(f.definer, true, `${f.sig} : security definer`)
    }
    const refusFonction = /permission denied for function/
    const anon = await comme('anon', null, `select public.aok_classement('7j', 'classique', 1) as r`)
    assert.ok(!anon.ok && refusFonction.test(anon.motif), `anon refuse (${anon.motif})`)
    const sansCompte = await comme('authenticated', null, `select public.aok_classement('7j', 'classique', 1) as r`)
    assert.ok(sansCompte.ok && sansCompte.lignes[0].r === null, 'jeton sans compte : null')
    const rafAuth = await comme('authenticated', appelant.id, `select public.aok_points_jours_rafraichir(true, 'x') as r`)
    assert.ok(!rafAuth.ok && refusFonction.test(rafAuth.motif), `un membre ne lance pas le rafraichissement (${rafAuth.motif})`)
    const rafService = await comme('service_role', null, `select public.aok_points_jours_rafraichir(true, 'x') as r`)
    assert.ok(!rafService.ok && refusFonction.test(rafService.motif), `service_role non plus (${rafService.motif})`)
    const regleAuth = await comme('authenticated', appelant.id, `select public.aok_points_du_jour(1, 1, 1, array[1, 10, 2, 1]) as r`)
    assert.ok(!regleAuth.ok && refusFonction.test(regleAuth.motif), `les regles fermees aux membres (${regleAuth.motif})`)
    // Les controles de verifier:rls, rejoues dans la transaction sur les trois tables.
    const tables = await tx.$queryRawUnsafe(`
      select c.relname as t, c.relrowsecurity as rls,
             has_table_privilege('anon', c.oid, 'select') as anon, has_table_privilege('authenticated', c.oid, 'select') as auth,
             has_table_privilege('authenticated', c.oid, 'insert') as auth_ins,
             (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)::int as policies
        from pg_class c where c.oid = any(array[to_regclass('public.aok_points_jours'), to_regclass('public.aok_points_jours_comptes'), to_regclass('public.aok_points_jours_passages')])`)
    assert.equal(tables.length, 3)
    for (const t of tables) {
      assert.equal(t.rls, true, `${t.t} : RLS`)
      assert.equal(t.anon || t.auth || t.auth_ins, false, `${t.t} : rien pour anon ni authenticated`)
      assert.equal(t.policies, 0, `${t.t} : aucune policy`)
    }
    const [sansRls] = await tx.$queryRawUnsafe(`
      select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
       where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)
    const lectureMembre = await comme('authenticated', appelant.id, `select count(*)::int as n from public.aok_points_jours`)
    assert.ok(!lectureMembre.ok && /permission denied for table/.test(lectureMembre.motif), `un membre ne lit pas la table (${lectureMembre.motif})`)
    ok(`gardes : 8 fonctions search_path vide, aok_classement authenticated seulement (anon refuse : ${anon.motif}), rafraichir refusee a authenticated et service_role, `
      + `regles fermees ; 3 tables RLS sans policy ni droit pour anon/authenticated (lecture d un membre refusee), ${sansRls.n} table(s) sans RLS dans le schema (alerte de verifier:rls si > 0)`)

    // 5. aok_points_calcul identique, avant et apres, pour chaque compte.
    const apresDetail = await calculs(true)
    const apresSimple = await calculs(false)
    assert.equal(apresDetail.length, avant.length)
    apresDetail.forEach((x, i) => {
      assert.equal(x.id, avant[i].id)
      assert.deepEqual(x.c, avant[i].c, 'aok_points_calcul(detail) identique')
      assert.deepEqual(apresSimple[i].c, sansDetail(avant[i].c), 'aok_points_calcul identique')
    })
    const calculApres = await tempsCalcul(appelant.id)
    ok(`aok_points_calcul identique avant et apres pour les ${avant.length} comptes (avec et sans detail) ; Mon espace (un compte, serveur) ${calculAvant.toFixed(1)} ms -> ${calculApres.toFixed(1)} ms`)

    // 6. Table vide (avant le premier passage).
    const vide = await classement(appelant.id, 'tout', 'classique', 1, 'autres')
    assert.equal(vide.calcule_le, null)
    assert.equal(vide.total, 1, 'seul l appelant est classe')
    assert.equal(vide.lignes[0].moi, true)
    ok('table jamais remplie : calcule_le null, seul l appelant est classe')

    // 7. Premier passage.
    const p1 = await passage(false, 'essai')
    assert.equal(p1.fait, true)
    assert.equal(p1.complet, true)
    assert.equal(p1.raison, 'premier')
    assert.equal(p1.comptes, avant.length)
    assert.equal(p1.recalcules, avant.length)
    assert.equal(p1.jours_retires, 0)
    const e1 = await ecartTable()
    assert.deepEqual([e1.manquants, e1.en_trop], [0, 0], 'table = aok_activite_par_jour')
    assert.equal(p1.jours_ecrits, e1.lignes)
    ok(`premier passage (complet, raison premier) : ${p1.recalcules} comptes, ${p1.jours_ecrits} jours ecrits en ${p1.ms} ms (serveur ${p1.duree_ms} ms) ; table = aok_activite_par_jour ligne pour ligne`)

    // 8. Le classement = le calcul direct.
    const idsEquipe = new Set(equipe.map(x => x.numero))
    for (const periode of ['7j', '30j', 'tout']) {
      const d = directs[periode]
      const p1c = await classement(appelant.id, periode, 'classique', 1)
      const brut = JSON.stringify(p1c)
      assert.ok(!UUID.test(brut), 'aucun uuid')
      assert.ok(!/email|@/.test(brut), 'aucun email')
      assert.deepEqual(Object.keys(p1c).sort(), CLES_CLASSIQUE)
      assert.ok(p1c.calcule_le, 'calcule_le pose')
      assert.equal(p1c.total, d.length, `${periode} : total = calcul direct`)
      assert.equal(p1c.equipe, equipe.length)
      assert.equal(p1c.sans_valeur, comptes.length - d.length, `${periode} : sans_valeur`)
      assert.equal(p1c.taille, 20)
      assert.equal(p1c.pages, Math.max(1, Math.ceil(d.length / 20)))
      const toutes = [...p1c.lignes]
      for (let pg = 2; pg <= p1c.pages; pg++) toutes.push(...(await classement(appelant.id, periode, 'classique', pg)).lignes)
      assert.equal(toutes.length, d.length, `${periode} : pages recousues`)
      toutes.forEach((l, i) => {
        assert.equal(l.numero, d[i].numero, `${periode} : ordre ligne ${i + 1}`)
        assert.equal(l.valeur, d[i].valeur, `${periode} : valeur ligne ${i + 1}`)
        assert.equal(l.rang, d[i].rang)
        assert.equal(l.exaequo, d[i].exaequo)
        assert.ok(!idsEquipe.has(l.numero), 'pas d equipe dans les lignes')
        const moi = d[i].id === appelant.id
        assert.equal(l.moi, moi)
        if (d[i].public || moi) {
          assert.deepEqual(Object.keys(l).sort(), CLES_PUBLIC)
          assert.equal(l.niveau, Number(d[i].c.niveau), 'niveau = calcul direct')
        } else assert.deepEqual(Object.keys(l).sort(), CLES_PRIVE, 'profil prive : le numero seul')
      })
      assert.equal((await classement(appelant.id, periode, 'classique', 999)).page, p1c.pages, 'page 999 ramenee a la derniere')
      assert.equal((await classement(appelant.id, periode, 'classique', 0)).page, 1, 'page 0 ramenee a 1')
      assert.equal((await classement(appelant.id, periode, 'bizarre', null)).vue, 'classique', 'vue inconnue = classique')
      const moiD = d.find(x => x.id === appelant.id)
      assert.equal(p1c.moi.classe, Boolean(moiD))
      assert.equal(p1c.moi.equipe, false)
      if (moiD) {
        assert.equal(p1c.moi.ligne.rang, moiD.rang)
        assert.ok(p1c.moi.ligne.nom != null, 'sa propre ligne porte son nom, meme profil prive')
      }
      assert.equal(p1c.moi.progression.points, Number(appelant.c.points))
      assert.equal(p1c.moi.progression.niveau, Number(appelant.c.niveau))
      assert.equal(p1c.moi.progression.manque, appelant.c.manque)
      assert.equal(p1c.moi.progression.progres, appelant.c.progres)

      const pa = await classement(appelant.id, periode, 'paliers')
      assert.deepEqual(Object.keys(pa).sort(), CLES_PALIERS)
      assert.ok(pa.top.every(l => l.rang <= 10), 'top 10 seulement')
      assert.equal(pa.top.length, d.filter(x => x.rang <= 10).length, 'top 10 ex aequo compris')
      assert.equal(pa.reste, d.length - pa.top.length)
      if (moiD) {
        assert.equal(pa.moi.dans_top, moiD.rang <= 10)
        assert.equal(pa.moi.rang ?? null, moiD.rang <= 10 ? moiD.rang : null, 'rang seulement dans le top 10')
        assert.ok(!('ligne' in pa.moi), 'pas de ligne hors classique')
        const attendu = palierLabo(d, appelant.id)
        assert.equal(pa.moi.palier, attendu.palier)
        assert.equal(pa.moi.prochain, attendu.prochain)
        if (attendu.prochain) { assert.equal(pa.moi.manque, attendu.manque); assert.equal(pa.moi.part, attendu.part) }
      }
      for (const vue of ['classique', 'paliers']) await serveur(appelant.id, periode, vue)
      ok(`${periode} : ${d.length} classe(s) sur ${p1c.pages} page(s), recousues = calcul direct (rang, ex aequo, valeur, niveau), prive = numero seul, `
        + `equipe absente, pages bornees, paliers top ${pa.top.length} + reste ${pa.reste}, appelant ${moiD ? (moiD.rang <= 10 ? 'dans le top 10' : `palier ${pa.moi.palier}`) : 'pas classe'}`)
    }
    if (equipe.length) {
      const r = await classement(equipe[0].id, '7j', 'classique')
      assert.equal(r.moi.equipe, true)
      assert.equal(r.moi.classe, false)
      assert.ok(!r.lignes.some(l => l.moi), 'aucune ligne a lui')
      ok('un compte de l equipe : moi.equipe = true, hors classement')
    }
    let compares = 0
    for (const periode of ['7j', 'tout']) {
      const d = directs[periode]
      const pas = Math.max(1, Math.floor(d.length / 8))
      for (let i = 0; i < d.length; i += pas) {
        const r = await classement(d[i].id, periode, 'paliers')
        const attendu = palierLabo(d, d[i].id)
        assert.equal(r.moi.palier, attendu.palier, `${periode} n ${i + 1}`)
        assert.equal(r.moi.prochain, attendu.prochain, `${periode} n ${i + 1}`)
        if (attendu.prochain) { assert.equal(r.moi.manque, attendu.manque); assert.equal(r.moi.part, attendu.part) }
        compares++
      }
    }
    ok(`paliers : ${compares} appelants repartis, palier, prochain, manque et part = la regle du labo sur le calcul direct`)

    // 9. Les durees.
    ok(`DUREES aok_classement : avant ${mediane(durees.ancienne)} ms (mediane, ${durees.ancienne.length} appels) ; `
      + `apres ${mediane(durees.nouvelle)} ms aller-retour (mediane, max ${Math.max(...durees.nouvelle)} ms, ${durees.nouvelle.length} appels), `
      + `serveur ${mediane(durees.serveur).toFixed(1)} ms (mediane, max ${Math.max(...durees.serveur).toFixed(1)} ms, explain analyze, ${durees.serveur.length} appels)`)
    assert.ok(mediane(durees.nouvelle) < 300, 'moins de 300 ms par appel')

    // 10. Le plafond des lecons, sans recalcul de la table.
    await tx.$executeRawUnsafe(`savepoint plafond`)
    await tx.$executeRawUnsafe(`update public.aok_points_bareme set plafond_jour = 20 where source = 'lecon_terminee'`)
    const plafonne = (await calculs(false)).filter(x => !x.equipe)
    for (const periode of ['7j', 'tout']) {
      const d = classerDirect(plafonne, periode)
      const r = await classement(appelant.id, periode, 'classique')
      const toutes = [...r.lignes]
      for (let pg = 2; pg <= r.pages; pg++) toutes.push(...(await classement(appelant.id, periode, 'classique', pg)).lignes)
      assert.deepEqual(toutes.map(l => [l.numero, l.valeur, l.rang]), d.map(x => [x.numero, x.valeur, x.rang]), `plafond ${periode} = calcul direct`)
      console.log(`    plafond 20 lecons/jour, ${periode} : top 3 ${directs[periode].slice(0, 3).map(x => x.valeur).join('/')} -> ${d.slice(0, 3).map(x => x.valeur).join('/')}, `
        + `${plafonne.filter(x => valeurDe(x.c, periode) < valeurDe(comptes.find(y => y.id === x.id).c, periode)).length} compte(s) touches`)
    }
    const [{ n: lignesTable }] = await tx.$queryRawUnsafe(`select count(*)::int as n from public.aok_points_jours where maj_le > (select max(debut) from public.aok_points_jours_passages)`)
    assert.equal(lignesTable, 0, 'la table n a pas bouge')
    await tx.$executeRawUnsafe(`rollback to savepoint plafond`)
    ok('plafond 20 lecons/jour (point de sauvegarde annule) : classement 7j et tout = calcul direct plafonne, sans toucher la table')

    // 11. L appelant en direct, les autres au passage suivant.
    const [lecon] = await tx.$queryRawUnsafe(`
      select g.user_id::text as id, g.lecon_id::text as lecon from public.academie_progression g
       where g.terminee_le is not null and g.terminee_le < now() - interval '8 days'
         and not public.aok_est_equipe(g.user_id)
       order by g.terminee_le limit 1`)
    if (lecon) {
      await tx.$executeRawUnsafe(`savepoint direct`)
      const autre = directs.tout.find(x => x.id !== lecon.id)
      await tx.$executeRawUnsafe(`update public.academie_progression set terminee_le = clock_timestamp(), dernier_signal_le = clock_timestamp()
        where user_id = $1::uuid and lecon_id = $2::uuid`, lecon.id, lecon.lecon)
      const [lui] = await tx.$queryRawUnsafe(`select public.aok_points_calcul($1::uuid, false) as c`, lecon.id)
      const vuParLui = await classement(lecon.id, '7j', 'classique')
      const sienne = vuParLui.moi.ligne
      assert.ok(sienne, 'il est classe sur 7 jours')
      assert.equal(sienne.valeur, valeurDe(lui.c, '7j'), 'sa valeur du jour, en direct')
      const vuParAutre = await classement(autre.id, '7j', 'classique')
      const toutes = [...vuParAutre.lignes]
      for (let pg = 2; pg <= vuParAutre.pages; pg++) toutes.push(...(await classement(autre.id, '7j', 'classique', pg)).lignes)
      const chezAutre = toutes.find(l => l.numero === sienne.numero)
      const avant7 = valeurDe(comptes.find(x => x.id === lecon.id).c, '7j')
      assert.equal(chezAutre?.valeur ?? 0, avant7, 'les autres voient sa valeur du dernier passage')
      await tx.$executeRawUnsafe(`rollback to savepoint direct`)
      ok(`appelant en direct : une lecon terminee a l instant compte tout de suite pour lui (7j ${avant7} -> ${sienne.valeur}), les autres voient ${chezAutre?.valeur ?? 0} jusqu au passage suivant`)
    }

    // 12. L incremental.
    const p2 = await passage()
    assert.equal(p2.complet, false)
    assert.equal(p2.raison, 'incremental')
    assert.equal(p2.jours_ecrits, 0, 'rien n a change : rien d ecrit')
    assert.equal(p2.jours_retires, 0)
    ok(`passage incremental sans changement : ${p2.recalcules} compte(s) touches dans la derniere heure recalcules, 0 jour ecrit, ${p2.ms} ms (serveur ${p2.duree_ms} ms)`)

    const changes = []
    if (lecon) {
      await tx.$executeRawUnsafe(`update public.academie_progression set terminee_le = clock_timestamp(), dernier_signal_le = clock_timestamp()
        where user_id = $1::uuid and lecon_id = $2::uuid`, lecon.id, lecon.lecon)
      changes.push(['une lecon terminee il y a plus de 8 jours, deplacee a aujourd hui', lecon.id])
    }
    const [note] = await tx.$queryRawUnsafe(`
      select n.id, n."userId" as id_compte from public."Note" n join public.profiles p on p.id::text = n."userId"
       where n."deletedAt" is null and n."createdAt" < now() - interval '10 days' order by n."createdAt" limit 1`)
    if (note) {
      await tx.$executeRawUnsafe(`update public."Note" set "deletedAt" = clock_timestamp() where id = $1`, note.id)
      changes.push(['une note mise a la corbeille', note.id_compte])
    }
    const [tg] = await tx.$queryRawUnsafe(`
      select x.id::text as id, m.telegram_id::text as tg_id
        from (select p.id, public.aok_telegram_du_compte(p.id) as tg from public.profiles p) x
        cross join lateral (select t.telegram_id from public.cockpit_telegram_messages t where t.telegram_id = any(x.tg) limit 1) m
       order by x.id limit 1`)
    if (tg) {
      await tx.$executeRawUnsafe(`insert into public.cockpit_telegram_oublis (telegram_id, note) values ($1::bigint, 'essai annule')`, tg.tg_id)
      changes.push(['un oubli Telegram (niveau 1)', tg.id])
    }
    const [{ m: messagesAvant }] = tg ? await tx.$queryRawUnsafe(`select coalesce(sum(messages), 0)::int as m from public.aok_points_jours where user_id = $1::uuid`, tg.id) : [{ m: 0 }]
    const p3 = await passage()
    const r3 = await recalcules()
    for (const [quoi, id] of changes) assert.ok(r3.has(id), `compte recalcule apres ${quoi}`)
    assert.ok(p3.jours_ecrits + p3.jours_retires >= changes.length, 'des jours ont change')
    assert.ok(p3.recalcules < p3.comptes, 'pas tout le monde')
    const e3 = await ecartTable()
    assert.deepEqual([e3.manquants, e3.en_trop], [0, 0], 'table = calcul direct apres les changements')
    if (tg) {
      const [{ m: messagesApres }] = await tx.$queryRawUnsafe(`select coalesce(sum(messages), 0)::int as m from public.aok_points_jours where user_id = $1::uuid`, tg.id)
      assert.ok(messagesApres < messagesAvant, 'l oubli retire des messages')
    }
    ok(`incremental apres ${changes.map(c => c[0]).join(', ')} : ${p3.recalcules} compte(s) recalcules sur ${p3.comptes} (dont les ${changes.length} touches), `
      + `${p3.jours_ecrits} jour(s) ecrits, ${p3.jours_retires} retire(s), ${p3.ms} ms ; table = calcul direct`)

    await tx.$executeRawUnsafe(`update public.aok_points_jours_passages set debut = debut - interval '3 days'`)
    const p4 = await passage()
    assert.equal(p4.complet, false)
    assert.equal(p4.jours_ecrits + p4.jours_retires, 0, 'rien a ecrire : la table etait a jour')
    ok(`fenetre de 3 jours : ${p4.recalcules} compte(s) touches recalcules, 0 jour ecrit (la table etait a jour), ${p4.ms} ms (serveur ${p4.duree_ms} ms)`)

    await tx.$executeRawUnsafe(`update public.aok_points_jours_passages set debut = debut - interval '8 days'`)
    const p5 = await passage()
    assert.equal(p5.complet, true)
    assert.equal(p5.raison, 'hebdomadaire')
    assert.equal(p5.recalcules, avant.length)
    assert.equal(p5.jours_ecrits + p5.jours_retires, 0)
    const p6 = await passage(true, 'manuel')
    assert.equal(p6.raison, 'demande')
    assert.equal(p6.recalcules, avant.length)
    const [{ n: nbPassages }] = await tx.$queryRawUnsafe(`select count(*)::int as n from public.aok_points_jours_passages`)
    ok(`filet hebdomadaire (dernier complet il y a 8 jours) : complet, ${p5.recalcules} comptes, 0 jour ecrit, ${p5.ms} ms ; complet a la demande : raison demande, ${p6.ms} ms ; ${nbPassages} passages traces`)

    throw new Annulation()
  }, { timeout: 900000, maxWait: 20000, isolationLevel: 'RepeatableRead' })
} catch (e) {
  if (!(e instanceof Annulation)) {
    console.error(`ECHEC apres ${etapes} etape(s) : ${String(e?.message ?? e).slice(0, 900)}`)
    process.exitCode = 1
  }
} finally {
  const r = await reste(prisma)
  const [md5Fin] = await prisma.$queryRawUnsafe(MD5)
  const intact = md5Fin.activite === md5Prod.activite && md5Fin.calcul === md5Prod.calcul
  const restes = Object.entries(r).filter(([, v]) => v).map(([k]) => k)
  console.log(restes.length || !intact
    ? `!! RESTE EN BASE : ${restes.join(', ')}${intact ? '' : ' (fonctions de production modifiees)'}`
    : `transaction annulee : ni aok_classement, ni table des points, ni regles partagees en base ; aok_activite_par_jour et aok_points_calcul a leur empreinte de production (${etapes} etapes ok)`)
  if (restes.length || !intact) process.exitCode = 1
  await prisma.$disconnect()
}
