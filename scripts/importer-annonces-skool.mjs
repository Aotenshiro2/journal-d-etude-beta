/**
 * IMPORT des 75 annonces Skool de Brice dans les ANNONCES de l'academie (13/11/2026,
 * branche academie-navigation ; src/lib/academie/annonces.ts ; migration
 * 20261113160000_academie_annonces.sql du workspace).
 *
 * Source : cockpit_annonces_envoyees (canal skool, 75 lignes, archivees le 07-08/11 : titre,
 * texte complet, date) + l'export de fermeture (posts/brice-annonces.json) pour le slug et
 * les pieces jointes. Chaque annonce devient un billet : une lecon en statut archive dans le
 * module d'archive « annonces-skool » (jamais dans le catalogue) et une ligne de
 * academie_billets (origine skool, source skool:<id>, categorie, publie_le = la date Skool,
 * publication_faite_le = la meme date : ni pop-up, ni nouvelle ligne dans
 * cockpit_annonces_envoyees). Rejouable : une source deja importee est sautee.
 *
 * MODES
 *   (defaut) ou --essai : tout dans UNE transaction TOUJOURS ANNULEE. Si la migration n'est
 *     pas appliquee, elle est jouee dans la transaction (deux fois : rejouable). Puis
 *     l'import, les controles, un second import (0 nouveau), et l'annulation ; on verifie
 *     hors transaction que rien n'est reste.
 *   --ecrire : ecrit pour de bon. REFUSE si la migration n'est pas appliquee. A lancer
 *     seulement sur le GO ECRIT de Brice, apres la migration et la mise en ligne des
 *     images (--images-base).
 *
 * OPTIONS
 *   --export <chemin>       brice-annonces.json (defaut : l'export du 07/11 sur D:, vu de WSL)
 *   --images-base <url>     ou les pieces jointes seront publiees (defaut /media/academie/annonces,
 *                           le dossier public du site ; une URL https pour un autre hebergement)
 *   --migration <chemin>    le fichier de la migration (defaut : le workspace, a cote du journal)
 *
 * MISE A JOUR PAR ID SKOOL (13/11/2026, correctif : 16 annonces importees coupees a ~2 000 caracteres)
 *   --maj <id>[,<id>...]    complete le texte de CES annonces seulement (ids Skool, avec ou sans « skool: »)
 *                           avec le texte entier du brut de l'export (page du post), passe par la MEME chaine
 *                           que l'import (texteAnnonceSkool : memes echappements retires, memes images, memes
 *                           PDF). Sans --ecrire : essai dans une transaction annulee ; avec --ecrire : ecrit.
 *   --brut <chemin>         skool-posts-AAAA-MM-JJ.json (defaut : le brut du 07/11 sur D:, vu de WSL)
 *   Le texte entier passe d'abord par la preparation qu'a eue le texte coupe avant cockpit_annonces_envoyees :
 *   tel quel (archive du 07/11) ou nettoye comme les 10 notes de version du 27/10 (nettoyageNotes2710),
 *   reconnue en la refaisant sur le fil de l'export (egalite exacte, sinon refus).
 *   Par annonce : « maj » seulement si la lecon porte EXACTEMENT ce que l'import a ecrit depuis le texte
 *   coupe (cockpit_annonces_envoyees) et si le texte entier prolonge ce texte coupe ; « a_jour » si elle
 *   porte deja le texte entier (rejouable) ; sinon « refus » et on n'y touche pas. Seul le texte
 *   (academie_lecons.contenu) change : ni le titre, ni le billet, ni les autres annonces, ni les lectures
 *   des membres (academie_billets_vus, academie_progression, academie_lectures), ni
 *   cockpit_annonces_envoyees (l'historique du cockpit garde le texte du fil).
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env.local scripts/importer-annonces-skool.mjs --essai
 *   node --env-file=.env.local scripts/importer-annonces-skool.mjs --maj <ids> [--ecrire]
 * N'affiche aucun email ni aucune cle, ni le texte des annonces.
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import {
  categorieDe, lireAnnonces, lireIdsSkool, MODULE_ARCHIVE_SKOOL, nettoyageNotes2710, noterAnnoncesVues, planMajAnnonce,
  preparationSkool, texteAnnonceSkool, texteEntierSkool,
} from '../src/lib/academie/annonces.ts'
import { lireBilletDuJour, publierBilletsEchus } from '../src/lib/academie/billets.ts'
import { FENETRE_LIBRE_BILLET_H } from '../src/lib/academie/pur.ts'

const args = process.argv.slice(2)
const option = (nom, defaut) => {
  const i = args.indexOf(nom)
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut
}
const ECRIRE = args.includes('--ecrire')
const EXPORT = option('--export', '/mnt/d/6_Societe/Pilotage/Data-Performance/platforms/skool/exports/2026-11-07/posts/brice-annonces.json')
const BASE_IMAGES = option('--images-base', '/media/academie/annonces')
const MIGRATION = option('--migration',
  new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261113160000_academie_annonces.sql', import.meta.url).pathname)
const MAJ = args.includes('--maj')
const BRUT = option('--brut', '/mnt/d/6_Societe/Pilotage/Data-Performance/platforms/skool/raw/2026-11-07/skool-posts-2026-11-07.json')

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

class Annulation extends Error {}
let etapes = 0
const ok = (nom) => { etapes++; console.log(`ok  ${nom}`) }
const prisma = new PrismaClient()

const SQL_VERROU = 'select id from public.academie_modules order by id for update'
const SQL_COLONNES = `
select count(*)::int as n from information_schema.columns
 where table_schema = 'public' and table_name = 'academie_billets' and column_name in ('origine', 'source', 'categorie', 'epingle_le')`
const SQL_MODULE = `select id::text as id, statut from public.academie_modules where slug = $1`
const SQL_SKOOL = `
select source, titre, contenu, envoye_le from public.cockpit_annonces_envoyees
 where canal = 'skool' and source like 'skool:%' order by envoye_le, source`
const SQL_SOURCES = `select source from public.academie_billets where source is not null`
const SQL_SLUGS = `select slug from public.academie_lecons where module_id = $1::uuid`
const SQL_CREER_LECON = `
insert into public.academie_lecons
  (module_id, section_id, slug, ordre, titre, type, format, usage, contenu, ressources, statut, statut_le)
values ($1::uuid, null, $2, $3, $4, 'texte', 'cours', 'interne', $5, $6::jsonb, 'archive', now())
returning id::text as id`
const SQL_CREER_BILLET = `
insert into public.academie_billets (lecon_id, publie_le, publication_faite_le, origine, source, categorie)
values ($1::uuid, $2::timestamptz, $2::timestamptz, 'skool', $3, $4)
on conflict (source) do nothing
returning id::text as id`

const slugPropre = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120).replace(/-+$/, '') || 'annonce'

function lireExport() {
  assert.ok(existsSync(EXPORT), `export introuvable : ${EXPORT}`)
  const posts = JSON.parse(readFileSync(EXPORT, 'utf8'))
  assert.ok(Array.isArray(posts), 'export : une liste de posts attendue')
  const parId = new Map()
  for (const p of posts) parId.set(`skool:${p.id}`, p)
  return parId
}

/** L'import dans tx. Rend { crees, sautees, images, pdf, categories }. */
async function importer(tx, parId) {
  await tx.$queryRawUnsafe(SQL_VERROU)
  const [mod] = await tx.$queryRawUnsafe(SQL_MODULE, MODULE_ARCHIVE_SKOOL)
  assert.ok(mod, `module ${MODULE_ARCHIVE_SKOOL} absent (migration non appliquee ?)`)
  assert.equal(mod.statut, 'archive', 'le module d archive doit rester en statut archive')
  const annonces = await tx.$queryRawUnsafe(SQL_SKOOL)
  const deja = new Set((await tx.$queryRawUnsafe(SQL_SOURCES)).map(r => r.source))
  const pris = new Set((await tx.$queryRawUnsafe(SQL_SLUGS, mod.id)).map(r => r.slug))
  let crees = 0, sautees = 0, images = 0, pdf = 0, ordre = pris.size
  const categories = {}
  for (const a of annonces) {
    if (deja.has(a.source)) { sautees++; continue }
    const post = parId.get(a.source)
    const slugBase = slugPropre(post?.slug || a.titre)
    let slug = slugBase
    for (let n = 2; pris.has(slug); n++) slug = `${slugBase.slice(0, 115).replace(/-+$/, '')}-${n}`
    pris.add(slug)
    const t = texteAnnonceSkool(a.contenu ?? '', slugBase, Array.isArray(post?.pieces_jointes) ? post.pieces_jointes : [], BASE_IMAGES)
    const categorie = categorieDe(a.titre)
    const [lecon] = await tx.$queryRawUnsafe(SQL_CREER_LECON, mod.id, slug, ++ordre, a.titre.slice(0, 300), t.contenu || a.titre, JSON.stringify(t.ressources))
    const billet = await tx.$queryRawUnsafe(SQL_CREER_BILLET, lecon.id, new Date(a.envoye_le).toISOString(), a.source, categorie)
    assert.equal(billet.length, 1, `billet non cree pour ${a.source}`)
    crees++; images += t.images; pdf += t.ressources.length
    categories[categorie] = (categories[categorie] ?? 0) + 1
  }
  return { total: annonces.length, crees, sautees, images, pdf, categories, sansExport: annonces.filter(a => !parId.has(a.source)).length }
}

