/**
 * ESSAI de la migration 20261023150000_academie_arbre.sql (l'arbre du catalogue range depuis le cockpit,
 * 23/10/2026) contre la vraie base, dans UNE transaction TOUJOURS ANNULEE (rien ne reste) :
 *   1. la migration ; colonnes et index ; ordre_fichier rempli (= ordre) pour les sections existantes ;
 *   2. deux modules de test importes (importerModule, scripts/importer-catalogue-academie.mjs) ;
 *   3. les gestes de la route, joues par executerGeste (src/lib/academie/arbre.ts, le code de la route) :
 *      une lecon passe dans l'AUTRE module (slug pris : un-2, origine notee), reordonner dans un module,
 *      reordonner les sections, cacher une lecon et un module, creer une section ; chaque element qui bouge
 *      a sa ligne dans academie_editions (par = l'admin, origine app) ;
 *   4. l'importeur relance : la lecon deplacee n'est ni ramenee ni recreee, les places et statuts du cockpit
 *      sont gardes, la section creee dans le cockpit n'est pas touchee ; une lecon du fichier qui porterait le
 *      slug d'une lecon arrivee d'ailleurs arrete l'import ; --ecraser-editions remet le fichier et note ce
 *      qui est defait (origine import) ;
 *   5. les contraintes (historique, origine) ; la migration rejouee ne remplit pas ordre_fichier d'une section
 *      creee dans l'app.
 * Puis la transaction est annulee, et on verifie hors transaction que rien n'est reste.
 *
 * Verrous : academie_modules, academie_sections, academie_lecons, academie_editions (ajout de colonnes et de
 * contraintes) le temps de la transaction, quelques secondes ; lock_timeout de 5 s.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env.local scripts/essayer-migration-arbre-academie.mjs
 * N'affiche aucun email ni aucune cle.
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PrismaClient } from '@prisma/client'
import { conteneursDuModule, executerGeste, lireArbre } from '../src/lib/academie/arbre.ts'
import { importerModule } from './importer-catalogue-academie.mjs'

const MIGRATION = new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261023150000_academie_arbre.sql', import.meta.url)

// --- Decoupage : copie de appliquer-migration.mjs -------------------------
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
    } else if (sql.startsWith(tag, i)) {
      courant += tag; i += tag.length; tag = null; continue
    }
    courant += sql[i]
    i += 1
  }
  if (courant.trim()) ordres.push(courant.trim())
  return ordres
}
const ordres = decouper(readFileSync(MIGRATION, 'utf8')
  .split('\n')
  .filter((ligne) => !ligne.trim().startsWith('--'))
  .join('\n'))

class Annulation extends Error {}

let etapes = 0
const ok = (nom) => { etapes++; console.log(`ok  ${nom}`) }

const prisma = new PrismaClient()

async function doitEchouer(tx, nom, sql, ...params) {
  await tx.$executeRawUnsafe('savepoint essai')
  let erreur = null
  try {
    await tx.$executeRawUnsafe(sql, ...params)
  } catch (err) {
    erreur = err
  }
  await tx.$executeRawUnsafe('rollback to savepoint essai')
  assert.ok(erreur, `${nom} : l'ordre aurait du etre refuse`)
  const code = /\b(23\d{3})\b/.exec(String(erreur.message ?? erreur))?.[1] ?? 'refuse'
  ok(`${nom} : refuse (${code})`)
}

const colonnesArbre = async (client) => (await client.$queryRawUnsafe(`
  select count(*)::int as n from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'academie_lecons' and column_name in ('deplace_le', 'statut_le', 'origine_module_id', 'origine_slug'))
       or (table_name = 'academie_modules' and column_name in ('deplace_le', 'statut_le'))
       or (table_name = 'academie_sections' and column_name in ('ordre_fichier', 'deplace_le')))`))[0].n
const tableEditions = async (client) => (await client.$queryRawUnsafe(
  `select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'academie_editions'`))[0].n === 1

if (!(await tableEditions(prisma))) {
  console.log('La migration 20261023120000 (academie_editions) manque : a appliquer d abord.')
  await prisma.$disconnect()
  process.exit(1)
}
const avant = await colonnesArbre(prisma)
if (avant === 8) {
  console.log('La migration de l arbre est DEJA appliquee : rien a essayer.')
  await prisma.$disconnect()
  process.exit(0)
}
assert.equal(avant, 0, 'colonnes de l arbre a moitie presentes')

const ADMIN = randomUUID()
const A = 'essai-lot-arbre-a'
const B = 'essai-lot-arbre-b'
const VIDEO = 'b03789d3-f998-44ec-8c3c-5d8c5977008c'
const dossier = tmpdir()

const fichierA = () => ({
  module: { slug: A, titre: 'Essai arbre A', ordre: 9998, parcours: 'essai', statut: 'publie', auteur: 'brice' },
  offres: [],
  sections: [{ cle: 'p1', ordre: 1, titre: 'Partie 1' }, { cle: 'p2', ordre: 2, titre: 'Partie 2' }],
  lecons: [
    { slug: 'intro', ordre: 1, titre: 'Intro', type: 'texte', contenu: 'Intro.', statut: 'publie' },
    { slug: 'un', section: 'p1', ordre: 2, titre: 'Un', type: 'texte', contenu: 'Un.', statut: 'publie' },
    { slug: 'deux', section: 'p1', ordre: 3, titre: 'Deux', type: 'video', bunny_video_id: VIDEO, duree_s: 60, statut: 'publie' },
    { slug: 'trois', section: 'p2', ordre: 4, titre: 'Trois', type: 'video', bunny_video_id: VIDEO, duree_s: 60, statut: 'publie' },
  ],
})
const fichierB = (lecons = []) => ({
  module: { slug: B, titre: 'Essai arbre B', ordre: 9999, parcours: 'essai', statut: 'publie', auteur: 'brice' },
  offres: [],
  sections: [{ cle: 'b1', ordre: 1, titre: 'Intro B' }],
  lecons: [
    { slug: 'un', section: 'b1', ordre: 1, titre: 'Un de B', type: 'texte', contenu: 'B.', statut: 'publie' },
    { slug: 'autre', section: 'b1', ordre: 2, titre: 'Autre', type: 'texte', contenu: 'Autre.', statut: 'publie' },
    ...lecons,
  ],
})

/** Les lecons d'un module de test : slug -> place et marques. */
async function lecons(tx, moduleId) {
  const lignes = await tx.$queryRawUnsafe(`
    select l.id::text as id, l.slug, l.ordre, s.titre as section, l.statut, l.deplace_le is not null as deplace,
           l.statut_le is not null as statut_modifie, l.origine_slug
      from public.academie_lecons l left join public.academie_sections s on s.id = l.section_id
     where l.module_id = $1::uuid order by l.ordre, l.slug`, moduleId)
  return Object.fromEntries(lignes.map(x => [x.slug, x]))
}
const historique = (tx, id) => tx.$queryRawUnsafe(
  `select cible, champ, par::text as par, origine from public.academie_editions where cible_id = $1::uuid order by le, origine, champ`, id)
