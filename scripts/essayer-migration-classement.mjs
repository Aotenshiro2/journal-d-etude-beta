/**
 * ESSAI de la migration 20261109233000_aok_classement.sql (le classement
 * Activite, 09/11/2026) contre la vraie base, dans UNE transaction TOUJOURS
 * ANNULEE (rien ne reste, lock_timeout 5 s). Ce qui est verifie :
 *   0. la fonction n existe pas encore (essai d une migration pas appliquee) ;
 *   1. la migration, jouee DEUX fois ;
 *   2. les gardes : SECURITY DEFINER, search_path vide, execute refuse a anon
 *      et a public, accorde a authenticated, jeton sans compte = null ;
 *   3. sous authenticated (vrai sub) : classique (pages de 20, page ramenee
 *      dans les bornes) et paliers (top 10, rang de l appelant seulement dans
 *      le top 10), sur 7j, 30j et tout, compares au calcul direct
 *      (aok_points_calcul par compte, rang = 1 + le nombre strictement devant) ;
 *      ni uuid ni email dans la reponse, un profil prive = le numero seul,
 *      l equipe absente des lignes et du total ;
 *   4. un compte de l equipe : moi.equipe ;
 *   5. le palier rendu = la regle du labo (palierMoi de communaute.ts) pour
 *      une quinzaine d appelants repartis dans le classement ;
 *   6. le PLAFOND des points de lecon, pose dans un point de sauvegarde annule
 *      (5, 10, 20 lecons par jour) : son effet sur le haut du classement et
 *      sur les niveaux (chiffres agreges seulement) ;
 *   7. lecture seule : les offres de l academie qui ouvrent tout (pour la
 *      rangee « Aller plus loin » sous les lecons), chiffres agreges.
 * Puis la transaction est annulee et on verifie hors transaction que la
 * fonction n est pas restee. Aucun nom, email, uuid ni numero affiche.
 *
 * Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
 *   node --env-file=.env.local scripts/essayer-migration-classement.mjs
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const DOSSIER = 'sites/Aoknowledgecom/supabase/migrations'
const MIGRATION = '20261109233000_aok_classement.sql'
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
const ordres = decouper(sansCommentaires(fichier(MIGRATION)))

class Annulation extends Error {}
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const motif = e => String(e?.message ?? e).split('\n').find(l => /permission|denied|does not exist|exception|syntax|error/i.test(l))?.trim().slice(0, 160) ?? 'refus'
const SIG = 'public.aok_classement(text, text, integer)'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const mediane = a => { const t = [...a].sort((x, y) => x - y); return t.length ? t[Math.floor(t.length / 2)] : 0 }

const existe = async c => (await c.$queryRawUnsafe(`select to_regprocedure($1) is not null as la`, SIG))[0].la
if (await existe(prisma)) throw new Error('aok_classement existe DEJA : cet essai est fait pour la migration pas encore appliquee.')

// ---------------------------------------------------------------- La regle du labo, en JS (communaute.ts)

/** Le calcul direct : valeur de la periode depuis la grille de aok_points_calcul (jours du fuseau du membre). */
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
/** palierMoi du labo (communaute.ts), sur le classement direct. */
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

