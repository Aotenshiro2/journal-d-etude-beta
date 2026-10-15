/**
 * ESSAI des migrations de l'academie contre la vraie base, dans UNE
 * transaction TOUJOURS ANNULEE (rien ne reste) :
 *   - 20261015210000_academie_tables.sql (jouee seulement si les tables
 *     n'existent pas encore ; en production depuis le 15/10) ;
 *   - 20261016110000_academie_etats_vu.sql (quatre etats, « vu » a 60 %,
 *     evenement texte_fin).
 *
 * Dans la transaction :
 *   1. les migrations, ordre par ordre (meme decoupage que appliquer-migration.mjs) ;
 *      si la base est jouee ici : RLS, droits et donnees de depart ;
 *   2. la reprise des lignes existantes par la migration des etats (lignes
 *      de test posees AVANT elle : clic, fin mesuree, 60 % deja regardes, rien) ;
 *   3. les contraintes refusent ce qu'elles doivent refuser (dans des savepoints) ;
 *   4. les requetes EXACTES des routes (src/lib/academie/requetes.ts) sur des
 *      donnees de test (uuid tires au hasard, emails en exemple.invalid) :
 *      acces par user_id et par email verifie oui, email NON verifie,
 *      retire, expire ou futur non ; regle (pur.ts) ; catalogue avec prix
 *      et offres par module ; lien = etat 'ouvert' ; signaux (verrou
 *      optimiste), vu, non_vu (la preuve terminee_le reste), texte_fin ;
 *      connexion (une par 30 min) ; progression.
 * Puis la transaction est annulee, et on verifie hors transaction que rien
 * n'est reste (colonne vu_le absente, ou tables absentes).
 *
 * Verrous : la migration des etats modifie academie_progression et
 * academie_lectures (verrou exclusif le temps de la transaction, quelques
 * secondes : les routes de l'academie attendent pendant ce temps) ;
 * lock_timeout de 5 s par prudence.
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
import { etatLecon, ouvertureLecon, preparerDroits } from '../src/lib/academie/pur.ts'

const DOSSIER = '../../../sites/Aoknowledgecom/supabase/migrations/'
const BASE = new URL(`${DOSSIER}20261015210000_academie_tables.sql`, import.meta.url)
const ETATS = new URL(`${DOSSIER}20261016110000_academie_etats_vu.sql`, import.meta.url)
const TABLES = [
  'academie_modules', 'academie_sections', 'academie_lecons', 'academie_offres',
  'academie_offre_contenus', 'academie_acces', 'academie_progression', 'academie_lectures',
]

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
const ordresDe = (fichier) => decouper(readFileSync(fichier, 'utf8')
  .split('\n')
  .filter((ligne) => !ligne.trim().startsWith('--'))
  .join('\n'))

class Annulation extends Error {}

let etapes = 0
const ok = (nom) => { etapes++; console.log(`ok  ${nom}`) }

const prisma = new PrismaClient()

/** Joue un ordre qui DOIT echouer, dans un savepoint, et dit le code SQLSTATE vu dans le message. */
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
  const code = /\b(23\d{3})\b/.exec(msg)?.[1] ?? 'refuse'
  ok(`${nom} : refuse (${code})`)
}

const existe = async (client, table) => (await client.$queryRawUnsafe(
  `select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = $1`, table))[0].n === 1
const colonneVuLe = async (client) => (await client.$queryRawUnsafe(`
  select count(*)::int as n from information_schema.columns
   where table_schema = 'public' and table_name = 'academie_progression' and column_name = 'vu_le'`))[0].n === 1

const baseEnPlace = await existe(prisma, 'academie_modules')
if (baseEnPlace && await colonneVuLe(prisma)) {
  console.log('La migration des etats est DEJA appliquee : rien a essayer.')
  await prisma.$disconnect()
  process.exit(0)
}
console.log(baseEnPlace ? 'Tables de l academie en place : seule la migration des etats est jouee.'
  : 'Tables de l academie absentes : les deux migrations sont jouees.')