// --- Mise a jour par id Skool (--maj) ---------------------------------------
const SQL_MAJ_LIRE = `
select l.id::text as lecon_id, b.id::text as billet_id, l.slug, l.contenu, l.ressources, a.titre as a_titre, a.contenu as a_contenu
  from public.academie_billets b
  join public.academie_lecons l on l.id = b.lecon_id
  join public.academie_modules m on m.id = l.module_id
  left join public.cockpit_annonces_envoyees a on a.source = b.source and a.canal = 'skool'
 where b.source = $1 and b.origine = 'skool' and m.slug = $2
 for update of l`
const SQL_MAJ_ECRIRE = `update public.academie_lecons set contenu = $2 where id = $1::uuid and contenu = $3`
const SQL_MAJ_CIBLES = `
select coalesce(array_agg(b.lecon_id::text), '{}') as lecons, coalesce(array_agg(b.id::text), '{}') as billets
  from public.academie_billets b where b.source = any($1::text[]) and b.origine = 'skool'`
// Ce que la mise a jour ne doit pas toucher : les lectures des membres sur ces annonces, les autres annonces.
// maj_le = now() : le declencheur academie_lecons_maj_le pose now(), l'heure de debut de la transaction.
const SQL_MAJ_TEMOINS = `
select (select count(*)::int from public.academie_billets_vus where billet_id = any($2::uuid[])) as vus,
       (select count(*)::int from public.academie_progression where lecon_id = any($3::uuid[])) as progression,
       (select count(*)::int from public.academie_lectures where lecon_id = any($3::uuid[])) as lectures,
       (select count(*)::int from public.academie_lecons l join public.academie_modules m on m.id = l.module_id
         where m.slug = $1) as lecons,
       (select count(*)::int from public.academie_lecons l join public.academie_modules m on m.id = l.module_id
         where m.slug = $1 and l.maj_le = now() and not (l.id = any($3::uuid[]))) as autres_touchees`