/** L'ordre d'affichage d'un module (le meme calcul que l'ecran et le site) : ids, ordres strictement croissants. */
async function affichage(tx, moduleId) {
  const arbre = await lireArbre(tx)
  const suite = conteneursDuModule(arbre, moduleId).flatMap(c => c.lecons)
  for (let i = 1; i < suite.length; i++) assert.ok(suite[i].ordre > suite[i - 1].ordre, 'ordres du module non croissants')
  return suite.map(l => l.slug)
}

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '30s'`)

    // 1. La migration.
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    assert.equal(await colonnesArbre(tx), 8)
    const [{ ecarts }] = await tx.$queryRawUnsafe(`select count(*)::int as ecarts from public.academie_sections where ordre_fichier is distinct from ordre`)
    assert.equal(ecarts, 0)
    const [{ sections }] = await tx.$queryRawUnsafe(`select count(*)::int as sections from public.academie_sections`)
    ok(`migration jouee (${ordres.length} ordres) : 8 colonnes, ordre_fichier = ordre pour les ${sections} sections existantes`)

    // 2. Deux modules de test.
    await importerModule(tx, fichierA(), dossier)
    await importerModule(tx, fichierB(), dossier)
    const idDe = async (slug) => (await tx.$queryRawUnsafe(`select id::text as id from public.academie_modules where slug = $1`, slug))[0].id
    const mA = await idDe(A)
    const mB = await idDe(B)
    let la = await lecons(tx, mA)
    let lb = await lecons(tx, mB)
    const sectionDe = async (moduleId, titre) => (await tx.$queryRawUnsafe(
      `select id::text as id from public.academie_sections where module_id = $1::uuid and titre = $2`, moduleId, titre))[0].id
    const [p1, p2, b1] = [await sectionDe(mA, 'Partie 1'), await sectionDe(mA, 'Partie 2'), await sectionDe(mB, 'Intro B')]
    ok('modules de test importes (A : 4 lecons, 2 sections ; B : 2 lecons)')

    // 3. Les gestes, comme la route.
    const un = la.un.id
    const g1 = await executerGeste(tx, ADMIN, { action: 'deplacer_lecons', ids: [un], module: mB, section: b1, avant: lb.autre.id })
    assert.equal(g1.issue, 'ok')
    assert.deepEqual(g1.renommees, [{ id: un, avant: 'un', apres: 'un-2' }])
    lb = await lecons(tx, mB)
    assert.deepEqual({ ...lb['un-2'], id: undefined }, { id: undefined, slug: 'un-2', ordre: 2, section: 'Intro B', statut: 'publie', deplace: true, statut_modifie: false, origine_slug: 'un' })
    assert.deepEqual(await affichage(tx, mB), ['un', 'un-2', 'autre'])
    assert.deepEqual(await affichage(tx, mA), ['intro', 'deux', 'trois'])
    const h1 = await historique(tx, un)
    assert.deepEqual(h1, [{ cible: 'lecon', champ: 'position', par: ADMIN, origine: 'app' }])
    ok('une lecon passe dans l AUTRE module : slug un-2 (pris), origine notee, ordre recalcule, historique (par l admin)')

    la = await lecons(tx, mA)
    await executerGeste(tx, ADMIN, { action: 'deplacer_lecons', ids: [la.trois.id], module: mA, section: p1, avant: la.deux.id })
    assert.deepEqual(await affichage(tx, mA), ['intro', 'trois', 'deux'])
    await executerGeste(tx, ADMIN, { action: 'deplacer_lecons', ids: [la.trois.id], module: mA, section: p2, avant: null })
    const g3 = await executerGeste(tx, ADMIN, { action: 'deplacer_section', id: p2, avant: p1 })
    assert.equal(g3.issue, 'ok')
    assert.deepEqual(await affichage(tx, mA), ['intro', 'trois', 'deux'])
    const [secP2] = await tx.$queryRawUnsafe(`select ordre, ordre_fichier, deplace_le is not null as deplace from public.academie_sections where id = $1::uuid`, p2)
    assert.deepEqual({ fichier: secP2.ordre_fichier, deplace: secP2.deplace }, { fichier: 2, deplace: true })
    ok('reordonner dans le module, puis les sections : l ordre des lecons suit l affichage, ordre_fichier ne bouge pas')

    la = await lecons(tx, mA)
    const g4 = await executerGeste(tx, ADMIN, { action: 'statut', cible: 'lecon', ids: [la.deux.id], statut: 'brouillon' })
    const g5 = await executerGeste(tx, ADMIN, { action: 'statut', cible: 'module', ids: [mB], statut: 'brouillon' })
    assert.deepEqual([g4.modifies, g5.modifies], [1, 1])
    const g6 = await executerGeste(tx, ADMIN, { action: 'creer_section', module: mB, titre: 'Bonus' })
    const [bonus] = await tx.$queryRawUnsafe(`select ordre, ordre_fichier from public.academie_sections where id = $1::uuid`, g6.section)
    assert.deepEqual(bonus, { ordre: 2, ordre_fichier: null })
    assert.deepEqual((await historique(tx, g6.section)).map(h => `${h.cible}:${h.champ}`), ['section:creation'])
    assert.deepEqual(await executerGeste(tx, ADMIN, { action: 'deplacer_lecons', ids: [un], module: mA, section: b1, avant: null }), { issue: 'cible' })
    ok('cacher une lecon et un module, creer une section (ordre_fichier vide) ; section d un autre module refusee')

    // 4. L'importeur relance.
    const placesA = await lecons(tx, mA)
    const r1 = await importerModule(tx, fichierA(), dossier)
    la = await lecons(tx, mA)
    assert.equal(la.un, undefined, 'la lecon deplacee a ete ramenee ou recreee dans A')
    const [{ n: copies }] = await tx.$queryRawUnsafe(`select count(*)::int as n from public.academie_lecons where module_id = $1::uuid and slug = 'un'`, mA)
    assert.equal(copies, 0)
    assert.ok(r1.places_gardees.includes('lecon un (dans un autre module, slug un-2)'), JSON.stringify(r1.places_gardees))
    assert.deepEqual(r1.statuts_gardes, ['lecon deux (brouillon)'])
    assert.deepEqual(Object.fromEntries(Object.values(la).map(x => [x.slug, x.ordre])), Object.fromEntries(Object.values(placesA).map(x => [x.slug, x.ordre])))
    assert.equal(la.deux.statut, 'brouillon')
    assert.deepEqual(await affichage(tx, mA), ['intro', 'trois', 'deux'])
    const [secP2b] = await tx.$queryRawUnsafe(`select ordre from public.academie_sections where id = $1::uuid`, p2)
    assert.equal(secP2b.ordre, secP2.ordre)
    const r2 = await importerModule(tx, fichierB(), dossier)
    assert.ok(r2.statuts_gardes.includes(`module ${B} (brouillon)`), JSON.stringify(r2.statuts_gardes))
    const [bonus2] = await tx.$queryRawUnsafe(`select titre, ordre_fichier from public.academie_sections where id = $1::uuid`, g6.section)
    assert.deepEqual(bonus2, { titre: 'Bonus', ordre_fichier: null })
    assert.deepEqual(await affichage(tx, mB), ['un', 'un-2', 'autre'])
    ok('import relance : la lecon deplacee reste dans B (ni ramenee ni recreee), places et statuts du cockpit gardes, section creee intacte')

    await tx.$executeRawUnsafe('savepoint conflit')
    await assert.rejects(importerModule(tx, fichierB([{ slug: 'un-2', section: 'b1', ordre: 3, titre: 'Homonyme', type: 'texte', contenu: 'x', statut: 'publie' }]), dossier),
      /conflit de slug/)
    await tx.$executeRawUnsafe('rollback to savepoint conflit')
    ok('une lecon du fichier au slug d une lecon arrivee d ailleurs : l import s arrete et le dit')

    const r3 = await importerModule(tx, fichierA(), dossier, { ecraserEditions: true })
    la = await lecons(tx, mA)
    assert.deepEqual({ slug: la.un.slug, section: la.un.section, ordre: la.un.ordre, deplace: la.un.deplace, origine: la.un.origine_slug },
      { slug: 'un', section: 'Partie 1', ordre: 2, deplace: false, origine: null })
    assert.equal(la.deux.statut, 'publie')
    assert.deepEqual(await affichage(tx, mA), ['intro', 'un', 'deux', 'trois'])
    assert.ok(r3.rangements_ecrases.includes('lecon un'), JSON.stringify(r3.rangements_ecrases))
    const h3 = await historique(tx, un)
    assert.deepEqual(h3.map(h => `${h.champ}:${h.origine}`), ['position:app', 'position:import'])
    const [{ restes }] = await tx.$queryRawUnsafe(`select count(*)::int as restes from public.academie_lecons where module_id = $1::uuid and deplace_le is not null`, mA)
    assert.equal(restes, 0)
    ok('--ecraser-editions : la lecon revient dans A (slug, section, ordre du fichier), statut du fichier, marques videes, historique import')

    // 5. Les contraintes, et la migration rejouee.
    await doitEchouer(tx, 'contenu sur une section',
      `insert into public.academie_editions (cible, cible_id, champ, par) values ('section', $1::uuid, 'contenu', $2::uuid)`, p1, ADMIN)
    await doitEchouer(tx, 'statut sur une section',
      `insert into public.academie_editions (cible, cible_id, champ, par) values ('section', $1::uuid, 'statut', $2::uuid)`, p1, ADMIN)
    await doitEchouer(tx, 'origine sans slug',
      `update public.academie_lecons set origine_module_id = $1::uuid where id = $2::uuid`, mB, la.intro.id)
    await tx.$executeRawUnsafe(`update public.academie_lecons set origine_module_id = $1::uuid, origine_slug = 'x' where id = $2::uuid`, mB, la.intro.id)
    await doitEchouer(tx, 'deux lecons de la meme origine',
      `update public.academie_lecons set origine_module_id = $1::uuid, origine_slug = 'x' where id = $2::uuid`, mB, la.deux.id)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const [bonus3] = await tx.$queryRawUnsafe(`select ordre_fichier from public.academie_sections where id = $1::uuid`, g6.section)
    assert.equal(bonus3.ordre_fichier, null)
    ok('migration rejouee : la section creee dans l app garde ordre_fichier vide')

    throw new Annulation()
  }, { timeout: 120_000, maxWait: 20_000 })
} catch (err) {
  if (!(err instanceof Annulation)) {
    console.error('\nECHEC (transaction annulee, rien n est reste) :', String(err?.message ?? err).split('\n').slice(-8).join('\n'))
    process.exitCode = 1
  }
}

try {
  assert.equal(await colonnesArbre(prisma), 0)
  const [{ n }] = await prisma.$queryRawUnsafe(`select count(*)::int as n from public.academie_modules where slug in ($1, $2)`, A, B)
  assert.equal(n, 0)
  console.log(`\nTransaction ANNULEE : ni colonnes de l arbre, ni modules de test en base (verifie apres coup). ${etapes} etapes.`)
} catch (err) {
  console.error('ATTENTION : verification apres annulation en echec :', String(err?.message ?? err))
  process.exitCode = 1
}
await prisma.$disconnect()
