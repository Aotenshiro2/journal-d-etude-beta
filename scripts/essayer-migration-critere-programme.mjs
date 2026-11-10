/**
 * ESSAI de la migration 20261110150000_aok_critere_programme_unique.sql (un seul critere « a un programme »,
 * restes du 10/11/2026) contre la vraie base. Rien n est jamais valide : transaction TOUJOURS annulee,
 * lock_timeout 5 s, chronometre du begin au rollback.
 *
 * Dans la transaction :
 *   1. AVANT : pour chaque compte, aok_a_un_programme (la copie de 20261109234100) et le statut de
 *      aok_annuaire_acces ; aok_classement vue par un lecteur sans programme et un lecteur avec (restreint, total).
 *   2. La migration, puis rejouee (la garde accepte sa propre version).
 *   3. APRES : les memes lectures. Pour chaque compte, le meme cote qu avant ; et apres = statut autre que
 *      communaute. aok_classement : memes restreint et total pour les deux lecteurs. Empreintes de
 *      aok_classement et aok_annuaire_acces inchangees, aok_a_un_programme toujours fermee a anon,
 *      authenticated et service_role.
 * Hors transaction ensuite : aok_a_un_programme a repris son empreinte d avant (rien n est reste).
 * Aucun nom, email, uuid ni numero affiche : des comptages.
 *
 *   --empreintes : cree seulement la nouvelle fonction (transaction annulee) et affiche son md5, a poser dans la
 *                  garde du fichier.
 *
 * Lancement (depuis apps/journal-d-etude, ou son worktree) :
 *   AOK_WORKSPACE=<racine du workspace> node --env-file=.env --env-file=.env.local \
 *     scripts/essayer-migration-critere-programme.mjs [--empreintes]
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const DOSSIER = 'sites/Aoknowledgecom/supabase/migrations'
const MIGRATION = '20261110150000_aok_critere_programme_unique.sql'
const SEULEMENT_EMPREINTES = process.argv.includes('--empreintes')
const MD5_COPIE_234100 = '5e7c5374da543e2fd29e9312841c0c8b'

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

const texte = fichier(MIGRATION)
for (const ligne of texte.split('\n').filter(l => l.trim().startsWith('--'))) {
  assert.ok(!ligne.includes(';'), `point-virgule dans un commentaire : ${ligne.trim()}`)
}
for (const m of texte.matchAll(/comment on [^']+'([^']*)'/g)) assert.ok(!m[1].includes(';'), m[1])
assert.ok(!/\u2014/.test(texte), 'pas de tiret cadratin')
const ordres = decouper(sansCommentaires(texte))
const creation = ordres.find(o => o.toLowerCase().startsWith('create or replace function public.aok_a_un_programme('))
assert.ok(creation, 'creation de aok_a_un_programme dans le fichier')
const garde = /v_programme not in \('([0-9a-f]{32})', '([^']+)'\)/.exec(texte)
assert.ok(garde, 'garde md5 de aok_a_un_programme dans le fichier')
assert.equal(garde[1], MD5_COPIE_234100, 'la garde accepte la copie de 20261109234100')

class Annulation extends Error {}
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const SIG_PROG = 'public.aok_a_un_programme(uuid)'
const SIG_ANNU = 'public.aok_annuaire_acces(uuid)'
const SIG_CLT = 'public.aok_classement(text, text, integer)'
const empreintes = async c => (await c.$queryRawUnsafe(`
  select md5(pg_get_functiondef('${SIG_PROG}'::regprocedure)) as programme,
         md5(pg_get_functiondef('${SIG_ANNU}'::regprocedure)) as annuaire,
         md5(pg_get_functiondef('${SIG_CLT}'::regprocedure)) as classement`))[0]

const avantTout = await empreintes(prisma)
if (avantTout.programme !== MD5_COPIE_234100 && !SEULEMENT_EMPREINTES) {
  throw new Error(`aok_a_un_programme n est plus la copie de 20261109234100 (md5 ${avantTout.programme}) : la migration est-elle deja appliquee ?`)
}

/** Chaque compte : le critere et le statut de l annuaire. */
const criteres = async tx => {
  const t0 = performance.now()
  const l = await tx.$queryRawUnsafe(`select p.id::text as id, public.aok_a_un_programme(p.id) as a,
                                             public.aok_annuaire_acces(p.id) ->> 'statut' as s
                                        from public.profiles p order by p.created_at`)
  return { l, ms: performance.now() - t0 }
}
/** aok_classement vue par un lecteur, comme l appelle le site (role authenticated, jeton du compte). */
const classementVu = async (tx, uid) => {
  await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, JSON.stringify({ sub: uid, role: 'authenticated' }))
  await tx.$executeRawUnsafe('set local role authenticated')
  const t0 = performance.now()
  const [r] = await tx.$queryRawUnsafe(`select public.aok_classement('tout', 'classique', 1) as r`)
  const ms = performance.now() - t0
  await tx.$executeRawUnsafe('reset role')
  const j = r.r ?? {}
  return { restreint: j.restreint ?? null, total: j.total ?? null, lignes: Array.isArray(j.lignes) ? j.lignes.length : null, ms }
}