// Les pieces jointes (PDF) : jsonb range les cles a sa facon, on compare titre et url, dans l'ordre.
const cleRessources = l => JSON.stringify((Array.isArray(l) ? l : []).map(r => [r?.titre ?? null, r?.url ?? null]))
const memeJson = (a, b) => cleRessources(a) === cleRessources(b)

/** Le brut de l'export : id -> texte entier (page du post), ou null. */
function lireBrut(ids) {
  assert.ok(existsSync(BRUT), `brut introuvable : ${BRUT}`)
  const brut = JSON.parse(readFileSync(BRUT, 'utf8'))
  return new Map(ids.map(id => [id, texteEntierSkool(brut, id)]))
}

/** La mise a jour dans tx. Rend { lignes: [{ id, slug, action, raison, avant, apres }], ecrites }. */
async function mettreAJour(tx, parId, ids, entiers) {
  const lignes = []
  let ecrites = 0
  for (const id of ids) {
    const source = `skool:${id}`
    const ligne = { id, slug: '?', action: 'refus', raison: '', avant: 0, apres: 0, preparation: '' }
    lignes.push(ligne)
    const [l] = await tx.$queryRawUnsafe(SQL_MAJ_LIRE, source, MODULE_ARCHIVE_SKOOL)
    if (!l) { ligne.raison = 'annonce absente (jamais importee ?)'; continue }
    ligne.slug = l.slug
    ligne.avant = ligne.apres = (l.contenu ?? '').length
    const post = parId.get(source)
    if (!post) { ligne.raison = 'post absent de l export'; continue }
    if (l.a_contenu == null) { ligne.raison = 'texte coupe absent de cockpit_annonces_envoyees'; continue }
    const brutEntier = entiers.get(id)
    if (!brutEntier) { ligne.raison = 'texte entier absent du brut'; continue }
    // Le texte entier passe par la preparation qu'a eue le texte coupe avant cockpit_annonces_envoyees
    // (tel quel le 07/11, nettoye le 27/10 pour les notes de version), verifiee sur le fil de l'export.
    const preparation = preparationSkool(l.a_contenu, post.contenu ?? '')
    if (!preparation) { ligne.raison = 'texte du cockpit ni le fil de l export ni son nettoyage du 27/10'; continue }
    ligne.preparation = preparation
    const entier = preparation === 'notes-27-10' ? nettoyageNotes2710(brutEntier) : brutEntier
    // Memes slug d'images, memes pieces jointes, meme chaine que l'import.
    const slugBase = slugPropre(post.slug || l.a_titre)
    const pieces = Array.isArray(post.pieces_jointes) ? post.pieces_jointes : []
    const tc = texteAnnonceSkool(l.a_contenu, slugBase, pieces, BASE_IMAGES)
    const te = texteAnnonceSkool(entier, slugBase, pieces, BASE_IMAGES)
    if (!memeJson(l.ressources, tc.ressources) || !memeJson(te.ressources, tc.ressources)) { ligne.raison = 'pieces jointes differentes de l import'; continue }
    const plan = planMajAnnonce(l.contenu, l.a_contenu, entier, tc.contenu || l.a_titre, te.contenu)
    ligne.action = plan.action
    ligne.raison = plan.raison ?? ''
    if (plan.action === 'refus') continue
    ligne.apres = te.contenu.length
    if (plan.action !== 'maj') continue
    const n = await tx.$executeRawUnsafe(SQL_MAJ_ECRIRE, l.lecon_id, te.contenu, l.contenu)
    assert.equal(n, 1, `${source} : une ligne attendue, ${n} ecrites`)
    ecrites++
  }
  return { lignes, ecrites }
}

