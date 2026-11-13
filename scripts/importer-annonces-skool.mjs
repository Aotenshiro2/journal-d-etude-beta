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
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env.local scripts/importer-annonces-skool.mjs --essai
 * N'affiche aucun email ni aucune cle, ni le texte des annonces.
 */

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import {
  categorieDe, lireAnnonces, MODULE_ARCHIVE_SKOOL, noterAnnoncesVues, texteAnnonceSkool,
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

main()
  .catch((err) => { console.error(`ECHEC : ${String(err?.message ?? err).split('\n').slice(0, 3).join(' ')}`); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
