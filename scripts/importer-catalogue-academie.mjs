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
// par (module, slug) ; relancer le meme fichier met a jour sans dupliquer. Les offres listees dans
// « offres » ouvrent le module entier ; un lien d'offre au niveau du module qui n'est plus liste est
// retire (les liens par section, eux, ne sont pas touches). Le contenu d'une lecon ecrite peut venir
// d'un fichier Markdown (« contenu_fichier », chemin relatif au fichier de donnees).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'

const [chemin, option] = process.argv.slice(2)
if (!chemin) {
  console.error('Usage : node scripts/importer-catalogue-academie.mjs <module.json> [--ecrire]')
  process.exit(2)
}
const ecrire = option === '--ecrire'
const donnees = JSON.parse(readFileSync(chemin, 'utf8'))
const dossier = dirname(resolve(chemin))
const m = donnees.module
const prisma = new PrismaClient()
class Annulation extends Error {}
const bilan = { module: m.slug, sections: 0, lecons: 0, offres: [], offres_retirees: 0 }

try {
  await prisma.$transaction(async tx => {
    const [mod] = await tx.$queryRawUnsafe(
      `insert into public.academie_modules (slug, titre, resume, ordre, parcours, statut, auteur, image, prix_eur)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric)
       on conflict (slug) do update set titre = excluded.titre, resume = excluded.resume, ordre = excluded.ordre,
         parcours = excluded.parcours, statut = excluded.statut, auteur = excluded.auteur, image = excluded.image,
         prix_eur = excluded.prix_eur
       returning id`,
      m.slug, m.titre, m.resume ?? null, m.ordre ?? 0, m.parcours ?? null, m.statut ?? 'brouillon',
      m.auteur ?? null, m.image ?? null, m.prix_eur ?? null,
    )
    const moduleId = mod.id

    const sectionParCle = new Map()
    for (const s of donnees.sections ?? []) {
      const deja = await tx.$queryRawUnsafe(
        `select id from public.academie_sections where module_id = $1::uuid and ordre = $2`, moduleId, s.ordre)
      let id
      if (deja.length) {
        id = deja[0].id
        await tx.$executeRawUnsafe(`update public.academie_sections set titre = $2 where id = $1::uuid`, id, s.titre)
      } else {
        const [n] = await tx.$queryRawUnsafe(
          `insert into public.academie_sections (module_id, ordre, titre) values ($1::uuid, $2, $3) returning id`,
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

    const voulues = donnees.offres ?? []
    for (const slug of voulues) {
      const n = await tx.$executeRawUnsafe(
        `insert into public.academie_offre_contenus (offre_id, module_id)
         select o.id, $2::uuid from public.academie_offres o where o.slug = $1
         on conflict do nothing`, slug, moduleId)
      const existe = await tx.$queryRawUnsafe(`select 1 from public.academie_offres where slug = $1`, slug)
      if (!existe.length) throw new Error(`offre inconnue : ${slug}`)
      bilan.offres.push(n ? `${slug} (ajoutee)` : `${slug} (deja la)`)
    }
    bilan.offres_retirees = await tx.$executeRawUnsafe(
      `delete from public.academie_offre_contenus c using public.academie_offres o
       where c.offre_id = o.id and c.module_id = $1::uuid and c.section_id is null and not (o.slug = any($2::text[]))`,
      moduleId, voulues)

    if (!ecrire) throw new Annulation()
  })
  console.log('ECRIT :', JSON.stringify(bilan))
} catch (e) {
  if (e instanceof Annulation) console.log('ESSAI A BLANC (rien ecrit) :', JSON.stringify(bilan))
  else { console.error('ECHEC, rien ecrit :', e.message); process.exitCode = 1 }
} finally {
  await prisma.$disconnect()
}
