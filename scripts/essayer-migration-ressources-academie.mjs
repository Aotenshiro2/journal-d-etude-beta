/**
 * ESSAI de la migration 20261016140000_academie_ressources_protegees.sql (bucket prive des pieces
 * jointes, evenement 'ressource' au journal) contre la vraie base, dans UNE transaction TOUJOURS ANNULEE
 * (rien ne reste), avec les scripts du lot « ressources protegees et alpha » :
 *   1. la migration, jouee DEUX fois (rejouable) ; bucket prive, PDF seulement, 50 Mo ;
 *   2. un objet simule dans le bucket : invisible pour anon et pour authenticated (aucune policy) ;
 *   3. le journal : SQL_NOTER_RESSOURCE (requetes.ts) ecrit, les contraintes refusent le reste ;
 *   4. l'import d'un module de test en sections (importerModule, scripts/importer-catalogue-academie.mjs) :
 *      offres_sections ajoute, puis retire ce qui n'est plus liste, sans toucher aux autres modules ;
 *      cle de section inconnue refusee ; pieces jointes { fichier } et { url } relues par la route ;
 *   5. la regle avec une offre limitee a une section : Live Club = partie 1 seule (partie 2 fermee,
 *      pourcentage sur les lecons accessibles), formation complete = tout ;
 *   6. les acces de l'alpha (donnerAcces, scripts/donner-acces-academie.mjs) : pose sur l'email,
 *      idempotent, retrouve par SQL_ACCES avec l'email verifie, retrait limite au script.
 * Puis la transaction est annulee, et on verifie hors transaction que rien n'est reste (colonne
 * ressource et bucket absents).
 *
 * Verrous : academie_lectures (ajout de colonne et de contraintes) le temps de la transaction, quelques
 * secondes ; lock_timeout de 5 s.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env.local scripts/essayer-migration-ressources-academie.mjs
 * N'affiche aucun email ni aucune cle (emails de test en exemple.invalid).
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PrismaClient } from '@prisma/client'
import * as R from '../src/lib/academie/requetes.ts'
import {
  BUCKET_RESSOURCES, etatLecon, ouvertureLecon, ouvertureModule, ouvertureSection, preparerDroits, progressionDuModule,
  ressourcesPropres,
} from '../src/lib/academie/pur.ts'
import { importerModule } from './importer-catalogue-academie.mjs'
import { donnerAcces, POSE_PAR_ALPHA } from './donner-acces-academie.mjs'

const MIGRATION = new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261016140000_academie_ressources_protegees.sql', import.meta.url)

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

/**
 * Ce que voit un role (anon, authenticated) du bucket : nombre d'objets, ou 'refuse' (le role n'a pas le
 * droit de lire storage.objects). Le changement de role lui-meme doit marcher (sinon l'essai ne prouve rien).
 */
async function vuPar(tx, role) {
  await tx.$executeRawUnsafe('savepoint role')
  try {
    await tx.$executeRawUnsafe(`set local role ${role}`)
    await tx.$queryRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, JSON.stringify({ sub: randomUUID(), role }))
    const [{ moi }] = await tx.$queryRawUnsafe(`select current_user::text as moi`)
    assert.equal(moi, role)
    try {
      const [{ n }] = await tx.$queryRawUnsafe(`select count(*)::int as n from storage.objects where bucket_id = $1`, BUCKET_RESSOURCES)
      return n
    } catch (err) {
      if (!/permission denied/i.test(String(err?.message ?? err))) throw err
      return 'refuse'
    }
  } finally {
    // Annule aussi le « set local role ».
    await tx.$executeRawUnsafe('rollback to savepoint role')
  }
}

const colonneRessource = async (client) => (await client.$queryRawUnsafe(`
  select count(*)::int as n from information_schema.columns
   where table_schema = 'public' and table_name = 'academie_lectures' and column_name = 'ressource'`))[0].n === 1
const bucketExiste = async (client) => (await client.$queryRawUnsafe(
  `select count(*)::int as n from storage.buckets where id = $1`, BUCKET_RESSOURCES))[0].n === 1