try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '30s'`)

    // 1. La base, si besoin.
    if (!baseEnPlace) {
      const ordres = ordresDe(BASE)
      for (const ordre of ordres) await tx.$executeRawUnsafe(ordre)
      ok(`migration de base jouee (${ordres.length} ordres)`)
      const rls = await tx.$queryRawUnsafe(`
        select c.relname, c.relrowsecurity, c.relforcerowsecurity
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = any($1::text[])`, TABLES)
      assert.equal(rls.length, TABLES.length)
      for (const t of rls) assert.ok(t.relrowsecurity && t.relforcerowsecurity, `RLS ${t.relname}`)
      const grants = await tx.$queryRawUnsafe(`
        select table_name from information_schema.role_table_grants
         where table_schema = 'public' and table_name = any($1::text[]) and grantee in ('anon', 'authenticated')`, TABLES)
      assert.deepEqual(grants, [])
      ok('RLS forcee, aucun droit pour anon et authenticated')
    }

    const essai = await tx.$queryRawUnsafe(`
      select l.id::text as id, l.duree_s, m.id::text as module_id
        from public.academie_lecons l join public.academie_modules m on m.id = l.module_id
       where m.slug = 'essai' order by l.ordre`)
    assert.equal(essai.length, 2)
    const moduleEssai = essai[0].module_id
    const lecon1 = essai[0].id
    assert.equal(essai[0].duree_s, 2163)

    // 2. Lignes posees AVANT la migration des etats, pour verifier sa reprise.
    const [P_CLIC, P_FIN, P_60, P_RIEN] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    const progressionAvant = (user, colonnes, valeurs) => tx.$executeRawUnsafe(
      `insert into public.academie_progression (user_id, lecon_id${colonnes}) values ($1::uuid, $2::uuid${valeurs})`, user, lecon1)
    await progressionAvant(P_CLIC, ', marquee_vue_le, secondes_vues', `, now() - interval '1 hour', 10`)
    await progressionAvant(P_FIN, ', terminee_le, secondes_vues', `, now() - interval '2 hours', 2000`)
    await progressionAvant(P_60, ', secondes_vues', ', 1300') // 1300 >= 0.6 x 2163 = 1297,8
    await progressionAvant(P_RIEN, ', secondes_vues', ', 1297')

    const ordresEtats = ordresDe(ETATS)
    for (const ordre of ordresEtats) await tx.$executeRawUnsafe(ordre)
    ok(`migration des etats jouee (${ordresEtats.length} ordres)`)

    const reprises = await tx.$queryRawUnsafe(`
      select user_id::text as u, vu_par, vu_le is not null as vu, terminee_le is not null as terminee
        from public.academie_progression where user_id = any($1::uuid[])`, [P_CLIC, P_FIN, P_60, P_RIEN])
    const reprise = (u) => reprises.find(r => r.u === u)
    assert.deepEqual(reprise(P_CLIC), { u: P_CLIC, vu_par: 'eleve', vu: true, terminee: false })
    assert.deepEqual(reprise(P_FIN), { u: P_FIN, vu_par: 'mesure', vu: true, terminee: true })
    assert.deepEqual(reprise(P_60), { u: P_60, vu_par: 'mesure', vu: true, terminee: true })
    assert.deepEqual(reprise(P_RIEN), { u: P_RIEN, vu_par: null, vu: false, terminee: false })
    ok('reprise : clic -> eleve, fin mesuree -> mesure, 60 % deja regardes -> mesure, 59,9 % -> pas vue')

    // 3. Contraintes.
    const offreLc = (await tx.$queryRawUnsafe(`select id::text as id from public.academie_offres where slug = 'live-club'`))[0].id
    await doitEchouer(tx, 'vu_par inconnu',
      `update public.academie_progression set vu_le = now(), vu_par = 'autre' where user_id = $1::uuid`, P_RIEN)
    await doitEchouer(tx, 'vu_le sans vu_par',
      `update public.academie_progression set vu_le = now() where user_id = $1::uuid`, P_RIEN)
    await doitEchouer(tx, 'evenement de journal inconnu',
      `insert into public.academie_lectures (user_id, lecon_id, evenement) values ($1::uuid, $2::uuid, 'avance')`, randomUUID(), lecon1)
    await doitEchouer(tx, 'acces avec un email en majuscules',
      `insert into public.academie_acces (email, offre_id, source, pose_par) values ('Test@Exemple.invalid', $1::uuid, 'offert', 'essai')`, offreLc)
    await doitEchouer(tx, 'video publiee sans hebergeur',
      `insert into public.academie_lecons (module_id, slug, titre, type, statut) values ($1::uuid, 'x', 'x', 'video', 'publie')`, moduleEssai)
    await doitEchouer(tx, 'contenu d offre en double (live-club, essai, module entier)',
      `insert into public.academie_offre_contenus (offre_id, module_id) values ($1::uuid, $2::uuid)`, offreLc, moduleEssai)

    // 4. Les requetes des routes.
    const U1 = randomUUID()
    const U2 = randomUUID()
    const EMAIL_VERIFIE = `verifie-${U1.slice(0, 8)}@exemple.invalid`
    const EMAIL_NON_VERIFIE = `non-verifie-${U1.slice(0, 8)}@exemple.invalid`

    assert.deepEqual(await tx.$queryRawUnsafe(R.SQL_IDENTITE, U1), [{ role: null, emails: [] }])
    assert.deepEqual(await tx.$queryRawUnsafe(R.SQL_FAITS_COCKPIT, [EMAIL_VERIFIE]),
      [{ etm: false, broker_jusquau: null, manuel_jusquau: null, secours_essai: false }])
    ok('SQL_IDENTITE et SQL_FAITS_COCKPIT s executent (compte et email inconnus : rien)')

    const offreTest = (await tx.$queryRawUnsafe(`
      insert into public.academie_offres (slug, titre, type, canal, prix_eur) values ('test-offre', 'Test', 'module', 'stripe_aok', 49)
      returning id::text as id`))[0].id
    await tx.$executeRawUnsafe(`insert into public.academie_offre_contenus (offre_id, module_id) values ($1::uuid, $2::uuid)`, offreTest, moduleEssai)
    const poser = (sql, ...p) => tx.$executeRawUnsafe(sql, offreTest, ...p)
    await poser(`insert into public.academie_acces (user_id, offre_id, source, pose_par) values ($2::uuid, $1::uuid, 'stripe', 'essai')`, U1)
    await poser(`insert into public.academie_acces (email, offre_id, source, pose_par) values ($2, $1::uuid, 'paypal', 'essai')`, EMAIL_VERIFIE)
    await poser(`insert into public.academie_acces (email, offre_id, source, pose_par) values ($2, $1::uuid, 'offert', 'essai')`, EMAIL_NON_VERIFIE)
    await poser(`insert into public.academie_acces (user_id, offre_id, source, pose_par, retire_le, retire_par) values ($2::uuid, $1::uuid, 'offert', 'essai', now(), 'essai')`, U2)
    await poser(`insert into public.academie_acces (user_id, offre_id, source, pose_par, debut, fin) values ($2::uuid, $1::uuid, 'offert', 'essai', now() - interval '2 days', now() - interval '1 day')`, U2)
    await poser(`insert into public.academie_acces (user_id, offre_id, source, pose_par, debut) values ($2::uuid, $1::uuid, 'offert', 'essai', now() + interval '1 day')`, U2)

    const lignesU1 = await tx.$queryRawUnsafe(R.SQL_ACCES, U1, [EMAIL_VERIFIE])
    assert.deepEqual(lignesU1.filter(l => l.origine === 'acces').map(l => l.source).sort(), ['paypal', 'stripe'])
    const lignesU2 = await tx.$queryRawUnsafe(R.SQL_ACCES, U2, [])
    assert.deepEqual(lignesU2.filter(l => l.origine === 'acces'), [])
    const versRegle = (lignes) => lignes.map(l => ({
      origine: l.origine, source: l.source, slug: l.slug, ouvreTout: l.ouvre_tout, moduleId: l.module_id, sectionId: l.section_id,
    }))
    const leconEssai = { moduleId: moduleEssai, sectionId: null, usage: 'interne', apercu: false }
    const droits = (lignes, liveClub) => preparerDroits({ admin: false, etm: false, liveClub, secoursEssai: false, lignes: versRegle(lignes) })
    assert.deepEqual(ouvertureLecon(droits(lignesU1, 'non'), leconEssai), { acces: 'ouvert', raisons: ['achat'] })
    assert.deepEqual(ouvertureLecon(droits(lignesU2, 'non'), leconEssai), { acces: 'ferme', raisons: [] })
    assert.deepEqual(ouvertureLecon(droits(lignesU2, 'oui'), leconEssai), { acces: 'ouvert', raisons: ['liveclub'] })
    ok('SQL_ACCES et regle : user_id et email verifie oui ; non verifie, retire, expire, futur non')

    const modules = await tx.$queryRawUnsafe(R.SQL_MODULES_VISIBLES)
    const mEssai = modules.find(m => m.slug === 'essai')
    assert.ok(mEssai && 'prix_eur' in mEssai && mEssai.prix_eur === null)
    const offres = await tx.$queryRawUnsafe(R.SQL_OFFRES_DES_MODULES)
    const offresEssai = offres.filter(o => o.module_id === moduleEssai).map(o => `${o.slug}:${o.portee}`).sort()
    assert.deepEqual(offresEssai, ['live-club:module', 'test-offre:module'])
    assert.equal(offres.find(o => o.slug === 'test-offre').prix_eur, 49)
    assert.ok(offres.some(o => o.module_id === null && o.slug === 'etm' && o.portee === 'tout'))
    const lecons = await tx.$queryRawUnsafe(R.SQL_LECONS_VISIBLES)
    assert.ok(!('bunny_video_id' in lecons[0]) && !('contenu' in lecons[0]), 'le catalogue ne doit pas porter d identifiant Bunny')
    assert.equal((await tx.$queryRawUnsafe(R.SQL_LECON_PAR_ID, lecon1))[0].bunny_bibliotheque, 'formation')
    ok('catalogue : prix_eur du module, offres par module (module, tout), lecons sans identifiant Bunny')

    const lien = await tx.$queryRawUnsafe(R.SQL_NOTER_LIEN, U1, lecon1, '203.0.113.7', 'ordinateur windows chrome')
    assert.equal(lien[0].journalise, 1)
    assert.equal(lien[0].vu_le, null)
    assert.equal(etatLecon({ secondesVues: lien[0].secondes_vues, vuLe: lien[0].vu_le }), 'ouvert')
    await tx.$queryRawUnsafe(R.SQL_NOTER_LIEN, U1, lecon1, null, null)
    ok('SQL_NOTER_LIEN : la lecon passe ouverte des l ouverture, ligne lien au journal')

    const etat = await tx.$queryRawUnsafe(R.SQL_ETAT_SIGNAL, U1, lecon1)
    assert.equal(etat[0].nb_signaux, 0)
    assert.ok('vu_le' in etat[0])
    // ($1..$14 comme avant, $15 vu, $16 vu_par)
    const signal = (nb, o) => tx.$queryRawUnsafe(R.SQL_APPLIQUER_SIGNAL,
      U1, lecon1, nb, 130, 130, o.secondesVues, 1, o.terminer ?? false, o.marque ?? null,
      o.evenement, o.credit ?? null, o.position ?? null, '203.0.113.7', 'ordinateur windows chrome',
      o.vu ?? null, o.vuPar ?? null)
    const premier = await signal(0, { secondesVues: 30, evenement: 'lecture', credit: 30, position: 130 })
    assert.equal(etatLecon({ secondesVues: premier[0].secondes_vues, vuLe: premier[0].vu_le }), 'en_cours')
    assert.equal((await signal(0, { secondesVues: 60, evenement: 'lecture', credit: 30 })).length, 0) // verrou optimiste
    const vu = await signal(1, { secondesVues: 30, evenement: 'vu', marque: 'poser', vu: 'poser', vuPar: 'eleve', terminer: true })
    assert.equal(vu[0].vu_par, 'eleve')
    assert.ok(vu[0].vu_le instanceof Date && vu[0].marquee_vue_le instanceof Date && vu[0].terminee_le instanceof Date)
    // Reposer « vu » par une autre voie garde la premiere.
    const fin = await signal(2, { secondesVues: 30, evenement: 'fin', vu: 'poser', vuPar: 'fin' })
    assert.equal(fin[0].vu_par, 'eleve')
    const decoche = await signal(3, { secondesVues: 30, evenement: 'non_vu', marque: 'retirer', vu: 'retirer' })
    assert.equal(decoche[0].vu_le, null)
    assert.equal(decoche[0].vu_par, null)
    assert.equal(decoche[0].marquee_vue_le, null)
    assert.ok(decoche[0].terminee_le instanceof Date, 'la preuve terminee_le reste apres le decochage')
    assert.equal(etatLecon({ secondesVues: decoche[0].secondes_vues, vuLe: decoche[0].vu_le }), 'en_cours')
    const texteFin = await signal(4, { secondesVues: 50, evenement: 'texte_fin', credit: 20, vu: 'poser', vuPar: 'texte_fin' })
    assert.equal(texteFin[0].vu_par, 'texte_fin')
    assert.equal(texteFin[0].journalise, 1)
    ok('SQL_APPLIQUER_SIGNAL : en_cours, concurrent refuse, vu (eleve), voie gardee, non_vu (preuve gardee), texte_fin')

    assert.equal(await tx.$executeRawUnsafe(R.SQL_NOTER_CONNEXION, U1, '2001:db8::1', 'mobile ios safari'), 1)
    assert.equal(await tx.$executeRawUnsafe(R.SQL_NOTER_CONNEXION, U1, null, null), 0)
    const progression = await tx.$queryRawUnsafe(R.SQL_PROGRESSION_COMPTE, U1)
    assert.equal(progression.length, 1)
    assert.equal(progression[0].vu_par, 'texte_fin')
    const journal = await tx.$queryRawUnsafe(`
      select evenement, count(*)::int as n from public.academie_lectures where user_id = $1::uuid group by 1 order by 1`, U1)
    assert.deepEqual(journal, [
      { evenement: 'connexion', n: 1 }, { evenement: 'fin', n: 1 }, { evenement: 'lecture', n: 1 }, { evenement: 'lien', n: 2 },
      { evenement: 'non_vu', n: 1 }, { evenement: 'texte_fin', n: 1 }, { evenement: 'vu', n: 1 },
    ])
    ok('SQL_NOTER_CONNEXION (une par 30 min), SQL_PROGRESSION_COMPTE, journal complet (non_vu garde la trace)')

    throw new Annulation()
  }, { timeout: 120_000, maxWait: 20_000 })
} catch (err) {
  if (!(err instanceof Annulation)) {
    console.error('\nECHEC (transaction annulee, rien n est reste) :', String(err?.message ?? err).split('\n').slice(-8).join('\n'))
    process.exitCode = 1
  }
}

try {
  if (baseEnPlace) {
    assert.equal(await colonneVuLe(prisma), false)
    console.log(`\nTransaction ANNULEE : la colonne vu_le n'existe toujours pas (verifie apres coup). ${etapes} etapes.`)
  } else {
    for (const t of TABLES) assert.equal(await existe(prisma, t), false)
    console.log(`\nTransaction ANNULEE : aucune table academie_* en base (verifie apres coup). ${etapes} etapes.`)
  }
} catch (err) {
  console.error('ATTENTION : verification apres annulation en echec :', String(err?.message ?? err))
  process.exitCode = 1
}
await prisma.$disconnect()
