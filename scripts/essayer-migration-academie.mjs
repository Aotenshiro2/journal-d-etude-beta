/**
 * ESSAI de la migration de l'academie contre la vraie base, dans UNE
 * transaction TOUJOURS ANNULEE (rien ne reste) : 20261015210000_academie_tables.sql.
 *
 * Dans la transaction :
 *   1. la migration, ordre par ordre (meme decoupage que appliquer-migration.mjs) ;
 *   2. RLS active et forcee, aucun droit pour anon et authenticated, donnees de depart ;
 *   3. les contraintes refusent ce qu'elles doivent refuser (dans des savepoints) ;
 *   4. les requetes EXACTES des routes (src/lib/academie/requetes.ts) sur des
 *      donnees de test (uuid tires au hasard, emails en exemple.invalid) :
 *      un acces par user_id et un par email verifie remontent, un acces par
 *      email NON verifie, retire, expire ou futur ne remonte pas ; la regle
 *      (pur.ts) ouvre l'essai a l'acheteur et le ferme a l'autre ; lien,
 *      signal (verrou optimiste), connexion (une par 30 min), progression.
 * Puis la transaction est annulee, et on verifie hors transaction que les
 * tables n'existent toujours pas.
 *
 * Verrous : la migration ne cree que des tables neuves, sans cle etrangere
 * vers une table existante ; lock_timeout de 5 s par prudence.
 *
 * Lancement (depuis apps/journal-d-etude, avec le .env charge) :
 *   node scripts/essayer-migration-academie.mjs
 * N'affiche aucun email ni aucune cle.
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import * as R from '../src/lib/academie/requetes.ts'
import { ouvertureLecon, preparerDroits } from '../src/lib/academie/pur.ts'

const FICHIER = new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261015210000_academie_tables.sql', import.meta.url)
const TABLES = [
  'academie_modules', 'academie_sections', 'academie_lecons', 'academie_offres',
  'academie_offre_contenus', 'academie_acces', 'academie_progression', 'academie_lectures',
]

// --- Decoupage : copie de appliquer-migration.mjs -------------------------
const sansCommentaires = readFileSync(FICHIER, 'utf8')
  .split('\n')
  .filter((ligne) => !ligne.trim().startsWith('--'))
  .join('\n')

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

const ordres = decouper(sansCommentaires)
console.log(`${ordres.length} ordre(s) dans la migration.`)

class Annulation extends Error {}

let etapes = 0
const ok = (nom) => { etapes++; console.log(`ok  ${nom}`) }

const prisma = new PrismaClient()

/** Joue un ordre qui DOIT echouer, dans un savepoint, et rend le code SQLSTATE vu dans le message. */
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
  const msg = String(erreur.message ?? erreur)
  const code = /\b(23\d{3})\b/.exec(msg)?.[1] ?? (/violates (\w+)/.exec(msg)?.[1] ?? 'refuse')
  ok(`${nom} : refuse (${code})`)
}

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '30s'`)

    // 1. La migration.
    for (const ordre of ordres) await tx.$executeRawUnsafe(ordre)
    ok(`migration jouee (${ordres.length} ordres)`)

    // 2. RLS, droits, donnees de depart.
    const rls = await tx.$queryRawUnsafe(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1::text[])`, TABLES)
    assert.equal(rls.length, TABLES.length)
    for (const t of rls) assert.ok(t.relrowsecurity && t.relforcerowsecurity, `RLS ${t.relname}`)
    ok('RLS active et forcee sur les 8 tables')

    const grants = await tx.$queryRawUnsafe(`
      select table_name, grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = any($1::text[]) and grantee in ('anon', 'authenticated')`, TABLES)
    assert.deepEqual(grants, [])
    const policies = await tx.$queryRawUnsafe(`select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = any($1::text[])`, TABLES)
    assert.equal(policies[0].n, 0)
    const lectures = await tx.$queryRawUnsafe(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'academie_lectures' and grantee = 'service_role' order by 1`)
    assert.deepEqual(lectures.map(g => g.privilege_type), ['INSERT', 'SELECT'])
    ok('aucun droit ni policy pour anon et authenticated ; journal en ajout seul pour service_role')

    const offres = await tx.$queryRawUnsafe(`select slug, ouvre_tout, canal, prix_eur::float8 as prix from public.academie_offres order by slug`)
    assert.deepEqual(offres.map(o => o.slug), ['compte-gratuit', 'etm', 'formation-complete', 'live-club'])
    assert.equal(offres.find(o => o.slug === 'etm').ouvre_tout, true)
    assert.equal(offres.find(o => o.slug === 'formation-complete').prix, 1999)
    const essai = await tx.$queryRawUnsafe(`
      select l.id::text as id, l.slug, l.bunny_video_id, l.duree_s, l.statut, m.id::text as module_id
        from public.academie_lecons l join public.academie_modules m on m.id = l.module_id
       where m.slug = 'essai' and m.statut = 'publie' order by l.ordre`)
    assert.deepEqual(essai.map(l => l.bunny_video_id), ['b03789d3-f998-44ec-8c3c-5d8c5977008c', 'c4413ef9-44d5-4df6-8387-b633e7882769'])
    assert.deepEqual(essai.map(l => l.duree_s), [2163, 3759])
    const contenusLiveClub = await tx.$queryRawUnsafe(`
      select m.slug, c.section_id from public.academie_offre_contenus c
        join public.academie_offres o on o.id = c.offre_id join public.academie_modules m on m.id = c.module_id
       where o.slug = 'live-club'`)
    assert.deepEqual(contenusLiveClub, [{ slug: 'essai', section_id: null }])
    ok('donnees de depart : 4 offres, module essai publie (2 lecons Bunny), ouvert par l offre Live Club')

    const moduleEssai = essai[0].module_id
    const lecon1 = essai[0].id

    // 3. Contraintes.
    const offreLc = (await tx.$queryRawUnsafe(`select id::text as id from public.academie_offres where slug = 'live-club'`))[0].id
    await doitEchouer(tx, 'acces avec un email en majuscules',
      `insert into public.academie_acces (email, offre_id, source, pose_par) values ('Test@Exemple.invalid', $1::uuid, 'offert', 'essai')`, offreLc)
    await doitEchouer(tx, 'acces sans compte ni email',
      `insert into public.academie_acces (offre_id, source, pose_par) values ($1::uuid, 'offert', 'essai')`, offreLc)
    await doitEchouer(tx, 'acces de source inconnue',
      `insert into public.academie_acces (email, offre_id, source, pose_par) values ('a@exemple.invalid', $1::uuid, 'cadeau', 'essai')`, offreLc)
    await doitEchouer(tx, 'video publiee sans hebergeur',
      `insert into public.academie_lecons (module_id, slug, titre, type, statut) values ($1::uuid, 'x', 'x', 'video', 'publie')`, moduleEssai)
    await doitEchouer(tx, 'texte publie sans contenu',
      `insert into public.academie_lecons (module_id, slug, titre, type, statut) values ($1::uuid, 'y', 'y', 'texte', 'publie')`, moduleEssai)
    await doitEchouer(tx, 'format inconnu',
      `insert into public.academie_lecons (module_id, slug, titre, type, format) values ($1::uuid, 'z', 'z', 'texte', 'podcast')`, moduleEssai)
    await doitEchouer(tx, 'contenu d offre en double (live-club, essai, module entier)',
      `insert into public.academie_offre_contenus (offre_id, module_id) values ($1::uuid, $2::uuid)`, offreLc, moduleEssai)
    await doitEchouer(tx, 'evenement de journal sans lecon',
      `insert into public.academie_lectures (user_id, evenement) values ($1::uuid, 'lien')`, randomUUID())

    // Une section d'un autre module ne peut pas porter une lecon de l'essai.
    const autreModule = (await tx.$queryRawUnsafe(`
      insert into public.academie_modules (slug, titre) values ('test-autre-module', 'Test') returning id::text as id`))[0].id
    const sectionAutre = (await tx.$queryRawUnsafe(`
      insert into public.academie_sections (module_id, titre) values ($1::uuid, 'Partie 1') returning id::text as id`, autreModule))[0].id
    await doitEchouer(tx, 'lecon rattachee a la section d un autre module',
      `insert into public.academie_lecons (module_id, section_id, slug, titre, type) values ($1::uuid, $2::uuid, 's', 's', 'texte')`,
      moduleEssai, sectionAutre)

    // 4. Les requetes des routes.
    const U1 = randomUUID()
    const U2 = randomUUID()
    const EMAIL_VERIFIE = `verifie-${U1.slice(0, 8)}@exemple.invalid`
    const EMAIL_NON_VERIFIE = `non-verifie-${U1.slice(0, 8)}@exemple.invalid`

    const identite = await tx.$queryRawUnsafe(R.SQL_IDENTITE, U1)
    assert.deepEqual(identite, [{ role: null, emails: [] }])
    const cockpit = await tx.$queryRawUnsafe(R.SQL_FAITS_COCKPIT, [EMAIL_VERIFIE])
    assert.deepEqual(cockpit, [{ etm: false, broker_jusquau: null, manuel_jusquau: null, secours_essai: false }])
    const cockpitVide = await tx.$queryRawUnsafe(R.SQL_FAITS_COCKPIT, [])
    assert.equal(cockpitVide[0].etm, false)
    ok('SQL_IDENTITE et SQL_FAITS_COCKPIT s executent (compte et email inconnus : rien)')

    const offreTest = (await tx.$queryRawUnsafe(`
      insert into public.academie_offres (slug, titre, type, canal) values ('test-offre', 'Test', 'module', 'stripe_aok')
      returning id::text as id`))[0].id
    await tx.$executeRawUnsafe(`insert into public.academie_offre_contenus (offre_id, module_id) values ($1::uuid, $2::uuid)`, offreTest, moduleEssai)
    const poser = (champs, valeurs) => tx.$executeRawUnsafe(
      `insert into public.academie_acces (${champs.join(', ')}, offre_id, pose_par) values (${champs.map((_, i) => `$${i + 2}`).join(', ')}, $1::uuid, 'essai')`,
      offreTest, ...valeurs)
    await tx.$executeRawUnsafe(`insert into public.academie_acces (user_id, offre_id, source, pose_par) values ($1::uuid, $2::uuid, 'stripe', 'essai')`, U1, offreTest)
    await poser(['email', 'source'], [EMAIL_VERIFIE, 'paypal'])
    await poser(['email', 'source'], [EMAIL_NON_VERIFIE, 'offert'])
    await tx.$executeRawUnsafe(`insert into public.academie_acces (user_id, offre_id, source, pose_par, retire_le, retire_par) values ($1::uuid, $2::uuid, 'offert', 'essai', now(), 'essai')`, U2, offreTest)
    await tx.$executeRawUnsafe(`insert into public.academie_acces (user_id, offre_id, source, pose_par, debut, fin) values ($1::uuid, $2::uuid, 'offert', 'essai', now() - interval '2 days', now() - interval '1 day')`, U2, offreTest)
    await tx.$executeRawUnsafe(`insert into public.academie_acces (user_id, offre_id, source, pose_par, debut) values ($1::uuid, $2::uuid, 'offert', 'essai', now() + interval '1 day')`, U2, offreTest)

    const lignesU1 = await tx.$queryRawUnsafe(R.SQL_ACCES, U1, [EMAIL_VERIFIE])
    const accesU1 = lignesU1.filter(l => l.origine === 'acces').map(l => l.source).sort()
    assert.deepEqual(accesU1, ['paypal', 'stripe'])
    assert.ok(lignesU1.some(l => l.origine === 'base' && l.slug === 'live-club' && l.module_id === moduleEssai))
    assert.ok(lignesU1.some(l => l.origine === 'base' && l.slug === 'compte-gratuit' && l.module_id === null))
    assert.ok(lignesU1.some(l => l.origine === 'essai' && l.module_id === moduleEssai))
    const lignesU2 = await tx.$queryRawUnsafe(R.SQL_ACCES, U2, [])
    assert.deepEqual(lignesU2.filter(l => l.origine === 'acces'), [])
    ok('SQL_ACCES : user_id et email verifie remontent ; email non verifie, retire, expire, futur : non')

    const versRegle = (lignes) => lignes.map(l => ({
      origine: l.origine, source: l.source, slug: l.slug, ouvreTout: l.ouvre_tout, moduleId: l.module_id, sectionId: l.section_id,
    }))
    const leconEssai = { moduleId: moduleEssai, sectionId: null, usage: 'interne', apercu: false }
    const droitsU1 = preparerDroits({ admin: false, etm: false, liveClub: 'non', secoursEssai: false, lignes: versRegle(lignesU1) })
    const droitsU2 = preparerDroits({ admin: false, etm: false, liveClub: 'non', secoursEssai: false, lignes: versRegle(lignesU2) })
    const droitsU2LiveClub = preparerDroits({ admin: false, etm: false, liveClub: 'oui', secoursEssai: false, lignes: versRegle(lignesU2) })
    assert.deepEqual(ouvertureLecon(droitsU1, leconEssai), { acces: 'ouvert', raisons: ['achat'] })
    assert.deepEqual(ouvertureLecon(droitsU2, leconEssai), { acces: 'ferme', raisons: [] })
    assert.deepEqual(ouvertureLecon(droitsU2LiveClub, leconEssai), { acces: 'ouvert', raisons: ['liveclub'] })
    ok('regle sur les lignes reelles : essai ouvert a l acheteur, ferme sans droit, ouvert par le Live Club')

    const modules = await tx.$queryRawUnsafe(R.SQL_MODULES_VISIBLES)
    assert.ok(modules.some(m => m.slug === 'essai'))
    assert.ok(!modules.some(m => m.slug === 'test-autre-module')) // brouillon : invisible
    const sections = await tx.$queryRawUnsafe(R.SQL_SECTIONS_VISIBLES)
    assert.ok(!sections.some(s => s.id === sectionAutre))
    const lecons = await tx.$queryRawUnsafe(R.SQL_LECONS_VISIBLES)
    assert.equal(lecons.filter(l => l.module_id === moduleEssai).length, 2)
    assert.ok(!('bunny_video_id' in lecons[0]) && !('contenu' in lecons[0]), 'le catalogue ne doit pas porter d identifiant Bunny')
    const parId = await tx.$queryRawUnsafe(R.SQL_LECON_PAR_ID, lecon1)
    assert.equal(parId[0].bunny_bibliotheque, 'formation')
    assert.equal(parId[0].module_statut, 'publie')
    assert.deepEqual(parId[0].ressources, [])
    const parVideo = await tx.$queryRawUnsafe(R.SQL_LECONS_PAR_VIDEO, 'c4413ef9-44d5-4df6-8387-b633e7882769')
    assert.equal(parVideo.length, 1)
    ok('catalogue : modules, sections et lecons visibles (sans identifiant Bunny), lecon par id et par video')

    const lien1 = await tx.$queryRawUnsafe(R.SQL_NOTER_LIEN, U1, lecon1, '203.0.113.7', 'ordinateur windows chrome')
    assert.equal(lien1[0].journalise, 1)
    assert.equal(lien1[0].secondes_vues, 0)
    await tx.$queryRawUnsafe(R.SQL_NOTER_LIEN, U1, lecon1, null, null)
    const sessions = await tx.$queryRawUnsafe(`select nb_sessions from public.academie_progression where user_id = $1::uuid`, U1)
    assert.equal(sessions[0].nb_sessions, 1) // meme session (moins de 30 min)
    ok('SQL_NOTER_LIEN : progression creee, ligne lien au journal, IP en inet, meme session')

    const etat = await tx.$queryRawUnsafe(R.SQL_ETAT_SIGNAL, U1, lecon1)
    assert.equal(etat[0].nb_signaux, 0)
    assert.equal(etat[0].duree_s, 2163)
    assert.ok(etat[0].maintenant instanceof Date)
    const signal = (nbLu) => tx.$queryRawUnsafe(R.SQL_APPLIQUER_SIGNAL,
      U1, lecon1, nbLu, 130, 130, 30, 1, false, null, 'lecture', 30, 130, '203.0.113.7', 'ordinateur windows chrome')
    const premier = await signal(0)
    assert.equal(premier[0].secondes_vues, 30)
    assert.equal(premier[0].journalise, 1)
    const concurrent = await signal(0)
    assert.equal(concurrent.length, 0) // verrou optimiste : le second perd, rien n'est ecrit
    const marque = await tx.$queryRawUnsafe(R.SQL_APPLIQUER_SIGNAL,
      U1, lecon1, 1, 130, 130, 30, 1, true, 'poser', 'vu', null, null, null, null)
    assert.ok(marque[0].marquee_vue_le instanceof Date && marque[0].terminee_le instanceof Date)
    ok('SQL_ETAT_SIGNAL et SQL_APPLIQUER_SIGNAL : signal ecrit, concurrent refuse, marque vu et fin')

    assert.equal(await tx.$executeRawUnsafe(R.SQL_NOTER_CONNEXION, U1, '2001:db8::1', 'mobile ios safari'), 1)
    assert.equal(await tx.$executeRawUnsafe(R.SQL_NOTER_CONNEXION, U1, null, null), 0)
    const progression = await tx.$queryRawUnsafe(R.SQL_PROGRESSION_COMPTE, U1)
    assert.equal(progression.length, 1)
    const journal = await tx.$queryRawUnsafe(`
      select evenement, count(*)::int as n from public.academie_lectures where user_id = $1::uuid group by 1 order by 1`, U1)
    assert.deepEqual(journal, [
      { evenement: 'connexion', n: 1 }, { evenement: 'lecture', n: 1 }, { evenement: 'lien', n: 2 }, { evenement: 'vu', n: 1 },
    ])
    ok('SQL_NOTER_CONNEXION (une par 30 min), SQL_PROGRESSION_COMPTE, journal complet')

    throw new Annulation()
  }, { timeout: 120_000, maxWait: 20_000 })
} catch (err) {
  if (!(err instanceof Annulation)) {
    console.error('\nECHEC (transaction annulee, rien n est reste) :', String(err?.message ?? err).split('\n').slice(-8).join('\n'))
    process.exitCode = 1
  }
}

try {
  const restes = await prisma.$queryRawUnsafe(`
    select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])`, TABLES)
  assert.equal(restes[0].n, 0)
  console.log(`\nTransaction ANNULEE : aucune table academie_* en base (verifie apres coup). ${etapes} etapes.`)
} catch (err) {
  console.error('ATTENTION : verification apres annulation en echec :', String(err?.message ?? err))
  process.exitCode = 1
}
await prisma.$disconnect()