if (await colonneRessource(prisma)) {
  console.log('La migration des ressources protegees est DEJA appliquee : rien a essayer.')
  await prisma.$disconnect()
  process.exit(0)
}
assert.equal(await bucketExiste(prisma), false, 'bucket deja present alors que la migration ne l est pas')

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '30s'`)

    // 1. La migration, deux fois.
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    ok(`migration jouee deux fois (${ordres.length} ordres, rejouable)`)
    const [b] = await tx.$queryRawUnsafe(`select public, file_size_limit::bigint::text as limite, allowed_mime_types as types
      from storage.buckets where id = $1`, BUCKET_RESSOURCES)
    assert.deepEqual(b, { public: false, limite: '52428800', types: ['application/pdf'] })
    ok('bucket academie-ressources : PRIVE, 50 Mo, PDF seulement')

    // 2. Un objet simule : invisible hors du serveur.
    await tx.$executeRawUnsafe(`insert into storage.objects (bucket_id, name) values ($1, 'essai/objet-simule.pdf')`, BUCKET_RESSOURCES)
    const policies = await tx.$queryRawUnsafe(`select count(*)::int as n from pg_policies where schemaname = 'storage' and tablename = 'objects'`)
    const anon = await vuPar(tx, 'anon')
    const authentifie = await vuPar(tx, 'authenticated')
    assert.ok(anon === 0 || anon === 'refuse', `anon voit ${anon} objet(s)`)
    assert.ok(authentifie === 0 || authentifie === 'refuse', `authenticated voit ${authentifie} objet(s)`)
    const [{ n: serveur }] = await tx.$queryRawUnsafe(`select count(*)::int as n from storage.objects where bucket_id = $1`, BUCKET_RESSOURCES)
    assert.equal(serveur, 1)
    ok(`objet simule : anon ${anon}, authenticated ${authentifie}, serveur 1 (${policies[0].n} policy sur storage.objects)`)

    // 4. Import d'un module de test en sections.
    const autresAvant = (await tx.$queryRawUnsafe(`select count(*)::int as n from public.academie_offre_contenus`))[0].n
    const videoEssai = 'b03789d3-f998-44ec-8c3c-5d8c5977008c'
    const donnees = (offresSections) => ({
      module: { slug: 'essai-lot-ressources', titre: 'Essai du lot ressources', ordre: 9999, parcours: 'essai', statut: 'publie', auteur: 'brice' },
      offres: ['formation-complete'],
      ...(offresSections === undefined ? {} : { offres_sections: offresSections }),
      sections: [{ cle: 'partie-1', ordre: 1, titre: 'Partie 1' }, { cle: 'partie-2', ordre: 2, titre: 'Partie 2' }],
      lecons: [
        { slug: 'ep-01', ordre: 1, titre: 'Episode 1', section: 'partie-1', type: 'video', bunny_video_id: videoEssai, duree_s: 100,
          contenu: 'Consignes de l exercice.', statut: 'publie',
          ressources: [{ titre: 'Support', fichier: 'essai/ep-01.pdf' }, { titre: 'Workbook', url: '/media/academie/ressources/x.pdf' },
            { titre: 'Piege', fichier: '../hors-bucket.pdf' }] },
        { slug: 'ep-02', ordre: 2, titre: 'Episode 2', section: 'partie-1', type: 'texte', contenu: 'Texte.', statut: 'publie' },
        { slug: 'ep-03', ordre: 3, titre: 'Episode 3', section: 'partie-2', type: 'video', bunny_video_id: videoEssai, duree_s: 100, statut: 'publie' },
      ],
    })
    const dossier = tmpdir()
    const b1 = await importerModule(tx, donnees({ 'live-club': ['partie-1', 'partie-2'] }), dossier)
    assert.deepEqual(b1.offres, ['formation-complete (ajoutee)'])
    assert.deepEqual(b1.offres_sections, ['live-club:partie-1 (ajoutee)', 'live-club:partie-2 (ajoutee)'])
    const b2 = await importerModule(tx, donnees({ 'live-club': ['partie-1'] }), dossier)
    assert.deepEqual(b2.offres_sections, ['live-club:partie-1 (deja la)'])
    assert.equal(b2.offres_sections_retirees, 1)
    assert.equal(b2.offres_retirees, 0)
    const moduleId = (await tx.$queryRawUnsafe(`select id::text as id from public.academie_modules where slug = 'essai-lot-ressources'`))[0].id
    const contenus = await tx.$queryRawUnsafe(`
      select o.slug, s.titre as section from public.academie_offre_contenus c
        join public.academie_offres o on o.id = c.offre_id
        left join public.academie_sections s on s.id = c.section_id
       where c.module_id = $1::uuid order by 1, 2`, moduleId)
    assert.deepEqual(contenus, [{ slug: 'formation-complete', section: null }, { slug: 'live-club', section: 'Partie 1' }])
    const autresApres = (await tx.$queryRawUnsafe(`select count(*)::int as n from public.academie_offre_contenus where module_id <> $1::uuid`, moduleId))[0].n
    assert.equal(autresApres, autresAvant)
    await assert.rejects(importerModule(tx, donnees({ 'live-club': ['partie-9'] }), dossier), /section inconnue/)
    ok('import : offres_sections ajoutees, puis partie 2 retiree, autres modules intacts, cle inconnue refusee')

    const offresModule = (await tx.$queryRawUnsafe(R.SQL_OFFRES_DES_MODULES)).filter(o => o.module_id === moduleId).map(o => `${o.slug}:${o.portee}`)
    assert.deepEqual(offresModule.sort(), ['formation-complete:module', 'live-club:sections'])
    const lecons = await tx.$queryRawUnsafe(`select id::text as id, slug, section_id::text as section_id from public.academie_lecons where module_id = $1::uuid order by ordre`, moduleId)
    const [ep1] = await tx.$queryRawUnsafe(R.SQL_LECON_PAR_ID, lecons[0].id)
    assert.deepEqual(ressourcesPropres(ep1.ressources), [
      { titre: 'Support', fichier: 'essai/ep-01.pdf' }, { titre: 'Workbook', url: '/media/academie/ressources/x.pdf' },
    ])
    assert.equal(ep1.contenu, 'Consignes de l exercice.')
    ok('SQL_OFFRES_DES_MODULES (live-club : sections) ; lecon video : texte et pieces jointes { fichier } et { url } relus, chemin piege ecarte')

    // 3. Le journal (sur la lecon de test).
    const U = randomUUID()
    assert.equal(await tx.$executeRawUnsafe(R.SQL_NOTER_RESSOURCE, U, lecons[0].id, 'essai/ep-01.pdf', '203.0.113.7', 'ordinateur windows chrome'), 1)
    const [ligne] = await tx.$queryRawUnsafe(`select evenement, ressource from public.academie_lectures where user_id = $1::uuid`, U)
    assert.deepEqual(ligne, { evenement: 'ressource', ressource: 'essai/ep-01.pdf' })
    ok('SQL_NOTER_RESSOURCE : ligne ressource au journal, avec le fichier')
    await doitEchouer(tx, 'evenement ressource sans fichier',
      `insert into public.academie_lectures (user_id, lecon_id, evenement) values ($1::uuid, $2::uuid, 'ressource')`, U, lecons[0].id)
    await doitEchouer(tx, 'fichier sur un autre evenement',
      `insert into public.academie_lectures (user_id, lecon_id, evenement, ressource) values ($1::uuid, $2::uuid, 'lien', 'x.pdf')`, U, lecons[0].id)
    await doitEchouer(tx, 'fichier de plus de 300 caracteres',
      `insert into public.academie_lectures (user_id, lecon_id, evenement, ressource) values ($1::uuid, $2::uuid, 'ressource', $3)`,
      U, lecons[0].id, 'a'.repeat(301))
    await doitEchouer(tx, 'evenement inconnu',
      `insert into public.academie_lectures (user_id, lecon_id, evenement) values ($1::uuid, $2::uuid, 'telechargement')`, U, lecons[0].id)

    // 5. La regle avec une offre limitee a une section.
    const versRegle = (lignes) => lignes.map(l => ({
      origine: l.origine, source: l.source, slug: l.slug, ouvreTout: l.ouvre_tout, moduleId: l.module_id, sectionId: l.section_id,
    }))
    const pourLecon = (l) => ({ moduleId, sectionId: l.section_id, usage: 'interne', apercu: false })
    const juger = (droits) => lecons.map(l => ouvertureLecon(droits, pourLecon(l)).acces)
    const sansAcces = await tx.$queryRawUnsafe(R.SQL_ACCES, U, [])
    const membreLc = preparerDroits({ admin: false, etm: false, liveClub: 'oui', secoursEssai: false, lignes: versRegle(sansAcces) })
    assert.deepEqual(juger(membreLc), ['ouvert', 'ouvert', 'ferme'])
    const partie2 = lecons[2].section_id
    assert.equal(ouvertureSection(membreLc, { id: partie2, moduleId }).acces, 'ferme')
    assert.equal(ouvertureModule(membreLc, moduleId, lecons.map(l => ouvertureLecon(membreLc, pourLecon(l)))).acces, 'partiel')
    // Partie 1 vue en entier : 100 % pour le membre du Live Club, 67 % pour la formation complete.
    const etats = ['vu', 'vu', 'non_vu']
    const suivi = (droits) => progressionDuModule(lecons.map((l, i) => ({ acces: ouvertureLecon(droits, pourLecon(l)).acces, etat: etats[i] })))
    assert.equal(suivi(membreLc).pourcentage, 100)
    assert.equal(suivi(membreLc).accessibles, 2)
    const exMembre = preparerDroits({ admin: false, etm: false, liveClub: 'non', secoursEssai: false, lignes: versRegle(sansAcces) })
    assert.deepEqual(juger(exMembre), ['ferme', 'ferme', 'ferme'])
    ok('regle : Live Club = partie 1 seule (partie 2 fermee, module partiel, 100 % sur les accessibles) ; Live Club arrete = rien')

    // 6. Les acces de l'alpha.
    const E1 = `alpha-1-${U.slice(0, 8)}@exemple.invalid`
    const E2 = `alpha-2-${U.slice(0, 8)}@exemple.invalid`
    const lignesCsv = [
      { numero: 1, email: E1, offre: 'formation-complete', source: 'offert', note: 'essai' },
      { numero: 2, email: E2, offre: 'formation-complete', source: 'offert', note: null },
    ]
    const pose = await donnerAcces(tx, lignesCsv)
    assert.equal(pose.posees, 2)
    assert.deepEqual(pose.comptes, { comptes_verifies: 0, comptes_non_verifies: 0, sans_compte: 2 })
    const repose = await donnerAcces(tx, lignesCsv)
    assert.equal(repose.posees, 0)
    assert.equal(repose.deja_la, 2)
    const [poseLigne] = await tx.$queryRawUnsafe(`select user_id, source, pose_par from public.academie_acces where email = $1`, E1)
    assert.deepEqual(poseLigne, { user_id: null, source: 'offert', pose_par: POSE_PAR_ALPHA })
    const inconnue = await donnerAcces(tx, [{ numero: 3, email: E1, offre: 'offre-qui-n-existe-pas', source: 'offert', note: null }])
    assert.deepEqual(inconnue.offres_inconnues, { 'offre-qui-n-existe-pas': 1 })
    ok('alpha : 2 acces poses sur l email, relance = 0 pose (2 deja la), offre inconnue comptee')

    const avecAcces = await tx.$queryRawUnsafe(R.SQL_ACCES, randomUUID(), [E1])
    const eleve = preparerDroits({ admin: false, etm: false, liveClub: 'non', secoursEssai: false, lignes: versRegle(avecAcces) })
    assert.deepEqual(juger(eleve), ['ouvert', 'ouvert', 'ouvert'])
    assert.deepEqual(ouvertureLecon(eleve, pourLecon(lecons[2])).raisons, ['offert'])
    assert.equal(suivi(eleve).pourcentage, 67)
    ok('alpha : SQL_ACCES retrouve l acces par l email verifie, formation complete = tout le module (raison offert, 67 %)')

    const retrait = await donnerAcces(tx, [lignesCsv[1]], { retirer: true })
    assert.equal(retrait.retirees, 1)
    const reretrait = await donnerAcces(tx, [lignesCsv[1]], { retirer: true })
    assert.equal(reretrait.absentes, 1)
    // Un acces pose autrement (achat) ne se retire pas par le script.
    const offreFc = (await tx.$queryRawUnsafe(`select id::text as id from public.academie_offres where slug = 'formation-complete'`))[0].id
    await tx.$executeRawUnsafe(`insert into public.academie_acces (email, offre_id, source, pose_par) values ($1, $2::uuid, 'paypal', 'paypal')`, E2, offreFc)
    assert.equal((await donnerAcces(tx, [lignesCsv[1]], { retirer: true })).retirees, 0)
    const etatE2 = await tx.$queryRawUnsafe(`select source, retire_le is not null as retire from public.academie_acces where email = $1 order by source`, E2)
    assert.deepEqual(etatE2, [{ source: 'offert', retire: true }, { source: 'paypal', retire: false }])
    const sansE2 = await tx.$queryRawUnsafe(R.SQL_ACCES, randomUUID(), [E2])
    assert.ok(sansE2.some(l => l.origine === 'acces' && l.source === 'paypal'))
    assert.ok(!sansE2.some(l => l.origine === 'acces' && l.source === 'offert'))
    ok('alpha : retrait (1 retire, relance = 0), un achat du meme email n est pas touche')

    assert.equal(etatLecon(null), 'non_vu')
    throw new Annulation()
  }, { timeout: 120_000, maxWait: 20_000 })
} catch (err) {
  if (!(err instanceof Annulation)) {
    console.error('\nECHEC (transaction annulee, rien n est reste) :', String(err?.message ?? err).split('\n').slice(-8).join('\n'))
    process.exitCode = 1
  }
}

try {
  assert.equal(await colonneRessource(prisma), false)
  assert.equal(await bucketExiste(prisma), false)
  console.log(`\nTransaction ANNULEE : ni colonne ressource ni bucket ${BUCKET_RESSOURCES} en base (verifie apres coup). ${etapes} etapes.`)
} catch (err) {
  console.error('ATTENTION : verification apres annulation en echec :', String(err?.message ?? err))
  process.exitCode = 1
}
await prisma.$disconnect()