let debut = 0
try {
  await prisma.$transaction(async tx => {
    debut = performance.now()
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '60s'`)

    if (SEULEMENT_EMPREINTES) {
      await tx.$executeRawUnsafe(creation)
      const e = await empreintes(tx)
      console.log(`md5 de la nouvelle aok_a_un_programme : ${e.programme} (a poser dans la garde du fichier)`)
      throw new Annulation()
    }

    // 1. Avant.
    const avant = await criteres(tx)
    const parId = new Map(avant.l.map(x => [x.id, x]))
    const sans = avant.l.find(x => x.a === false && x.s === 'communaute')
    const avec = avant.l.find(x => x.a === true && x.s !== 'equipe')
    assert.ok(sans && avec, 'un lecteur sans programme et un lecteur avec, pour le classement')
    const cltAvant = { sans: await classementVu(tx, sans.id), avec: await classementVu(tx, avec.id) }
    for (const x of avant.l) assert.equal(x.a, x.s !== 'communaute', 'avant : les deux copies disent deja la meme chose')
    ok(`avant : ${avant.l.length} comptes, ${avant.l.filter(x => x.a).length} avec programme, ${avant.l.filter(x => !x.a).length} sans `
      + `(${Math.round(avant.ms)} ms pour tous), les deux copies d accord pour chacun`)

    // 2. La migration, puis rejouee.
    const t1 = performance.now()
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const msMigration = performance.now() - t1
    const apresMigration = await empreintes(tx)
    if (garde[2] === 'A_REMPLIR_PAR_L_ESSAI') {
      throw new Error(`poser le md5 ${apresMigration.programme} dans la garde du fichier (--empreintes), puis relancer`)
    }
    assert.equal(apresMigration.programme, garde[2], 'la garde du fichier porte le md5 de la nouvelle version')
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    ok(`migration appliquee (${Math.round(msMigration)} ms) puis rejouee : la garde accepte sa propre version`)

    // 3. Apres.
    const apres = await criteres(tx)
    let changes = 0
    for (const x of apres.l) {
      const y = parId.get(x.id)
      assert.ok(y, 'meme liste de comptes')
      if (y.a !== x.a) changes++
      assert.equal(x.a, x.s !== 'communaute', 'apres : le critere = statut autre que communaute')
    }
    assert.equal(changes, 0, 'aucun compte ne change de cote')
    const parStatut = {}
    for (const x of apres.l) parStatut[x.s] = (parStatut[x.s] ?? 0) + 1
    ok(`apres : les memes ${apres.l.filter(x => x.a).length} comptes avec programme, 0 changement (${Math.round(apres.ms)} ms pour tous) ; `
      + `statuts ${JSON.stringify(parStatut)}`)
    const [nul] = await tx.$queryRawUnsafe(`select public.aok_a_un_programme(null) as a, public.aok_a_un_programme('00000000-0000-0000-0000-000000000000'::uuid) as b`)
    assert.equal(nul.a, false)
    assert.equal(nul.b, false)
    ok('compte null ou inconnu : faux, comme avant')

    const cltApres = { sans: await classementVu(tx, sans.id), avec: await classementVu(tx, avec.id) }
    for (const k of ['sans', 'avec']) {
      assert.equal(cltApres[k].restreint, cltAvant[k].restreint, `classement, lecteur ${k} programme : restreint`)
      assert.equal(cltApres[k].total, cltAvant[k].total, `classement, lecteur ${k} programme : total`)
      assert.equal(cltApres[k].lignes, cltAvant[k].lignes, `classement, lecteur ${k} programme : lignes`)
    }
    assert.equal(cltAvant.sans.restreint, true)
    assert.equal(cltAvant.avec.restreint, false)
    ok(`aok_classement : lecteur sans programme restreint, avec programme non, memes totaux avant et apres `
      + `(${Math.round(cltAvant.sans.ms)}/${Math.round(cltAvant.avec.ms)} ms avant, ${Math.round(cltApres.sans.ms)}/${Math.round(cltApres.avec.ms)} ms apres)`)

    assert.equal(apresMigration.classement, avantTout.classement, 'aok_classement inchangee')
    assert.equal(apresMigration.annuaire, avantTout.annuaire, 'aok_annuaire_acces inchangee')
    const [droits] = await tx.$queryRawUnsafe(`
      select has_function_privilege('anon', '${SIG_PROG}', 'execute') as anon,
             has_function_privilege('authenticated', '${SIG_PROG}', 'execute') as auth,
             has_function_privilege('service_role', '${SIG_PROG}', 'execute') as service`)
    assert.deepEqual(droits, { anon: false, auth: false, service: false })
    ok('empreintes de aok_classement et aok_annuaire_acces inchangees, aok_a_un_programme fermee a anon, authenticated, service_role')
    throw new Annulation()
  }, { timeout: 60000, maxWait: 10000 })
} catch (e) {
  if (!(e instanceof Annulation)) throw e
}
const duree = Math.round(performance.now() - debut)

const apresTout = await empreintes(prisma)
await prisma.$disconnect()
if (SEULEMENT_EMPREINTES) {
  console.log(`(transaction annulee, ${duree} ms)`)
} else {
  assert.equal(apresTout.programme, avantTout.programme, 'apres l annulation : aok_a_un_programme a son empreinte d avant')
  ok(`transaction annulee (${duree} ms du begin au rollback) : aok_a_un_programme a repris son empreinte d avant`)
  console.log(`\n${etapes} etapes ok, rien d ecrit`)
}
