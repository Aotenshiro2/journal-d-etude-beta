/**
 * ESSAI de la migration 20261109234100_aok_classement_gratuits.sql (la regle
 * des comptes gratuits dans aok_classement, 10/11/2026) contre la vraie base.
 * Rien n est jamais valide : deux transactions, TOUJOURS annulees.
 *
 * Phase A (legere, aucune table touchee, lock_timeout 5 s) : les fonctions
 * seules. aok_classement de 20261109234000 puis celle de ce fichier, creees
 * pour lire leurs empreintes md5 (celles de la garde du fichier), puis
 * aok_a_un_programme comparee pour CHAQUE compte a aok_annuaire_acces de la
 * branche anciens-membres (lue dans son fichier, creee dans la transaction
 * annulee) : statut autre que communaute = a un programme.
 *   --empreintes : la phase A seule (pour poser les md5 dans la garde).
 *
 * Phase B (l essai complet, UNE fois, lock_timeout 5 s, chronometre du begin
 * au rollback, moins de 10 s vise) : 20261109233000, 20261109234000, ce
 * fichier (joue deux fois), 20261109234000 rejouee apres : refusee. Premier
 * remplissage de la table des points. Quelques profils rendus publics dans la
 * transaction (web, membres, prives). Puis aok_classement vue par un compte
 * GRATUIT, un compte AVEC programme et un compte de l equipe :
 *   - gratuit : nom, photo et niveau des seuls profils web, les autres (membres
 *     compris) rendus comme un prive, restreint = true, sa ligne a son nom ;
 *   - avec programme : web et membres nommes, prives sous leur numero ;
 *   - meme ordre, memes rangs, memes valeurs, meme total pour tous ;
 *   - paliers : le top 10 suit la meme regle ;
 *   - aucun uuid ni email, droits (anon refuse, la regle interne fermee).
 * Hors transaction ensuite : rien n est reste, aucun profil public de plus.
 * Aucun nom, email, uuid ni numero affiche.
 *
 * Lancement (depuis apps/journal-d-etude, ou son worktree) :
 *   AOK_WORKSPACE=<racine du workspace> [AOK_ANNUAIRE=<worktree anciens-membres>] \
 *     node --env-file=.env --env-file=.env.local scripts/essayer-migration-classement-gratuits.mjs [--empreintes]
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const DOSSIER = 'sites/Aoknowledgecom/supabase/migrations'
const CLASSEMENT = '20261109233000_aok_classement.sql'
const POINTS = '20261109234000_aok_points_jours.sql'
const MIGRATION = '20261109234100_aok_classement_gratuits.sql'
const ANNUAIRE = '20261109235500_aok_annuaire.sql'
const SEULEMENT_EMPREINTES = process.argv.includes('--empreintes')

function chemin(racine, nom) {
  const candidats = [
    racine ? new URL(`file://${racine.replace(/\/$/, '')}/${DOSSIER}/${nom}`) : null,
    new URL(`../../../${DOSSIER}/${nom}`, import.meta.url),
  ].filter(Boolean)
  return candidats.find(x => existsSync(x)) ?? null
}
function fichier(nom) {
  const u = chemin(process.env.AOK_WORKSPACE, nom)
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
const ordresPoints = decouper(sansCommentaires(fichier(POINTS)))
const ordres = decouper(sansCommentaires(texteMigration))
const creation = (liste, nom) => {
  const o = liste.find(x => x.toLowerCase().startsWith(`create or replace function public.${nom}(`))
  assert.ok(o, `${nom} introuvable dans le fichier`)
  return o
}

// Le fichier lui-meme : aucun point-virgule dans un commentaire ni dans un texte de comment on, pas de tiret cadratin.
for (const ligne of texteMigration.split('\n').filter(l => l.trim().startsWith('--'))) {
  assert.ok(!ligne.includes(';'), `point-virgule dans un commentaire : ${ligne.trim()}`)
}
for (const m of texteMigration.matchAll(/comment on [^']+'([^']*)'/g)) assert.ok(!m[1].includes(';'), m[1])
assert.ok(!/\u2014/.test(texteMigration), 'pas de tiret cadratin')
const garde = /v_md5 not in \('([^']+)', '([^']+)'\)/.exec(texteMigration)
assert.ok(garde, 'garde md5 du fichier')
const [, md5Garde234000, md5GardeGratuits] = garde

// La fonction de l annuaire (branche anciens-membres), lue dans son fichier, jamais appliquee.
const racineAnnuaire = process.env.AOK_ANNUAIRE ?? `${process.env.HOME}/Projects/_worktrees/anciens-membres`
const uAnnuaire = chemin(racineAnnuaire, ANNUAIRE)
const ordreAnnuaire = uAnnuaire ? creation(decouper(sansCommentaires(readFileSync(uAnnuaire, 'utf8'))), 'aok_annuaire_acces') : null

class Annulation extends Error {}
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const motif = e => String(e?.message ?? e).split('\n').find(l => /permission|denied|does not exist|exception|syntax|error|ERROR|deja|Refus/i.test(l))?.trim().slice(0, 220) ?? 'refus'
const SIG = 'public.aok_classement(text, text, integer)'
const SIG_PROG = 'public.aok_a_un_programme(uuid)'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const mediane = a => { const t = [...a].sort((x, y) => x - y); return t.length ? t[Math.floor(t.length / 2)] : 0 }
const MD5_PROD = `select md5(pg_get_functiondef('public.aok_activite_par_jour(uuid, text)'::regprocedure)) as activite,
                         md5(pg_get_functiondef('public.aok_points_calcul(uuid, boolean)'::regprocedure)) as calcul`
const MD5_CLASSEMENT = `select md5(pg_get_functiondef('${SIG}'::regprocedure)) as m`

const reste = async c => (await c.$queryRawUnsafe(`
  select to_regprocedure($1) is not null as classement, to_regprocedure($2) is not null as programme,
         to_regclass('public.aok_points_jours') is not null as table_, to_regprocedure('public.aok_annuaire_acces(uuid)') is not null as annuaire`, SIG, SIG_PROG))[0]
const avantTout = await reste(prisma)
if (avantTout.classement || avantTout.programme || avantTout.table_) {
  throw new Error('aok_classement, aok_a_un_programme ou la table des points existe DEJA : cet essai est fait pour les migrations pas encore appliquees.')
}
const [md5Prod] = await prisma.$queryRawUnsafe(MD5_PROD)
const visibilite = async c => (await c.$queryRawUnsafe(`
  select count(*) filter (where profil_public)::int as publics, count(*) filter (where profil_public and not masquer_moteurs)::int as web from public.profiles`))[0]
const visibiliteAvant = await visibilite(prisma)

// Les comptes, lus hors transaction (lecture seule) : rien n en est affiche.
const comptes = (await prisma.$queryRawUnsafe(`
  select p.id::text as id, p.client_number::bigint as numero, public.aok_est_equipe(p.id) as equipe
    from public.profiles p where p.client_number is not null order by p.client_number`)).map(x => ({ ...x, numero: Number(x.numero) }))

// ---------------------------------------------------------------- Phase A : les fonctions seules
const programme = new Map()
const actifsAvant = new Set()
let empreintes = null
try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '120s'`)
    const t0 = performance.now()
    await tx.$executeRawUnsafe(creation(ordresPoints, 'aok_classement'))
    const [a] = await tx.$queryRawUnsafe(MD5_CLASSEMENT)
    await tx.$executeRawUnsafe(creation(ordres, 'aok_a_un_programme'))
    await tx.$executeRawUnsafe(creation(ordres, 'aok_classement'))
    const [b] = await tx.$queryRawUnsafe(MD5_CLASSEMENT)
    empreintes = { v234000: a.m, gratuits: b.m }
    console.log(`    md5 aok_classement : 20261109234000 ${a.m}, 20261109234100 ${b.m} (fonctions creees en ${Math.round(performance.now() - t0)} ms)`)
    if (SEULEMENT_EMPREINTES) throw new Annulation()
    assert.equal(md5Garde234000, a.m, 'garde du fichier : md5 de 20261109234000')
    assert.equal(md5GardeGratuits, b.m, 'garde du fichier : md5 de 20261109234100')
    ok('garde md5 du fichier = les empreintes des deux versions de aok_classement')

    const t1 = performance.now()
    const l = await tx.$queryRawUnsafe(`select p.id::text as id, public.aok_a_un_programme(p.id) as a from public.profiles p`)
    const msProg = performance.now() - t1
    for (const x of l) programme.set(x.id, x.a)
    // Les comptes actifs (des points depuis toujours), pour choisir les lecteurs de la phase B sans tatonner.
    const pts = await tx.$queryRawUnsafe(`select p.id::text as id, (public.aok_points_calcul(p.id, false) ->> 'points')::int as n from public.profiles p`)
    for (const x of pts) if (x.n > 0) actifsAvant.add(x.id)
    const nonEquipe = comptes.filter(c => !c.equipe)
    console.log(`    comptes actifs hors equipe : ${nonEquipe.filter(c => actifsAvant.has(c.id) && programme.get(c.id) === false).length} sans programme, `
      + `${nonEquipe.filter(c => actifsAvant.has(c.id) && programme.get(c.id) === true).length} avec`)
    assert.ok(nonEquipe.some(c => actifsAvant.has(c.id) && programme.get(c.id) === false), 'un compte actif sans programme pour la phase B')
    assert.ok(nonEquipe.some(c => actifsAvant.has(c.id) && programme.get(c.id) === true), 'un compte actif avec programme pour la phase B')
    assert.ok(nonEquipe.filter(c => actifsAvant.has(c.id)).length >= 6, 'assez de comptes actifs pour la phase B')
    if (ordreAnnuaire) {
      await tx.$executeRawUnsafe(ordreAnnuaire)
      const s = await tx.$queryRawUnsafe(`select p.id::text as id, public.aok_annuaire_acces(p.id) ->> 'statut' as s from public.profiles p`)
      const ecarts = s.filter(x => (x.s !== 'communaute') !== programme.get(x.id)).length
      const parStatut = s.reduce((m, x) => ({ ...m, [x.s]: (m[x.s] ?? 0) + 1 }), {})
      assert.equal(ecarts, 0, 'aok_a_un_programme = aok_annuaire_acces (statut autre que communaute)')
      ok(`aok_a_un_programme = aok_annuaire_acces de la branche anciens-membres pour les ${s.length} comptes (${Object.entries(parStatut).map(([k, v]) => `${k} ${v}`).join(', ')}) ; `
        + `${[...programme.values()].filter(Boolean).length} avec programme, ${[...programme.values()].filter(x => !x).length} sans ; ${(msProg / l.length).toFixed(1)} ms par compte`)
    } else {
      ok(`aok_a_un_programme evaluee pour ${l.length} comptes (annuaire introuvable : comparaison sautee) ; ${(msProg / l.length).toFixed(1)} ms par compte`)
    }
    throw new Annulation()
  }, { timeout: 300000, maxWait: 20000 })
} catch (e) {
  if (!(e instanceof Annulation)) {
    console.error(`ECHEC phase A apres ${etapes} etape(s) : ${String(e?.message ?? e).slice(0, 900)}`)
    process.exitCode = 1
  }
}
if (SEULEMENT_EMPREINTES || process.exitCode) {
  const r = await reste(prisma)
  console.log(Object.values(r).some(Boolean) ? '!! RESTE EN BASE apres la phase A' : 'phase A annulee : rien en base')
  await prisma.$disconnect()
  process.exit(process.exitCode ?? 0)
}

// ---------------------------------------------------------------- Phase B : l essai complet
const CLES_PRIVE = ['exaequo', 'moi', 'numero', 'prive', 'rang', 'valeur']
const CLES_NOMME = ['exaequo', 'moi', 'niveau', 'nom', 'numero', 'photo', 'prive', 'rang', 'valeur', 'web']
const CLES_CLASSIQUE = ['calcule_le', 'equipe', 'lignes', 'moi', 'page', 'pages', 'periode', 'restreint', 'sans_valeur', 'seuils', 'taille', 'total', 'vue']
const CLES_PALIERS = ['calcule_le', 'equipe', 'moi', 'periode', 'reste', 'restreint', 'sans_valeur', 'seuils', 'top', 'total', 'vue']
const SEUILS = [0, 5, 20, 65, 155, 515, 2015, 8015, 33015]
const durees = { appels: [], migrations: 0, remplissage: 0 }
let dureeTransaction = null
let tDebut = 0

try {
  await prisma.$transaction(async (tx) => {
    tDebut = performance.now()
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '30s'`)
    let n = 0
    async function comme(role, id, sql, ...params) {
      const sp = `sp${++n}`
      await tx.$executeRawUnsafe(`savepoint ${sp}`)
      try {
        const claims = JSON.stringify(id ? { sub: id, role, aud: 'authenticated' } : { role })
        await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, claims, id ?? '')
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
    const classement = async (id, periode, vue, page = 1) => {
      const r = await comme('authenticated', id, `select public.aok_classement($1::text, $2::text, $3::integer) as r`, periode, vue, page)
      assert.ok(r.ok, `appel refuse : ${r.motif}`)
      durees.appels.push(r.ms)
      return r.lignes[0].r
    }
    const toutes = async (id, periode) => {
      const p1 = await classement(id, periode, 'classique', 1)
      const l = [...p1.lignes]
      for (let pg = 2; pg <= p1.pages; pg++) l.push(...(await classement(id, periode, 'classique', pg)).lignes)
      return { p1, lignes: l }
    }

    // 1. Les trois migrations, la mienne deux fois, 20261109234000 rejouee apres : refusee.
    let t = performance.now()
    for (const o of ordresClassement) await tx.$executeRawUnsafe(o)
    for (const o of ordresPoints) await tx.$executeRawUnsafe(o)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    durees.migrations = Math.round(performance.now() - t)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    await tx.$executeRawUnsafe(`savepoint rejeu`)
    let rejeu = null
    try { for (const o of ordresPoints) await tx.$executeRawUnsafe(o) } catch (e) { rejeu = motif(e) }
    await tx.$executeRawUnsafe(`rollback to savepoint rejeu`)
    assert.ok(rejeu && /deja appliquee/.test(rejeu), `20261109234000 rejouee apres : refusee (${rejeu})`)
    ok(`233000, 234000 et 234100 appliquees en ${durees.migrations} ms, 234100 rejouee (garde md5), 234000 rejouee apres : refusee par sa garde`)

    // 2. Premier remplissage de la table des points.
    t = performance.now()
    const [{ r: rempli }] = await tx.$queryRawUnsafe(`select public.aok_points_jours_rafraichir(true, 'essai') as r`)
    durees.remplissage = Math.round(performance.now() - t)
    assert.equal(rempli.fait, true)

    // 3. Les lecteurs et les profils rendus publics dans la transaction.
    const actifs = new Set((await tx.$queryRawUnsafe(`select distinct user_id::text as id from public.aok_points_jours`)).map(x => x.id))
    const membres = comptes.filter(c => !c.equipe)
    const gratuit = membres.find(c => actifs.has(c.id) && actifsAvant.has(c.id) && programme.get(c.id) === false)
    const payant = membres.find(c => actifs.has(c.id) && actifsAvant.has(c.id) && programme.get(c.id) === true)
    const equipe = comptes.find(c => c.equipe)
    assert.ok(gratuit && payant, 'un compte gratuit et un compte avec programme, tous deux actifs')
    const autres = membres.filter(c => actifs.has(c.id) && c.id !== gratuit.id && c.id !== payant.id)
    const web = new Set(autres.filter((_, i) => i % 3 === 0).map(c => c.numero))
    const membresSeuls = new Set(autres.filter((_, i) => i % 3 === 1).map(c => c.numero))
    membresSeuls.add(gratuit.numero) // le gratuit a un profil « membres » : sa ligne garde son nom
    assert.ok(web.size > 0 && membresSeuls.size > 1, 'assez de comptes actifs pour l essai')
    // Valeurs lues en base (uuid verifies, numeros entiers), posees en clair : pas de tableau en parametre.
    const ids = comptes.filter(c => web.has(c.numero) || membresSeuls.has(c.numero)).map(c => { assert.ok(UUID.test(c.id)); return `'${c.id}'` })
    const numerosWeb = [...web].map(x => { assert.ok(Number.isInteger(x)); return String(x) })
    await tx.$executeRawUnsafe(`
      update public.profiles p set profil_public = true, masquer_moteurs = not coalesce(p.client_number in (${numerosWeb.join(', ')}), false)
       where p.id in (${ids.join(', ')})`)
    ok(`premier remplissage en ${durees.remplissage} ms (${rempli.recalcules} comptes) ; dans la transaction : ${web.size} profil(s) web, ${membresSeuls.size} membres, les autres prives`)

    // 4. Le compte gratuit, le compte avec programme : meme classement, noms selon la regle.
    const brut = []
    const verifier = (lignes, lecteur, restreint, periode) => {
      for (const l of lignes) {
        const nomme = l.moi || web.has(l.numero) || (!restreint && membresSeuls.has(l.numero))
        if (nomme) {
          assert.deepEqual(Object.keys(l).sort(), CLES_NOMME, `${lecteur} ${periode} : ligne nommee`)
          assert.equal(typeof l.nom, 'string')
          assert.equal(l.web, web.has(l.numero), 'web')
          assert.equal(l.prive, !(web.has(l.numero) || membresSeuls.has(l.numero)), 'prive')
        } else {
          assert.deepEqual(Object.keys(l).sort(), CLES_PRIVE, `${lecteur} ${periode} : ligne sous son numero (${membresSeuls.has(l.numero) ? 'membres' : 'prive'})`)
          assert.equal(l.prive, true, 'rendue comme un prive')
        }
      }
    }
    const resume = {}
    for (const periode of ['tout', '7j']) {
      const g = await toutes(gratuit.id, periode)
      const p = await toutes(payant.id, periode)
      brut.push(g, p)
      for (const [x, cles] of [[g.p1, CLES_CLASSIQUE], [p.p1, CLES_CLASSIQUE]]) {
        assert.deepEqual(Object.keys(x).sort(), cles)
        assert.deepEqual(x.seuils, SEUILS, 'seuils = aok_niveaux_seuils()')
        assert.ok(x.calcule_le, 'calcule_le pose')
        assert.equal(typeof x.moi.nom, 'string', 'moi.nom')
        assert.ok(x.moi.photo === null || typeof x.moi.photo === 'number', 'moi.photo')
      }
      assert.equal(g.p1.restreint, true, 'gratuit : restreint')
      assert.equal(p.p1.restreint, false, 'avec programme : pas restreint')
      assert.equal(g.p1.total, p.p1.total, 'meme total')
      assert.equal(g.p1.sans_valeur, p.p1.sans_valeur, 'meme sans_valeur')
      assert.deepEqual(g.lignes.map(l => [l.numero, l.rang, l.valeur, l.exaequo]), p.lignes.map(l => [l.numero, l.rang, l.valeur, l.exaequo]), `${periode} : meme ordre, rangs, valeurs`)
      verifier(g.lignes, 'gratuit', true, periode)
      verifier(p.lignes, 'avec programme', false, periode)
      const sienne = g.lignes.find(l => l.moi)
      if (sienne) assert.equal(typeof sienne.nom, 'string', 'sa ligne porte son nom')
      const compte = (lignes, f) => lignes.filter(f).length
      resume[periode] = {
        total: g.p1.total,
        gratuitNomme: compte(g.lignes, l => 'nom' in l && !l.moi), gratuitNumero: compte(g.lignes, l => !('nom' in l)),
        payantNomme: compte(p.lignes, l => 'nom' in l && !l.moi), payantNumero: compte(p.lignes, l => !('nom' in l)),
        membresCaches: compte(g.lignes, l => membresSeuls.has(l.numero) && !l.moi),
        gratuitClasse: Boolean(sienne),
      }
    }
    assert.ok(resume.tout.membresCaches > 0, 'au moins un profil membres classe, cache au gratuit')
    assert.ok(resume.tout.gratuitNomme > 0, 'au moins un profil web classe, nomme pour le gratuit')
    for (const [periode, r] of Object.entries(resume)) {
      ok(`${periode} : ${r.total} classes, meme ordre, rangs et valeurs pour les deux ; gratuit ${r.gratuitNomme} nommes (web) et ${r.gratuitNumero} sous leur numero `
        + `(dont ${r.membresCaches} profils membres), sa ligne ${r.gratuitClasse ? 'nommee' : 'absente (pas classe)'} ; avec programme ${r.payantNomme} nommes et ${r.payantNumero} sous leur numero (prives)`)
    }

    // 5. Paliers : le top 10 suit la meme regle.
    const gp = await classement(gratuit.id, 'tout', 'paliers')
    const pp = await classement(payant.id, 'tout', 'paliers')
    brut.push(gp, pp)
    assert.deepEqual(Object.keys(gp).sort(), CLES_PALIERS)
    assert.deepEqual(gp.top.map(l => [l.numero, l.rang]), pp.top.map(l => [l.numero, l.rang]), 'meme top 10')
    verifier(gp.top, 'gratuit paliers', true, 'tout')
    verifier(pp.top, 'avec programme paliers', false, 'tout')
    assert.equal(gp.restreint, true)
    ok(`paliers : meme top ${gp.top.length} pour les deux, ${gp.top.filter(l => !('nom' in l)).length} sous leur numero pour le gratuit, ${pp.top.filter(l => !('nom' in l)).length} pour l autre`)

    // 6. L equipe, les refus, ni uuid ni email.
    if (equipe) {
      const e = await classement(equipe.id, 'tout', 'classique')
      brut.push(e)
      assert.equal(e.restreint, false, 'equipe : pas restreinte')
      assert.equal(e.moi.equipe, true)
      verifier(e.lignes, 'equipe', false, 'tout')
    }
    const anon = await comme('anon', null, `select public.aok_classement('7j', 'classique', 1) as r`)
    assert.ok(!anon.ok && /permission denied for function/.test(anon.motif), `anon refuse (${anon.motif})`)
    const sansCompte = await comme('authenticated', null, `select public.aok_classement('7j', 'classique', 1) as r`)
    assert.ok(sansCompte.ok && sansCompte.lignes[0].r === null, 'jeton sans compte : null')
    const regle = await comme('authenticated', gratuit.id, `select public.aok_a_un_programme($1::uuid) as r`, gratuit.id)
    assert.ok(!regle.ok && /permission denied for function/.test(regle.motif), `la regle fermee aux membres (${regle.motif})`)
    const [droits] = await tx.$queryRawUnsafe(`
      select has_function_privilege('anon', to_regprocedure($1), 'execute') as anon, has_function_privilege('authenticated', to_regprocedure($1), 'execute') as auth,
             has_function_privilege('service_role', to_regprocedure($1), 'execute') as service,
             exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = to_regprocedure($1) and a.grantee = 0) as public_,
             has_function_privilege('anon', to_regprocedure($2), 'execute') as c_anon, has_function_privilege('authenticated', to_regprocedure($2), 'execute') as c_auth,
             (select coalesce(array_to_string(proconfig, ','), '') from pg_proc where oid = to_regprocedure($1)) as config,
             (select prosecdef from pg_proc where oid = to_regprocedure($2)) as c_definer`, SIG_PROG, SIG)
    assert.deepEqual([droits.anon, droits.auth, droits.service, droits.public_], [false, false, false, false], 'aok_a_un_programme fermee')
    assert.deepEqual([droits.c_anon, droits.c_auth, droits.c_definer], [false, true, true], 'aok_classement : authenticated seulement, security definer')
    assert.ok(/search_path=("")?$/.test(droits.config), `search_path vide (${droits.config})`)
    const tout = JSON.stringify(brut)
    assert.ok(!UUID.test(tout), 'aucun uuid')
    assert.ok(!/@/.test(tout), 'aucun email')
    ok(`equipe : pas restreinte, hors classement ; anon refuse, jeton sans compte = null, aok_a_un_programme fermee (anon, authenticated, service_role, public), aucun uuid ni email`)
    ok(`DUREES aok_classement : ${mediane(durees.appels)} ms aller-retour (mediane, max ${Math.max(...durees.appels)} ms, ${durees.appels.length} appels)`)

    throw new Annulation()
  }, { timeout: 120000, maxWait: 20000 })
} catch (e) {
  dureeTransaction = Math.round(performance.now() - tDebut)
  if (!(e instanceof Annulation)) {
    console.error(`ECHEC apres ${etapes} etape(s) : ${String(e?.message ?? e).slice(0, 900)}`)
    process.exitCode = 1
  }
} finally {
  if (dureeTransaction != null) console.log(`    DUREE du begin au rollback : ${dureeTransaction} ms (migrations ${durees.migrations} ms, remplissage ${durees.remplissage} ms)`)
  const r = await reste(prisma)
  const [md5Fin] = await prisma.$queryRawUnsafe(MD5_PROD)
  const vis = await visibilite(prisma)
  const intact = md5Fin.activite === md5Prod.activite && md5Fin.calcul === md5Prod.calcul && vis.publics === visibiliteAvant.publics && vis.web === visibiliteAvant.web
  const restes = Object.entries(r).filter(([, v]) => v).map(([k]) => k)
  console.log(restes.length || !intact
    ? `!! RESTE EN BASE : ${restes.join(', ')}${intact ? '' : ' (fonctions de production ou visibilite des profils modifiees)'}`
    : `transaction annulee : ni aok_classement, ni aok_a_un_programme, ni table des points, ni aok_annuaire_acces en base ; fonctions de production a leur empreinte, ${vis.publics} profil public comme avant (${etapes} etapes ok)`)
  if (restes.length || !intact) process.exitCode = 1
  await prisma.$disconnect()
}
