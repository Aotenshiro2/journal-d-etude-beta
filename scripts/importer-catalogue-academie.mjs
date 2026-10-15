// Importe UN module du catalogue de l'academie depuis son fichier de donnees.
//
//   node scripts/importer-catalogue-academie.mjs <module.json> [--ecrire]
//
// Sans --ecrire, le script joue tout dans une transaction puis l'ANNULE (essai a blanc) et dit ce
// qu'il aurait fait. Avec --ecrire, il valide. Les fichiers de donnees vivent hors du depot :
// D:\6_Societe\Pilotage\Academie\catalogue\modules\<slug>.json (un module par fichier, remplis jour
// apres jour, plan section 12). Ce qui fait foi sur le contenu : D:\3_Pedagogie\CARTE-DES-FORMATIONS.md.
//
// Idempotent : le module se retrouve par son slug, une section par son ordre dans le module, une lecon
// par (module, slug) ; relancer le meme fichier met a jour sans dupliquer. Le contenu d'une lecon ecrite
// (ou le texte sous une video) peut venir d'un fichier Markdown (« contenu_fichier », chemin relatif au
// fichier de donnees).
//
// Les offres :
// - « offres » : ["<offre>", ...] ouvrent le module ENTIER ; un lien au niveau du module qui n'est plus
//   liste est retire ;
// - « offres_sections » (16/10) : { "<offre>": ["<cle de section>", ...] } ouvrent seulement ces sections
//   (cles du tableau « sections » du fichier, comme le champ « section » des lecons). Exemple, la
//   formation en un seul module : { "live-club": ["partie-1"] } (le Live Club n'ouvre que la Partie 1).
//   Un lien par section de CE module qui n'est plus liste est retire (champ absent = aucun lien par
//   section). Les autres modules ne sont jamais touches.
//
// Pieces jointes (« ressources » d'une lecon) : { "titre", "url" } publique (http(s) ou chemin du site),
// ou { "titre", "fichier" } protegee (chemin dans le bucket prive academie-ressources, envoye par
// scripts/envoyer-ressources-academie.mjs).
//
// importerModule(tx, donnees, dossier) est exportee pour scripts/essayer-migration-ressources-academie.mjs
// (memes ordres, dans une transaction toujours annulee).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { lireOffresSections } from '../src/lib/academie/pur.ts'