/** La mise a jour dans tx, encadree par ses temoins (lectures des membres, autres annonces). */
async function majControlee(tx, parId, ids, entiers) {
  const [c] = await tx.$queryRawUnsafe(SQL_MAJ_CIBLES, ids.map(id => `skool:${id}`))
  const temoin = async () => (await tx.$queryRawUnsafe(SQL_MAJ_TEMOINS, MODULE_ARCHIVE_SKOOL, c.billets, c.lecons))[0]
  const avant = await temoin()
  const r = await mettreAJour(tx, parId, ids, entiers)
  const apres = await temoin()
  assert.equal(apres.autres_touchees, 0, 'une autre annonce a ete touchee')
  assert.deepEqual(apres, { ...avant, autres_touchees: 0 }, 'lectures des membres ou nombre de lecons changes')
  return { ...r, temoins: apres }
}

function direMaj(r) {
  for (const l of r.lignes) {
    console.log(`  ${l.action.padEnd(6)} ${l.id.slice(0, 8)} ${l.slug.slice(0, 50).padEnd(50)} ${String(l.preparation).padEnd(11)} `
      + `${l.avant} -> ${l.apres}${l.raison ? ` (${l.raison})` : ''}`)
  }
  const n = a => r.lignes.filter(l => l.action === a).length
  console.log(`  ${n('maj')} a completer, ${n('a_jour')} deja a jour, ${n('refus')} refus ; lectures des membres sur ces annonces : `
    + `${r.temoins.vus} vues, ${r.temoins.progression} progressions, ${r.temoins.lectures} lectures (inchangees) ; `
    + `${r.temoins.lecons} lecons d'annonces, aucune autre touchee`)
}

