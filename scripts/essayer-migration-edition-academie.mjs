/**
 * ESSAI de la migration 20261023120000_academie_editions.sql (edition des textes dans l'app par l'admin,
 * 23/10/2026) contre la vraie base, dans UNE transaction TOUJOURS ANNULEE (rien ne reste) :
 *   1. la migration, jouee DEUX fois (rejouable) ; colonnes edite_le, edite_par ; table academie_editions
 *      (RLS forcee, service_role en lecture et ajout seulement, invisible pour anon et authenticated) ;
 *   2. un module de test importe (importerModule, scripts/importer-catalogue-academie.mjs) ;
 *   3. l'edition d'une lecon et d'un module comme la route (SQL_EDITION_* de requetes.ts, planEdition de
 *      pur.ts) : textes ecrits, edite_le et edite_par poses, une ligne d'historique par champ qui change,
 *      version perimee = rien d'ecrit ;
 *   4. l'importeur relance : il GARDE le titre et le texte modifies dans l'app (le reste suit le fichier),
 *      puis --ecraser-editions remet le fichier, vide edite_le et note l'ancienne version (origine import) ;
 *   5. les contraintes de l'historique.
 * Puis la transaction est annulee, et on verifie hors transaction que rien n'est reste.
 *
 * Verrous : academie_modules et academie_lecons (ajout de colonnes) le temps de la transaction, quelques
 * secondes ; lock_timeout de 5 s.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env.local scripts/essayer-migration-edition-academie.mjs
 * N'affiche aucun email ni aucune cle.
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PrismaClient } from '@prisma/client'
import * as R from '../src/lib/academie/requetes.ts'
import { planEdition } from '../src/lib/academie/pur.ts'
import { importerModule } from './importer-catalogue-academie.mjs'

const MIGRATION = new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261023120000_academie_editions.sql', import.meta.url)

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

/** Ce que voit un role de academie_editions : nombre de lignes, ou 'refuse'. */
async function vuPar(tx, role) {
  await tx.$executeRawUnsafe('savepoint role')
  try {
    await tx.$executeRawUnsafe(`set local role ${role}`)
    const [{ moi }] = await tx.$queryRawUnsafe(`select current_user::text as moi`)
    assert.equal(moi, role)
    try {
      const [{ n }] = await tx.$queryRawUnsafe(`select count(*)::int as n from public.academie_editions`)
      return n
    } catch (err) {
      if (!/permission denied/i.test(String(err?.message ?? err))) throw err
      return 'refuse'
    }
  } finally {
    await tx.$executeRawUnsafe('rollback to savepoint role')
  }
}

const tableEditions = async (client) => (await client.$queryRawUnsafe(
  `select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'academie_editions'`))[0].n === 1
const colonnesEdite = async (client) => (await client.$queryRawUnsafe(`
  select count(*)::int as n from information_schema.columns
   where table_schema = 'public' and table_name in ('academie_modules', 'academie_lecons') and column_name in ('edite_le', 'edite_par')`))[0].n

if (await tableEditions(prisma)) {
  console.log('La migration des editions est DEJA appliquee : rien a essayer.')
  await prisma.$disconnect()
  process.exit(0)
}
assert.equal(await colonnesEdite(prisma), 0, 'colonnes edite_* deja presentes alors que la table ne l est pas')