/** Joue l'import d'un module dans la transaction tx. Rend le bilan. Jette sur une donnee invalide. */
export async function importerModule(tx, donnees, dossier) {
  const m = donnees.module
  const bilan = {
    module: m.slug, sections: 0, lecons: 0, offres: [], offres_retirees: 0, offres_sections: [], offres_sections_retirees: 0,
  }

  const [mod] = await tx.$queryRawUnsafe(
    `insert into public.academie_modules (slug, titre, resume, ordre, parcours, statut, auteur, image, prix_eur)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric)
     on conflict (slug) do update set titre = excluded.titre, resume = excluded.resume, ordre = excluded.ordre,
       parcours = excluded.parcours, statut = excluded.statut, auteur = excluded.auteur, image = excluded.image,
       prix_eur = excluded.prix_eur
     returning id::text as id`,
    m.slug, m.titre, m.resume ?? null, m.ordre ?? 0, m.parcours ?? null, m.statut ?? 'brouillon',
    m.auteur ?? null, m.image ?? null, m.prix_eur ?? null,
  )
  const moduleId = mod.id

  const sectionParCle = new Map()
  for (const s of donnees.sections ?? []) {
    const deja = await tx.$queryRawUnsafe(
      `select id::text as id from public.academie_sections where module_id = $1::uuid and ordre = $2`, moduleId, s.ordre)
    let id
    if (deja.length) {
      id = deja[0].id
      await tx.$executeRawUnsafe(`update public.academie_sections set titre = $2 where id = $1::uuid`, id, s.titre)
    } else {
      const [n] = await tx.$queryRawUnsafe(
        `insert into public.academie_sections (module_id, ordre, titre) values ($1::uuid, $2, $3) returning id::text as id`,
        moduleId, s.ordre, s.titre)
      id = n.id
    }
    sectionParCle.set(s.cle, id)
    bilan.sections++
  }

  for (const l of donnees.lecons ?? []) {
    const contenu = l.contenu_fichier ? readFileSync(resolve(dossier, l.contenu_fichier), 'utf8') : (l.contenu ?? null)
    const sectionId = l.section ? sectionParCle.get(l.section) : null
    if (l.section && !sectionId) throw new Error(`section inconnue « ${l.section} » pour la lecon ${l.slug}`)
    const video = l.type === 'video'
    await tx.$executeRawUnsafe(
      `insert into public.academie_lecons (module_id, section_id, slug, ordre, titre, type, format, usage, hebergeur,
         bunny_bibliotheque, bunny_video_id, wistia_id, duree_s, contenu, ressources, apercu, statut)
       values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17)
       on conflict (module_id, slug) do update set section_id = excluded.section_id, ordre = excluded.ordre,
         titre = excluded.titre, type = excluded.type, format = excluded.format, usage = excluded.usage,
         hebergeur = excluded.hebergeur, bunny_bibliotheque = excluded.bunny_bibliotheque,
         bunny_video_id = excluded.bunny_video_id, wistia_id = excluded.wistia_id, duree_s = excluded.duree_s,
         contenu = excluded.contenu, ressources = excluded.ressources, apercu = excluded.apercu, statut = excluded.statut`,
      moduleId, sectionId, l.slug, l.ordre, l.titre, l.type, l.format ?? 'cours', l.usage ?? 'interne',
      video ? (l.hebergeur ?? 'bunny') : null,
      video && (l.hebergeur ?? 'bunny') === 'bunny' ? (l.bunny_bibliotheque ?? 'formation') : null,
      video ? (l.bunny_video_id ?? null) : null, video ? (l.wistia_id ?? null) : null,
      l.duree_s ?? null, contenu, JSON.stringify(l.ressources ?? []), Boolean(l.apercu), l.statut ?? 'brouillon',
    )
    bilan.lecons++
  }

  const offreExiste = async (slug) =>
    (await tx.$queryRawUnsafe(`select 1 from public.academie_offres where slug = $1`, slug)).length > 0

  // Le module entier.
  const voulues = donnees.offres ?? []
  for (const slug of voulues) {
    if (!(await offreExiste(slug))) throw new Error(`offre inconnue : ${slug}`)
    const n = await tx.$executeRawUnsafe(
      `insert into public.academie_offre_contenus (offre_id, module_id)
       select o.id, $2::uuid from public.academie_offres o where o.slug = $1
       on conflict do nothing`, slug, moduleId)
    bilan.offres.push(n ? `${slug} (ajoutee)` : `${slug} (deja la)`)
  }
  bilan.offres_retirees = await tx.$executeRawUnsafe(
    `delete from public.academie_offre_contenus c using public.academie_offres o
     where c.offre_id = o.id and c.module_id = $1::uuid and c.section_id is null and not (o.slug = any($2::text[]))`,
    moduleId, voulues)

  // Des sections seulement (offres_sections).
  const liens = lireOffresSections(donnees.offres_sections, new Set(sectionParCle.keys()))
  for (const { offre, cle } of liens) {
    if (!(await offreExiste(offre))) throw new Error(`offre inconnue : ${offre}`)
    const n = await tx.$executeRawUnsafe(
      `insert into public.academie_offre_contenus (offre_id, module_id, section_id)
       select o.id, $2::uuid, $3::uuid from public.academie_offres o where o.slug = $1
       on conflict do nothing`, offre, moduleId, sectionParCle.get(cle))
    bilan.offres_sections.push(`${offre}:${cle} (${n ? 'ajoutee' : 'deja la'})`)
  }
  bilan.offres_sections_retirees = await tx.$executeRawUnsafe(
    `delete from public.academie_offre_contenus c using public.academie_offres o
     where c.offre_id = o.id and c.module_id = $1::uuid and c.section_id is not null
       and not exists (
         select 1 from unnest($2::text[], $3::uuid[]) as v(slug, section_id)
          where v.slug = o.slug and v.section_id = c.section_id)`,
    moduleId, liens.map(l => l.offre), liens.map(l => sectionParCle.get(l.cle)))

  return bilan
}

// ---------------------------------------------------------------------------
// Ligne de commande
// ---------------------------------------------------------------------------

const estLanceDirectement = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (estLanceDirectement) {
  const [chemin, option] = process.argv.slice(2)
  if (!chemin) {
    console.error('Usage : node scripts/importer-catalogue-academie.mjs <module.json> [--ecrire]')
    process.exit(2)
  }
  const ecrire = option === '--ecrire'
  const donnees = JSON.parse(readFileSync(chemin, 'utf8'))
  const dossier = dirname(resolve(chemin))
  const prisma = new PrismaClient()
  class Annulation extends Error {}
  let bilan = { module: donnees.module?.slug }

  try {
    await prisma.$transaction(async tx => {
      bilan = await importerModule(tx, donnees, dossier)
      if (!ecrire) throw new Annulation()
    }, { timeout: 120_000, maxWait: 20_000 })
    console.log('ECRIT :', JSON.stringify(bilan))
  } catch (e) {
    if (e instanceof Annulation) console.log('ESSAI A BLANC (rien ecrit) :', JSON.stringify(bilan))
    else { console.error('ECHEC, rien ecrit :', e.message); process.exitCode = 1 }
  } finally {
    await prisma.$disconnect()
  }
}