async function principalMaj() {
  const ids = lireIdsSkool(option('--maj', ''))
  if (!ids) { console.error('REFUS : --maj attend des ids Skool (32 caracteres hexadecimaux) separes par des virgules.'); process.exitCode = 2; return }
  const parId = lireExport()
  const entiers = lireBrut(ids)
  console.log(`--maj : ${ids.length} annonces ; export ${parId.size} posts ; brut : ${[...entiers.values()].filter(Boolean).length} textes entiers trouves`)
  if (ECRIRE) {
    const r = await prisma.$transaction(tx => majControlee(tx, parId, ids, entiers), { timeout: 120_000, maxWait: 20_000 })
    console.log(`ECRIT : ${r.ecrites} annonces completees`)
    direMaj(r)
    // Relu apres coup comme la route /api/academie/annonces le rend (lireAnnonces, compte quelconque) : longueurs seules.
    const [c] = await prisma.$queryRawUnsafe(SQL_MAJ_CIBLES, ids.map(id => `skool:${id}`))
    const parBillet = new Map((await lireAnnonces(prisma, randomUUID())).map(a => [a.id, a]))
    const rendues = c.billets.map(b => parBillet.get(b)).filter(Boolean)
    console.log(`relu par lireAnnonces (la fonction de la route) : ${rendues.length}/${ids.length} annonces rendues, `
      + `longueurs ${rendues.map(a => a.contenu.length).join(', ')}`)
    return
  }
  console.log('ESSAI (transaction annulee)')
  let r
  try {
    await prisma.$transaction(async (tx) => {
      r = await majControlee(tx, parId, ids, entiers)
      const r2 = await mettreAJour(tx, parId, ids, entiers)
      assert.equal(r2.ecrites, 0, 'second passage : rien a ecrire (rejouable)')
      assert.equal(r2.lignes.filter(l => l.action === 'a_jour').length, r.lignes.filter(l => l.action !== 'refus').length,
        'second passage : tout ce qui n est pas refuse est a jour')
      throw new Annulation()
    }, { timeout: 120_000, maxWait: 20_000 })
  } catch (err) {
    if (!(err instanceof Annulation)) throw err
  }
  direMaj(r)
  console.log('  second passage : 0 ecriture, tout ce qui n est pas refuse est « a_jour » (rejouable). Transaction annulee, base inchangee.')
}

async function compter(c) {
  const [r] = await c.$queryRawUnsafe(`
    select (select count(*)::int from public.academie_billets) as billets,
           (select count(*)::int from public.cockpit_annonces_envoyees) as annonces_envoyees,
           (select count(*)::int from public.academie_modules where slug = $1) as module`, MODULE_ARCHIVE_SKOOL)
  return r
}

