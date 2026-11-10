/**
 * ESSAI de la migration 20261110160000_aok_anciens_telegram_prefixe.sql (la regle « telegram » de l import des
 * anciens, prefixe « u », restes du 10/11/2026) contre la vraie base. Rien n est jamais valide : transaction
 * TOUJOURS annulee, lock_timeout 5 s, chronometre du begin au rollback.
 *
 * Dans la transaction :
 *   1. AVANT : aok_anciens_correspondances pour chaque compte ; etat des reservations, des propositions et des
 *      numeros de compte.
 *   2. Le prochain declencheur AVANT la correction : aok_anciens_activer pour chaque compte (sous un point de
 *      sauvegarde, defait aussitot), pour comparer.
 *   3. La migration, puis rejouee (la garde accepte sa propre version). La fonction ne differe de l ancienne que
 *      par la ligne de comptes_tg.
 *   4. CE QUE FAIT L APPLICATION SEULE : reservations, propositions et numeros de compte identiques a l etape 1.
 *   5. APRES : les correspondances de chaque compte, et ce qui change (attendu : des lignes « telegram » en plus,
 *      aucune en moins).
 *   6. Le prochain declencheur APRES la correction : aok_anciens_activer pour chaque compte (point de sauvegarde,
 *      defait) : quels comptes seraient actives (et leur numero change), lesquels recevraient une proposition.
 * Hors transaction ensuite : empreinte d avant, reservations et propositions d avant.
 * Sortie : numeros d anciens et de comptes, motifs ; aucun nom, email ni uuid.
 *
 *   --empreintes : cree seulement la nouvelle fonction (transaction annulee) et affiche son md5, a poser dans la
 *                  garde du fichier.
 *
 * Lancement (depuis apps/journal-d-etude, ou son worktree) :
 *   AOK_WORKSPACE=<racine du workspace> node --env-file=.env --env-file=.env.local \
 *     scripts/essayer-migration-anciens-telegram.mjs [--empreintes]
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const DOSSIER = 'sites/Aoknowledgecom/supabase/migrations'
const MIGRATION = '20261110160000_aok_anciens_telegram_prefixe.sql'
const SEULEMENT_EMPREINTES = process.argv.includes('--empreintes')
const MD5_234500 = '22e40d5df60d33fb982acca5b2754452'
const SIG = 'public.aok_anciens_correspondances(uuid)'

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
assert.ok(!/—/.test(texte), 'pas de tiret cadratin')
const ordres = decouper(sansCommentaires(texte))
const creation = ordres.find(o => o.toLowerCase().startsWith('create or replace function public.aok_anciens_correspondances('))
assert.ok(creation, 'creation de aok_anciens_correspondances dans le fichier')
const garde = /v_corresp not in \('([0-9a-f]{32})', '([^']+)'\)/.exec(texte)
assert.ok(garde, 'garde md5 dans le fichier')
assert.equal(garde[1], MD5_234500, 'la garde accepte la version de 20261109234500')

class Annulation extends Error {}
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const empreinte = async c => (await c.$queryRawUnsafe(`select md5(pg_get_functiondef('${SIG}'::regprocedure)) as m, pg_get_functiondef('${SIG}'::regprocedure) as d`))[0]
const etat = async c => (await c.$queryRawUnsafe(`
  select (select count(*) from public.aok_anciens_membres where profile_id is not null)::int as actives,
         (select coalesce(string_agg(numero::text || ':' || profile_id::text, ',' order by numero), '') from public.aok_anciens_membres where profile_id is not null) as liens,
         (select coalesce(string_agg(proposition_id::text || ':' || statut, ',' order by proposition_id), '') from public.aok_anciens_propositions) as propositions,
         (select md5(coalesce(string_agg(id::text || ':' || coalesce(client_number::text, '-'), ',' order by id), '')) from public.profiles) as numeros`))[0]

const avantTout = await empreinte(prisma)
const etatAvantTout = await etat(prisma)
if (avantTout.m !== MD5_234500 && !SEULEMENT_EMPREINTES) {
  throw new Error(`aok_anciens_correspondances n est plus la version de 20261109234500 (md5 ${avantTout.m}) : deja appliquee ?`)
}

// Comptes lus hors transaction : numero du compte (affiche) et uuid (jamais affiche).
const comptes = (await prisma.$queryRawUnsafe(`select p.id::text as id, p.client_number::bigint as numero from public.profiles p order by p.client_number`))
  .map(x => ({ id: x.id, numero: x.numero == null ? null : Number(x.numero) }))
const numeroDe = new Map(comptes.map(c => [c.id, c.numero]))

const correspondances = async tx => {
  const m = new Map()
  for (const c of comptes) {
    const l = await tx.$queryRawUnsafe(`select numero::bigint as n, mode from public.aok_anciens_correspondances($1::uuid) order by numero, mode`, c.id)
    m.set(c.id, l.map(x => `${Number(x.n)}:${x.mode}`))
  }
  return m
}
/** aok_anciens_activer pour chaque compte, sous un point de sauvegarde defait aussitot : le prochain declencheur. */
const declencheurs = async (tx, nom) => {
  await tx.$executeRawUnsafe(`savepoint ${nom}`)
  const actives = []
  const proposes = []
  for (const c of comptes) {
    const [r] = await tx.$queryRawUnsafe(`select public.aok_anciens_activer($1::uuid) as r`, c.id)
    const j = r.r ?? {}
    if (j.active != null) actives.push(`compte n° ${c.numero} -> ancien n° ${j.active} (mode ${j.mode})`)
    if (Number(j.propositions) > 0) proposes.push(`compte n° ${c.numero} : ${j.propositions} proposition(s)`)
  }
  const nouvelles = await tx.$queryRawUnsafe(`
    select pr.numero::bigint as n, pr.profile_id::text as p, pr.motif from public.aok_anciens_propositions pr
     where pr.statut = 'a_confirmer' order by pr.numero`)
  await tx.$executeRawUnsafe(`rollback to savepoint ${nom}`)
  return { actives, proposes, aConfirmer: nouvelles.map(x => `ancien n° ${Number(x.n)} <-> compte n° ${numeroDe.get(x.p)} (${x.motif})`) }
}