const ADMIN = randomUUID()
const lignesHistorique = (tx, id) => tx.$queryRawUnsafe(
  `select champ, avant, apres, par::text as par, origine from public.academie_editions where cible_id = $1::uuid order by le, origine, champ`, id)

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '30s'`)

    // 1. La migration, deux fois.
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    ok(`migration jouee deux fois (${ordres.length} ordres, rejouable)`)
    assert.equal(await colonnesEdite(tx), 4)
    const [rls] = await tx.$queryRawUnsafe(`select relrowsecurity as rls, relforcerowsecurity as force from pg_class where oid = 'public.academie_editions'::regclass`)
    assert.deepEqual(rls, { rls: true, force: true })
    const [privs] = await tx.$queryRawUnsafe(`select
        has_table_privilege('service_role', 'public.academie_editions', 'SELECT') as sr_lire,
        has_table_privilege('service_role', 'public.academie_editions', 'INSERT') as sr_ajouter,
        has_table_privilege('service_role', 'public.academie_editions', 'UPDATE') as sr_modifier,
        has_table_privilege('service_role', 'public.academie_editions', 'DELETE') as sr_supprimer,
        has_table_privilege('anon', 'public.academie_editions', 'SELECT') as anon_lire,
        has_table_privilege('authenticated', 'public.academie_editions', 'SELECT') as auth_lire`)
    assert.deepEqual(privs, { sr_lire: true, sr_ajouter: true, sr_modifier: false, sr_supprimer: false, anon_lire: false, auth_lire: false })
    ok('colonnes edite_le, edite_par (modules, lecons) ; academie_editions : RLS forcee, service_role lecture + ajout seulement')

    // 2. Un module de test.
    const donnees = (ordreTexte = 1) => ({
      module: { slug: 'essai-lot-edition', titre: 'Essai du lot edition', resume: 'Resume du fichier.', ordre: 9999, parcours: 'essai', statut: 'publie', auteur: 'brice' },
      offres: [],
      lecons: [
        { slug: 'texte', ordre: ordreTexte, titre: 'Titre du fichier', type: 'texte', contenu: 'Texte du fichier.', statut: 'publie' },
        { slug: 'video', ordre: 2, titre: 'Video du fichier', type: 'video', bunny_video_id: 'b03789d3-f998-44ec-8c3c-5d8c5977008c', duree_s: 100,
          contenu: 'Consignes du fichier.', statut: 'publie' },
      ],
    })
    const dossier = tmpdir()
    const b0 = await importerModule(tx, donnees(), dossier)
    assert.deepEqual(b0.gardees, [])
    const moduleId = (await tx.$queryRawUnsafe(`select id::text as id from public.academie_modules where slug = 'essai-lot-edition'`))[0].id
    const leconId = (await tx.$queryRawUnsafe(`select id::text as id from public.academie_lecons where module_id = $1::uuid and slug = 'texte'`, moduleId))[0].id
    ok('module de test importe (2 lecons), rien de garde')

    // 3. L'edition, comme la route.
    const [lu] = await tx.$queryRawUnsafe(R.SQL_EDITION_LIRE_LECON, leconId)
    assert.equal(lu.edite_le, null)
    assert.ok(typeof lu.version === 'string' && lu.version.length > 10)
    const plan = planEdition({ textes: { titre: lu.titre, contenu: lu.contenu }, type: lu.type, statut: lu.statut },
      { champs: { titre: 'Titre corrige dans l app', contenu: 'Texte corrige dans l app.' } })
    assert.equal(plan.ok, true)
    // Version perimee (la lecon a bouge depuis l'ouverture de l'editeur) : rien d'ecrit.
    const perime = await tx.$queryRawUnsafe(R.SQL_EDITION_ECRIRE_LECON, leconId, '2000-01-01 00:00:00+00',
      plan.valeurs.titre, plan.valeurs.contenu, ADMIN, JSON.stringify(plan.historique))
    assert.equal(perime.length, 0)
    assert.equal((await lignesHistorique(tx, leconId)).length, 0)
    const [ecrit] = await tx.$queryRawUnsafe(R.SQL_EDITION_ECRIRE_LECON, leconId, lu.version,
      plan.valeurs.titre, plan.valeurs.contenu, ADMIN, JSON.stringify(plan.historique))
    assert.equal(ecrit.titre, 'Titre corrige dans l app')
    assert.equal(ecrit.contenu, 'Texte corrige dans l app.')
    assert.equal(ecrit.historique, 2)
    assert.ok(ecrit.edite_le instanceof Date)
    const [marque] = await tx.$queryRawUnsafe(`select edite_par::text as par, edite_le is not null as edite from public.academie_lecons where id = $1::uuid`, leconId)
    assert.deepEqual(marque, { par: ADMIN, edite: true })
    assert.deepEqual(await lignesHistorique(tx, leconId), [
      { champ: 'contenu', avant: 'Texte du fichier.', apres: 'Texte corrige dans l app.', par: ADMIN, origine: 'app' },
      { champ: 'titre', avant: 'Titre du fichier', apres: 'Titre corrige dans l app', par: ADMIN, origine: 'app' },
    ])
    ok('lecon : version perimee = rien d ecrit ; puis titre et texte ecrits, edite_le et edite_par poses, 2 lignes d historique')

    const [lm] = await tx.$queryRawUnsafe(R.SQL_EDITION_LIRE_MODULE, moduleId)
    const planM = planEdition({ textes: { titre: lm.titre, resume: lm.resume } }, { champs: { resume: 'Resume corrige.' } })
    const [ecritM] = await tx.$queryRawUnsafe(R.SQL_EDITION_ECRIRE_MODULE, moduleId, lm.version,
      planM.valeurs.titre, planM.valeurs.resume, ADMIN, JSON.stringify(planM.historique))
    assert.deepEqual({ titre: ecritM.titre, resume: ecritM.resume, historique: ecritM.historique },
      { titre: 'Essai du lot edition', resume: 'Resume corrige.', historique: 1 })
    assert.deepEqual(await lignesHistorique(tx, moduleId), [
      { champ: 'resume', avant: 'Resume du fichier.', apres: 'Resume corrige.', par: ADMIN, origine: 'app' },
    ])
    ok('module : resume ecrit, titre inchange, 1 ligne d historique')

    // 4. L'importeur relance (la lecon change aussi d'ordre dans le fichier).
    const b1 = await importerModule(tx, donnees(5), dossier)
    assert.deepEqual(b1.gardees, ['module essai-lot-edition (titre et resume)', 'lecon texte (titre et texte)'])
    assert.deepEqual(b1.editions_ecrasees, [])
    const [apres1] = await tx.$queryRawUnsafe(`select titre, contenu, ordre, edite_le is not null as edite from public.academie_lecons where id = $1::uuid`, leconId)
    assert.deepEqual(apres1, { titre: 'Titre corrige dans l app', contenu: 'Texte corrige dans l app.', ordre: 5, edite: true })
    const [mod1] = await tx.$queryRawUnsafe(`select resume, edite_le is not null as edite from public.academie_modules where id = $1::uuid`, moduleId)
    assert.deepEqual(mod1, { resume: 'Resume corrige.', edite: true })
    const [video1] = await tx.$queryRawUnsafe(`select titre, edite_le is null as jamais from public.academie_lecons where module_id = $1::uuid and slug = 'video'`, moduleId)
    assert.deepEqual(video1, { titre: 'Video du fichier', jamais: true })
    ok('import relance : titre et texte modifies dans l app GARDES (bilan « garde »), l ordre suit le fichier, la video non modifiee suit le fichier')

    const b2 = await importerModule(tx, donnees(5), dossier, { ecraserEditions: true })
    assert.deepEqual(b2.gardees, [])
    assert.deepEqual(b2.editions_ecrasees, ['module essai-lot-edition', 'lecon texte'])
    const [apres2] = await tx.$queryRawUnsafe(`select titre, contenu, edite_le is null as libre, edite_par is null as sans_auteur from public.academie_lecons where id = $1::uuid`, leconId)
    assert.deepEqual(apres2, { titre: 'Titre du fichier', contenu: 'Texte du fichier.', libre: true, sans_auteur: true })
    const histoLecon = await lignesHistorique(tx, leconId)
    assert.deepEqual(histoLecon.filter(h => h.origine === 'import'), [
      { champ: 'contenu', avant: 'Texte corrige dans l app.', apres: 'Texte du fichier.', par: null, origine: 'import' },
      { champ: 'titre', avant: 'Titre corrige dans l app', apres: 'Titre du fichier', par: null, origine: 'import' },
    ])
    const [mod2] = await tx.$queryRawUnsafe(`select resume, edite_le is null as libre from public.academie_modules where id = $1::uuid`, moduleId)
    assert.deepEqual(mod2, { resume: 'Resume du fichier.', libre: true })
    const b3 = await importerModule(tx, donnees(5), dossier)
    assert.deepEqual(b3.gardees, [])
    ok('--ecraser-editions : le fichier l emporte, edite_le vide, l ancienne version notee (origine import) ; relance = rien de garde')

    // 5. Les contraintes de l'historique, et qui le voit.
    await doitEchouer(tx, 'resume sur une lecon',
      `insert into public.academie_editions (cible, cible_id, champ, par) values ('lecon', $1::uuid, 'resume', $2::uuid)`, leconId, ADMIN)
    await doitEchouer(tx, 'contenu sur un module',
      `insert into public.academie_editions (cible, cible_id, champ, par) values ('module', $1::uuid, 'contenu', $2::uuid)`, moduleId, ADMIN)
    await doitEchouer(tx, 'cible inconnue',
      `insert into public.academie_editions (cible, cible_id, champ, par) values ('section', $1::uuid, 'titre', $2::uuid)`, moduleId, ADMIN)
    await doitEchouer(tx, 'edition de l app sans auteur',
      `insert into public.academie_editions (cible, cible_id, champ) values ('lecon', $1::uuid, 'titre')`, leconId)
    await doitEchouer(tx, 'origine inconnue',
      `insert into public.academie_editions (cible, cible_id, champ, origine) values ('lecon', $1::uuid, 'titre', 'cockpit')`, leconId)
    const anon = await vuPar(tx, 'anon')
    const authentifie = await vuPar(tx, 'authenticated')
    assert.equal(anon, 'refuse')
    assert.equal(authentifie, 'refuse')
    ok(`historique : anon ${anon}, authenticated ${authentifie}`)

    throw new Annulation()
  }, { timeout: 120_000, maxWait: 20_000 })
} catch (err) {
  if (!(err instanceof Annulation)) {
    console.error('\nECHEC (transaction annulee, rien n est reste) :', String(err?.message ?? err).split('\n').slice(-8).join('\n'))
    process.exitCode = 1
  }
}

try {
  assert.equal(await tableEditions(prisma), false)
  assert.equal(await colonnesEdite(prisma), 0)
  const [{ n }] = await prisma.$queryRawUnsafe(`select count(*)::int as n from public.academie_modules where slug = 'essai-lot-edition'`)
  assert.equal(n, 0)
  console.log(`\nTransaction ANNULEE : ni table academie_editions, ni colonnes edite_*, ni module de test en base (verifie apres coup). ${etapes} etapes.`)
} catch (err) {
  console.error('ATTENTION : verification apres annulation en echec :', String(err?.message ?? err))
  process.exitCode = 1
}
await prisma.$disconnect()