async function main() {
  const parId = lireExport()
  console.log(`export : ${parId.size} posts lus ; images publiees sous ${BASE_IMAGES}`)
  const avant = await compter(prisma)
  const [{ n: colonnes }] = await prisma.$queryRawUnsafe(SQL_COLONNES)
  const migree = colonnes === 4 && avant.module === 1

  if (ECRIRE) {
    if (!migree) { console.error('REFUS : la migration 20261113160000 n est pas appliquee.'); process.exitCode = 1; return }
    const r = await prisma.$transaction(tx => importer(tx, parId), { timeout: 120_000, maxWait: 20_000 })
    console.log(`ECRIT : ${r.crees} annonces creees, ${r.sautees} deja la, ${r.images} images, ${r.pdf} PDF ; categories ${JSON.stringify(r.categories)}`)
    return
  }

  console.log(`ESSAI (transaction annulee). Migration deja appliquee : ${migree ? 'oui' : 'non'}`)
  try {
    await prisma.$transaction(async (tx) => {
      if (!migree) {
        const ordres = decouper(readFileSync(MIGRATION, 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n'))
        for (let passe = 1; passe <= 2; passe++) for (const o of ordres) await tx.$executeRawUnsafe(o)
        ok(`migration jouee deux fois (${ordres.length} ordres, rejouable)`)
      }
      const [{ n }] = await tx.$queryRawUnsafe(SQL_COLONNES)
      assert.equal(n, 4); ok('colonnes origine, source, categorie, epingle_le presentes')

      const r = await importer(tx, parId)
      assert.equal(r.total, 75, `75 annonces Skool attendues dans cockpit_annonces_envoyees, ${r.total} lues`)
      assert.equal(r.crees + r.sautees, 75)
      assert.equal(r.sansExport, 0, 'chaque annonce retrouve son post dans l export')
      ok(`import : ${r.crees} creees, ${r.sautees} sautees ; ${r.images} images, ${r.pdf} PDF ; categories ${JSON.stringify(r.categories)}`)

      const apres = await compter(tx)
      assert.equal(apres.annonces_envoyees, avant.annonces_envoyees, 'aucune ligne ajoutee a cockpit_annonces_envoyees')
      ok(`cockpit_annonces_envoyees inchange (${apres.annonces_envoyees} lignes)`)
      assert.equal(await publierBilletsEchus(tx), 0, 'aucun billet a publier : publication_faite_le est posee')
      ok('publierBilletsEchus : rien a publier (ni pop-up, ni annonce envoyee)')
      const [cat] = await tx.$queryRawUnsafe(`
        select count(*)::int as n from public.academie_lecons l join public.academie_modules m on m.id = l.module_id
         where m.slug = $1 and (m.statut in ('publie', 'a_venir') or l.statut in ('publie', 'a_venir'))`, MODULE_ARCHIVE_SKOOL)
      assert.equal(cat.n, 0); ok('module et lecons d archive hors du catalogue (statut archive)')

      const compte = randomUUID()
      const du = await lireBilletDuJour(tx, compte, FENETRE_LIBRE_BILLET_H)
      assert.ok(!du || !String(du.module_slug).includes(MODULE_ARCHIVE_SKOOL)); ok('billet du jour : aucune annonce Skool')
      const liste = await lireAnnonces(tx, compte)
      const skool = liste.filter(a => a.origine === 'skool')
      assert.equal(skool.length, 75); ok(`route : 75 annonces Skool rendues a un compte quelconque (${liste.length} en tout)`)
      assert.ok(skool.every(a => !a.non_lue && a.lien === null && a.categorie)); ok('route : annonces Skool jamais non lues, sans lien de lecon, avec categorie')
      assert.ok(skool.every((a, i) => i === 0 || a.publie_le <= skool[i - 1].publie_le)); ok('route : les plus recentes d abord')
      assert.ok(!skool.some(a => /\\[()\-.]/.test(a.contenu))); ok('textes sans echappements Skool')
      const avecImage = skool.filter(a => a.contenu.includes(`](${BASE_IMAGES.replace(/\/+$/, '')}/`))
      ok(`${avecImage.length} annonces avec images dans le texte`)
      const vues = await noterAnnoncesVues(tx, skool.slice(0, 2).map(a => a.id), compte)
      assert.equal(vues, 2); ok('POST vues : 2 lignes notees (tableau d uuid accepte)')

      const r2 = await importer(tx, parId)
      assert.equal(r2.crees, 0); assert.equal(r2.sautees, 75); ok('second import : 0 nouveau, 75 sautes (rejouable)')
      throw new Annulation()
    }, { timeout: 120_000, maxWait: 20_000 })
  } catch (err) {
    if (!(err instanceof Annulation)) throw err
  }
  const fin = await compter(prisma)
  assert.deepEqual(fin, avant, 'rien ne doit rester apres l annulation')
  ok(`annule : rien n est reste (billets ${fin.billets}, module d archive ${fin.module})`)
  console.log(`\n${etapes} etapes ok. Transaction annulee, base inchangee.`)
}

;(MAJ ? principalMaj() : main())
  .catch((err) => { console.error(`ECHEC : ${String(err?.message ?? err).split('\n').slice(0, 3).join(' ')}`); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