let debut = 0
try {
  await prisma.$transaction(async tx => {
    debut = performance.now()
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '60s'`)

    if (SEULEMENT_EMPREINTES) {
      await tx.$executeRawUnsafe(creation)
      console.log(`md5 de la nouvelle aok_anciens_correspondances : ${(await empreinte(tx)).m} (a poser dans la garde du fichier)`)
      throw new Annulation()
    }

    // 1. Avant.
    const avant = await correspondances(tx)
    const etatAvant = await etat(tx)
    const lignesAvant = [...avant.values()].flat()
    ok(`avant : ${lignesAvant.length} correspondances sur ${comptes.length} comptes, dont ${lignesAvant.filter(x => x.endsWith(':telegram')).length} « telegram » ; `
      + `${etatAvant.actives} reservation(s) activee(s)`)

    // 2. Le prochain declencheur, avant la correction.
    const dAvant = await declencheurs(tx, 'avant_correction')
    console.log(`    prochain declencheur AVANT : ${dAvant.actives.length} activation(s) ${JSON.stringify(dAvant.actives)}`)
    console.log(`    propositions a confirmer ensuite : ${JSON.stringify(dAvant.aConfirmer)}`)
    assert.deepEqual(await etat(tx), etatAvant, 'point de sauvegarde bien defait')

    // 3. La migration, puis rejouee.
    const t1 = performance.now()
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const ms = performance.now() - t1
    const apresMigration = await empreinte(tx)
    if (garde[2] === 'A_REMPLIR_PAR_L_ESSAI') throw new Error(`poser le md5 ${apresMigration.m} dans la garde du fichier (--empreintes), puis relancer`)
    assert.equal(apresMigration.m, garde[2], 'la garde du fichier porte le md5 de la nouvelle version')
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const la = avantTout.d.split('\n')
    const lb = apresMigration.d.split('\n')
    const differentes = lb.filter((l, i) => l !== la[i])
    assert.equal(la.length, lb.length, 'meme nombre de lignes')
    assert.equal(differentes.length, 1, 'une seule ligne change')
    assert.match(differentes[0], /ltrim\(lower\(btrim\(t\.tg\)\), 'u'\)/)
    ok(`migration appliquee (${Math.round(ms)} ms) puis rejouee ; une seule ligne de la fonction change (comptes_tg)`)

    // 4. L'application seule.
    assert.deepEqual(await etat(tx), etatAvant, 'la migration seule n active, ne propose ni ne renumerote rien')
    ok('au moment de l appliquer : 0 activation, 0 proposition, aucun numero de compte change')

    // 5. Apres.
    const apres = await correspondances(tx)
    const plus = []
    const moins = []
    for (const c of comptes) {
      const a = new Set(avant.get(c.id))
      const b = new Set(apres.get(c.id))
      for (const x of b) if (!a.has(x)) plus.push(`compte n° ${c.numero} : ancien n° ${x.replace(':', ' (')})`)
      for (const x of a) if (!b.has(x)) moins.push(`compte n° ${c.numero} : ${x}`)
    }
    assert.equal(moins.length, 0, `aucune correspondance perdue : ${moins.join(' | ')}`)
    assert.ok(plus.every(x => x.endsWith('(telegram)')), 'seules des correspondances « telegram » apparaissent')
    ok(`apres : ${plus.length} correspondance(s) « telegram » en plus, 0 en moins : ${plus.join(' ; ')}`)

    // 6. Le prochain declencheur, apres la correction.
    const dApres = await declencheurs(tx, 'apres_correction')
    console.log(`    prochain declencheur APRES : ${dApres.actives.length} activation(s) ${JSON.stringify(dApres.actives)}`)
    console.log(`    propositions a confirmer ensuite : ${JSON.stringify(dApres.aConfirmer)}`)
    ok('declencheurs simules avant et apres, chaque fois defaits')
    throw new Annulation()
  }, { timeout: 120000, maxWait: 10000 })
} catch (e) {
  if (!(e instanceof Annulation)) throw e
}
const duree = Math.round(performance.now() - debut)
const apresTout = await empreinte(prisma)
const etatApresTout = await etat(prisma)
await prisma.$disconnect()
if (SEULEMENT_EMPREINTES) {
  console.log(`(transaction annulee, ${duree} ms)`)
} else {
  assert.equal(apresTout.m, avantTout.m, 'apres l annulation : empreinte d avant')
  assert.deepEqual(etatApresTout, etatAvantTout, 'apres l annulation : reservations, propositions et numeros d avant')
  ok(`transaction annulee (${duree} ms du begin au rollback) : fonction, reservations, propositions et numeros d avant`)
  console.log(`\n${etapes} etapes ok, rien d ecrit`)
}