const CLES_PRIVE = ['exaequo', 'moi', 'numero', 'prive', 'rang', 'valeur']
const CLES_PUBLIC = ['exaequo', 'moi', 'niveau', 'nom', 'numero', 'photo', 'prive', 'rang', 'valeur']

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '90s'`)
    let n = 0
    async function comme(role, id, sql, ...params) {
      const sp = `sp${++n}`
      await tx.$executeRawUnsafe(`savepoint ${sp}`)
      const t0 = Date.now()
      try {
        const claims = JSON.stringify(id ? { sub: id, role, aud: 'authenticated' } : { role })
        await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, claims)
        await tx.$executeRawUnsafe(`select set_config('request.jwt.claim.sub', $1, true)`, id ?? '')
        await tx.$executeRawUnsafe(`set local role ${role}`)
        const lignes = await tx.$queryRawUnsafe(sql, ...params)
        return { ok: true, lignes, ms: Date.now() - t0 }
      } catch (e) {
        return { ok: false, motif: motif(e), ms: Date.now() - t0 }
      } finally {
        await tx.$executeRawUnsafe(`rollback to savepoint ${sp}`)
      }
    }
    const classement = async (id, periode, vue, page = 1) => {
      const r = await comme('authenticated', id, `select public.aok_classement($1::text, $2::text, $3::integer) as r`, periode, vue, page)
      assert.ok(r.ok, `appel refuse : ${r.motif}`)
      return { r: r.lignes[0].r, ms: r.ms }
    }

    // 1. Avant : les comptes et le calcul direct (role du proprietaire).
    const tous = await tx.$queryRawUnsafe(`
      select p.id::text as id, p.client_number::bigint as numero, coalesce(p.profil_public, false) as public,
             public.aok_est_equipe(p.id) as equipe, public.aok_points_calcul(p.id, false) as c
        from public.profiles p`)
    for (const x of tous) x.numero = Number(x.numero)
    const equipe = tous.filter(x => x.equipe)
    const comptes = tous.filter(x => !x.equipe)
    const directs = { '7j': classerDirect(comptes, '7j'), '30j': classerDirect(comptes, '30j'), tout: classerDirect(comptes, 'tout') }
    ok(`avant : ${tous.length} comptes dont ${equipe.length} de l equipe, ${comptes.filter(x => x.public).length} profil(s) public(s) ; classes : 7j ${directs['7j'].length}, 30j ${directs['30j'].length}, tout ${directs.tout.length}`)

    // 2. La migration, deux fois.
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    ok(`migration jouee deux fois (${ordres.length} ordres)`)

    // 3. Les gardes.
    const [f] = await tx.$queryRawUnsafe(`
      select p.prosecdef as definer, coalesce(array_to_string(p.proconfig, ','), '') as config, p.provolatile as vol,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as auth,
             exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_
        from pg_proc p where p.oid = to_regprocedure($1)`, SIG)
    assert.equal(f.definer, true, 'security definer')
    assert.ok(/search_path=("")?$/.test(f.config) || f.config === 'search_path=""', `search_path vide (${f.config})`)
    assert.equal(f.anon, false, 'anon ne peut pas l executer')
    assert.equal(f.public_, false, 'public ne peut pas l executer')
    assert.equal(f.auth, true, 'authenticated peut l executer')
    const anon = await comme('anon', null, `select public.aok_classement('7j', 'classique', 1) as r`)
    assert.equal(anon.ok, false, 'anon refuse')
    const sansCompte = await comme('authenticated', null, `select public.aok_classement('7j', 'classique', 1) as r`)
    assert.ok(sansCompte.ok && sansCompte.lignes[0].r === null, 'jeton sans compte : null')
    ok(`gardes : security definer, ${f.config}, stable=${f.vol === 's'}, anon refuse (${anon.motif}), public non, authenticated oui, sans compte = null`)

    // L appelant ordinaire : le compte classe au milieu sur 7 jours (sinon depuis toujours).
    const ref = directs['7j'].length ? directs['7j'] : directs.tout
    const appelant = ref[Math.floor(ref.length / 2)]
    assert.ok(appelant, 'un compte classe')
    const idsEquipe = new Set(equipe.map(x => x.numero))
    const durees = []

    for (const periode of ['7j', '30j', 'tout']) {
      const d = directs[periode]
      // Classique : toutes les pages, recousues = le classement direct.
      const { r: p1, ms } = await classement(appelant.id, periode, 'classique', 1)
      durees.push(ms)
      const brut = JSON.stringify(p1)
      assert.ok(!UUID.test(brut), 'aucun uuid')
      assert.ok(!/email|@/.test(brut), 'aucun email')
      assert.deepEqual(Object.keys(p1).sort(), ['equipe', 'lignes', 'moi', 'page', 'pages', 'periode', 'sans_valeur', 'taille', 'total', 'vue'])
      assert.equal(p1.total, d.length, `${periode} : total = calcul direct`)
      assert.equal(p1.equipe, equipe.length)
      assert.equal(p1.sans_valeur, comptes.length - d.length, `${periode} : sans_valeur`)
      assert.equal(p1.taille, 20)
      assert.equal(p1.pages, Math.max(1, Math.ceil(d.length / 20)))
      const toutes = [...p1.lignes]
      for (let pg = 2; pg <= p1.pages; pg++) toutes.push(...(await classement(appelant.id, periode, 'classique', pg)).r.lignes)
      assert.equal(toutes.length, d.length, `${periode} : pages recousues`)
      toutes.forEach((l, i) => {
        assert.equal(l.numero, d[i].numero, `${periode} : ordre ligne ${i + 1}`)
        assert.equal(l.valeur, d[i].valeur)
        assert.equal(l.rang, d[i].rang)
        assert.equal(l.exaequo, d[i].exaequo)
        assert.ok(!idsEquipe.has(l.numero), 'pas d equipe dans les lignes')
        const moi = d[i].id === appelant.id
        assert.equal(l.moi, moi)
        if (d[i].public || moi) assert.deepEqual(Object.keys(l).sort(), CLES_PUBLIC)
        else assert.deepEqual(Object.keys(l).sort(), CLES_PRIVE, 'profil prive : le numero seul')
      })
      const loin = (await classement(appelant.id, periode, 'classique', 999)).r
      assert.equal(loin.page, p1.pages, 'page 999 ramenee a la derniere')
      assert.equal((await classement(appelant.id, periode, 'classique', 0)).r.page, 1, 'page 0 ramenee a 1')
      assert.equal((await classement(appelant.id, periode, 'bizarre', null)).r.vue, 'classique', 'vue inconnue = classique')
      const moiD = d.find(x => x.id === appelant.id)
      assert.equal(p1.moi.classe, Boolean(moiD))
      assert.equal(p1.moi.equipe, false)
      if (moiD) {
        assert.equal(p1.moi.ligne.rang, moiD.rang)
        assert.equal(p1.moi.ligne.nom != null, true, 'sa propre ligne porte son nom, meme profil prive')
      }
      assert.equal(p1.moi.progression.points, Number(appelant.c.points))
      assert.equal(p1.moi.progression.niveau, Number(appelant.c.niveau))

      // Paliers.
      const { r: pa, ms: ms2 } = await classement(appelant.id, periode, 'paliers')
      durees.push(ms2)
      assert.deepEqual(Object.keys(pa).sort(), ['equipe', 'moi', 'periode', 'reste', 'sans_valeur', 'top', 'total', 'vue'])
      assert.ok(pa.top.every(l => l.rang <= 10), 'top 10 seulement')
      assert.equal(pa.top.length, d.filter(x => x.rang <= 10).length, 'top 10 ex aequo compris')
      assert.equal(pa.reste, d.length - pa.top.length)
      if (moiD) {
        assert.equal(pa.moi.dans_top, moiD.rang <= 10)
        assert.equal(pa.moi.rang ?? null, moiD.rang <= 10 ? moiD.rang : null, 'rang seulement dans le top 10')
        assert.ok(!('ligne' in pa.moi), 'pas de ligne (donc pas de rang) hors du top 10')
        const attendu = palierLabo(d, appelant.id)
        assert.equal(pa.moi.palier, attendu.palier)
        assert.equal(pa.moi.prochain, attendu.prochain)
        if (attendu.prochain) { assert.equal(pa.moi.manque, attendu.manque); assert.equal(pa.moi.part, attendu.part) }
      }
      ok(`${periode} : ${d.length} classe(s) sur ${p1.pages} page(s), recousues = calcul direct (rang, ex aequo, valeur), prive = numero seul, `
        + `equipe absente, page ramenee dans les bornes, paliers top ${pa.top.length} + reste ${pa.reste}, appelant ${moiD ? `${moiD.rang <= 10 ? 'dans le top 10' : `palier ${pa.moi.palier}`}` : 'pas classe'}`)
    }

    // 4. Un compte de l equipe.
    if (equipe.length) {
      const { r } = await classement(equipe[0].id, '7j', 'classique')
      assert.equal(r.moi.equipe, true)
      assert.equal(r.moi.classe, false)
      assert.ok(!r.lignes.some(l => l.moi), 'aucune ligne a lui')
      ok('un compte de l equipe : moi.equipe = true, hors classement')
    }

    // 5. Le palier de chaque appelant = la regle du labo (une quinzaine, repartis).
    let compares = 0
    for (const periode of ['7j', 'tout']) {
      const d = directs[periode]
      const pas = Math.max(1, Math.floor(d.length / 8))
      for (let i = 0; i < d.length; i += pas) {
        const { r, ms } = await classement(d[i].id, periode, 'paliers')
        durees.push(ms)
        const attendu = palierLabo(d, d[i].id)
        assert.equal(r.moi.palier, attendu.palier, `${periode} n ${i + 1}`)
        assert.equal(r.moi.prochain, attendu.prochain, `${periode} n ${i + 1}`)
        if (attendu.prochain) { assert.equal(r.moi.manque, attendu.manque); assert.equal(r.moi.part, attendu.part) }
        compares++
      }
    }
    ok(`paliers : ${compares} appelants repartis, palier, prochain, manque et part = la regle du labo`)
    ok(`duree d un appel (54 comptes calcules) : mediane ${mediane(durees)} ms, max ${Math.max(...durees)} ms, sur ${durees.length} appels`)

    // 6. Le plafond des points de lecon, dans un point de sauvegarde annule.
    const [bareme] = await tx.$queryRawUnsafe(`select points, plafond_jour from public.aok_points_bareme where source = 'lecon_terminee'`)
    console.log(`    bareme actuel : lecon_terminee ${bareme.points} points, plafond ${bareme.plafond_jour ?? 'aucun'}`)
    const niveauxAvant = new Map(comptes.map(x => [x.id, Number(x.c.niveau)]))
    const haut = (d, k) => d.slice(0, k).map(x => x.valeur)
    for (const plafond of [5, 10, 20]) {
      await tx.$executeRawUnsafe(`savepoint plafond`)
      await tx.$executeRawUnsafe(`update public.aok_points_bareme set plafond_jour = $1 where source = 'lecon_terminee'`, plafond)
      const apres = await tx.$queryRawUnsafe(`
        select p.id::text as id, p.client_number::bigint as numero, public.aok_points_calcul(p.id, false) as c
          from public.profiles p where not public.aok_est_equipe(p.id)`)
      for (const x of apres) x.numero = Number(x.numero)
      const d7 = classerDirect(apres, '7j')
      const dt = classerDirect(apres, 'tout')
      const baisses = apres.filter(x => Number(x.c.niveau) < niveauxAvant.get(x.id)).length
      const touches = apres.filter(x => Number(x.c.points) < Number(comptes.find(y => y.id === x.id).c.points)).length
      const premierChange7 = d7[0]?.id !== directs['7j'][0]?.id
      const premierChangeT = dt[0]?.id !== directs.tout[0]?.id
      // Le classement par la RPC suit le bareme sans rien changer d autre.
      const { r } = await classement(appelant.id, '7j', 'classique')
      assert.equal(r.lignes[0]?.valeur ?? null, d7[0]?.valeur ?? null, 'la RPC lit le bareme')
      console.log(`    plafond ${plafond} lecons/jour : ${touches} compte(s) perdent des points, ${baisses} descendent d un niveau ; `
        + `7j : top 3 ${haut(directs['7j'], 3).join('/')} -> ${haut(d7, 3).join('/')}, mediane ${mediane(directs['7j'].map(x => x.valeur))} -> ${mediane(d7.map(x => x.valeur))}, 1er ${premierChange7 ? 'change' : 'inchange'} ; `
        + `tout : top 3 ${haut(directs.tout, 3).join('/')} -> ${haut(dt, 3).join('/')}, 1er ${premierChangeT ? 'change' : 'inchange'}`)
      await tx.$executeRawUnsafe(`rollback to savepoint plafond`)
    }
    const [bareme2] = await tx.$queryRawUnsafe(`select plafond_jour from public.aok_points_bareme where source = 'lecon_terminee'`)
    assert.equal(bareme2.plafond_jour, bareme.plafond_jour, 'bareme remis')
    ok('plafond des lecons mesure a 5, 10 et 20 par jour (points de sauvegarde annules), bareme inchange')

    // 7. Les offres qui ouvrent tout (rangee « Aller plus loin »), chiffres agreges.
    const offres = await tx.$queryRawUnsafe(`
      select o.slug, o.ouvre_tout,
             count(a.*) filter (where a.retire_le is null and a.debut <= now() and (a.fin is null or a.fin > now()))::int as en_cours
        from public.academie_offres o left join public.academie_acces a on a.offre_id = o.id
       group by o.slug, o.ouvre_tout order by o.ouvre_tout desc, o.slug`)
    console.log(`    offres : ${offres.map(o => `${o.slug}${o.ouvre_tout ? ' (ouvre tout)' : ''} ${o.en_cours}`).join(', ')}`)
    ok('offres de l academie lues (lecture seule)')

    throw new Annulation()
  }, { timeout: 600000, maxWait: 20000 })
} catch (e) {
  if (!(e instanceof Annulation)) {
    console.error(`ECHEC apres ${etapes} etape(s) : ${String(e?.message ?? e).slice(0, 600)}`)
    process.exitCode = 1
  }
} finally {
  const reste = await existe(prisma)
  console.log(reste ? '!! aok_classement est RESTEE en base' : `transaction annulee : aok_classement absente de la base (${etapes} etapes ok)`)
  if (reste) process.exitCode = 1
  await prisma.$disconnect()
}
