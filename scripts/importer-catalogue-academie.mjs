// Importe UN module du catalogue de l'academie depuis son fichier de donnees.
//
//   node scripts/importer-catalogue-academie.mjs <module.json> [--ecrire]
//
// Sans --ecrire, le script joue tout dans une transaction puis l'ANNULE (essai a blanc) et dit ce
// qu'il aurait fait. Avec --ecrire, il valide. Les fichiers de donnees vivent hors du depot :
// D:\6_Societe\Pilotage\Academie\catalogue\modules\<slug>.json (un module par fichier, remplis jour
// apres jour, plan section 12). Ce qui fait foi sur le contenu : D:\3_Pedagogie\CARTE-DES-FORMATIONS.md.
//
// Idempotent : le module se retrouve par son slug, une section par son ordre dans le fichier (ordre_fichier,
// depuis le 23/10), une lecon par (module, slug) puis par son origine ; relancer le meme fichier met a jour sans dupliquer. Le contenu d'une lecon ecrite
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
// Les modifications faites dans l'app par l'admin (23/10/2026, route /api/academie/edition, migration
// 20261023120000_academie_editions.sql) : tant que edite_le est rempli, l'import GARDE le titre et le
// texte de la lecon (le titre et le resume du module) de la base, et le dit dans son bilan
// (« garde : modifie dans l'app »). Le reste (ordre, statut, video...) suit le fichier. Avec
// --ecraser-editions, le fichier l'emporte, edite_le repasse a vide et academie_editions garde ce qui
// a ete ecrase (origine 'import'). LA MIGRATION DOIT ETRE APPLIQUEE avant d'importer.
//
// Le rangement fait dans le cockpit (23/10/2026, arbre du catalogue, route /api/academie/arbre,
// migration 20261023150000_academie_arbre.sql ; src/lib/academie/arbre.ts, planImport*) :
// - une lecon se retrouve par (module, slug), PUIS par son origine (origine_module_id, origine_slug) :
//   deplacee dans un AUTRE module, elle n'est ni ramenee ni recreee ici ; ses autres champs (video,
//   texte non modifie, ressources...) suivent le fichier, sa place non (« garde : deplace dans le
//   cockpit ») ;
// - une lecon, une section ou un module reordonne dans le cockpit (deplace_le) garde sa place ; un
//   statut change dans le cockpit (statut_le) est garde s'il tient encore (une video publiee dont le
//   fichier retire la video repasse au statut du fichier : « attention ») ;
// - une section se retrouve par ordre_fichier (son ordre dans le fichier), plus par son ordre : une
//   section creee dans le cockpit (ordre_fichier vide) n'est jamais touchee ;
// - une lecon arrivee d'un autre module qui porte le slug d'une lecon du fichier : l'import s'arrete
//   (rien d'ecrit) et dit laquelle renommer ;
// - --ecraser-editions remet aussi le fichier pour la place et le statut (la lecon revient dans son
//   module d'origine), vide les marques et note ce qui est defait (academie_editions, origine import).
// LA MIGRATION 20261023150000 DOIT ETRE APPLIQUEE avant d'importer.
//
// importerModule(tx, donnees, dossier, options) est exportee pour les scripts essayer-migration-*
// (memes ordres, dans une transaction toujours annulee).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { fusionImport, lireOffresSections } from '../src/lib/academie/pur.ts'
import { SQL_EDITION_HISTORIQUE_IMPORT } from '../src/lib/academie/requetes.ts'
import { planImportLecon, planImportModule, planImportSection } from '../src/lib/academie/arbre.ts'

// Une lecon telle qu'elle est en base, avec ses marques (edition, place, statut, origine).
const SELECT_LECON = `select id::text as id, module_id::text as module_id, section_id::text as section_id, slug, ordre,
  statut, titre, contenu, edite_le is not null as edite, deplace_le is not null as deplace,
  statut_le is not null as statut_modifie, origine_module_id::text as origine_module_id, origine_slug
  from public.academie_lecons`

/**
 * Joue l'import d'un module dans la transaction tx. Rend le bilan. Jette sur une donnee invalide.
 * options.ecraserEditions : le fichier remplace aussi les textes modifies dans l'app.
 */
export async function importerModule(tx, donnees, dossier, { ecraserEditions = false } = {}) {
  const m = donnees.module
  const bilan = {
    module: m.slug, sections: 0, lecons: 0, offres: [], offres_retirees: 0, offres_sections: [], offres_sections_retirees: 0,
    gardees: [], editions_ecrasees: [],
    // Le rangement du cockpit (arbre) : garde, defait par --ecraser-editions, ou abandonne (avertissement).
    places_gardees: [], statuts_gardes: [], rangements_ecrases: [], avertissements: [],
  }
  // Ce que l'import defait du rangement du cockpit : dans l'historique, et dans le bilan si c'est force.
  const noterRangement = async (cible, id, nom, plan) => {
    if (plan.historique.length) await tx.$executeRawUnsafe(SQL_EDITION_HISTORIQUE_IMPORT, cible, id, JSON.stringify(plan.historique))
    if (ecraserEditions && (plan.effacerPlace || plan.effacerStatut)) bilan.rangements_ecrases.push(nom)
  }

  // Le module tel qu'il est en base (verrouille jusqu'a la fin de l'import) : une edition, un rangement dans l'app ?
  const [modBase] = await tx.$queryRawUnsafe(
    `select id::text as id, titre, resume, ordre, statut, edite_le is not null as edite, deplace_le is not null as deplace,
            statut_le is not null as statut_modifie
       from public.academie_modules where slug = $1 for update`,
    m.slug)
  const fm = fusionImport(
    modBase ? { edite: modBase.edite, textes: { titre: modBase.titre, resume: modBase.resume } } : null,
    { titre: m.titre, resume: m.resume ?? null },
    ecraserEditions,
  )
  const pm = planImportModule(
    modBase ? { ordre: modBase.ordre, statut: modBase.statut, deplace: modBase.deplace, statut_modifie: modBase.statut_modifie } : null,
    { ordre: m.ordre ?? 0, statut: m.statut ?? 'brouillon' },
    ecraserEditions,
  )
  const [mod] = await tx.$queryRawUnsafe(
    `insert into public.academie_modules (slug, titre, resume, ordre, parcours, statut, auteur, image, prix_eur)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric)
     on conflict (slug) do update set titre = excluded.titre, resume = excluded.resume, ordre = excluded.ordre,
       parcours = excluded.parcours, statut = excluded.statut, auteur = excluded.auteur, image = excluded.image,
       prix_eur = excluded.prix_eur,
       edite_le = case when $10::boolean then null else academie_modules.edite_le end,
       edite_par = case when $10::boolean then null else academie_modules.edite_par end,
       deplace_le = case when $11::boolean then null else academie_modules.deplace_le end,
       statut_le = case when $12::boolean then null else academie_modules.statut_le end
     returning id::text as id`,
    m.slug, fm.valeurs.titre, fm.valeurs.resume, pm.ordre, m.parcours ?? null, pm.statut,
    m.auteur ?? null, m.image ?? null, m.prix_eur ?? null, fm.effacerEdition, pm.effacerPlace, pm.effacerStatut,
  )
  const moduleId = mod.id
  if (fm.garde) bilan.gardees.push(`module ${m.slug} (titre et resume)`)
  if (fm.effacerEdition) {
    bilan.editions_ecrasees.push(`module ${m.slug}`)
    if (fm.historique.length) await tx.$executeRawUnsafe(SQL_EDITION_HISTORIQUE_IMPORT, 'module', moduleId, JSON.stringify(fm.historique))
  }
  if (pm.gardePlace) bilan.places_gardees.push(`module ${m.slug} (ordre ${pm.ordre})`)
  if (pm.gardeStatut) bilan.statuts_gardes.push(`module ${m.slug} (${pm.statut})`)
  await noterRangement('module', moduleId, `module ${m.slug}`, pm)

  // Une section se retrouve par ordre_fichier (son ordre dans le fichier) : reordonnee dans le
  // cockpit, elle reste la meme ; creee dans le cockpit (ordre_fichier vide), elle n'est jamais touchee.
  const sectionParCle = new Map()
  for (const s of donnees.sections ?? []) {
    const [deja] = await tx.$queryRawUnsafe(
      `select id::text as id, ordre, deplace_le is not null as deplace from public.academie_sections
        where module_id = $1::uuid and ordre_fichier = $2 order by ordre, id limit 1 for update`, moduleId, s.ordre)
    let id
    if (deja) {
      id = deja.id
      const ps = planImportSection({ ordre: deja.ordre, deplace: deja.deplace }, { ordre: s.ordre }, ecraserEditions)
      await tx.$executeRawUnsafe(
        `update public.academie_sections set titre = $2, ordre = $3,
           deplace_le = case when $4::boolean then null else deplace_le end
         where id = $1::uuid`, id, s.titre, ps.ordre, ps.effacerPlace)
      if (ps.gardePlace) bilan.places_gardees.push(`section ${s.cle} (ordre ${ps.ordre})`)
      await noterRangement('section', id, `section ${s.cle}`, { ...ps, effacerStatut: false })
    } else {
      const [n] = await tx.$queryRawUnsafe(
        `insert into public.academie_sections (module_id, ordre, ordre_fichier, titre) values ($1::uuid, $2, $2, $3) returning id::text as id`,
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
    const hebergeur = video ? (l.hebergeur ?? 'bunny') : null
    const bunnyVideoId = video ? (l.bunny_video_id ?? null) : null
    const wistiaId = video ? (l.wistia_id ?? null) : null
    // Par (module, slug) d'abord ; une lecon ARRIVEE d'un autre module sous ce slug n'est pas celle du fichier.
    let [leconBase] = await tx.$queryRawUnsafe(`${SELECT_LECON} where module_id = $1::uuid and slug = $2 for update`, moduleId, l.slug)
    if (leconBase && leconBase.origine_module_id && leconBase.origine_module_id !== moduleId) {
      throw new Error(`conflit de slug : la lecon « ${l.slug} » du fichier porte le slug d'une lecon arrivee d'un autre module `
        + `dans le cockpit (« ${leconBase.titre} »). Change le slug dans le fichier, ou deplace cette lecon, puis relance.`)
    }
    // Puis par son origine : deplacee dans un autre module depuis le cockpit, elle n'est ni ramenee ni recreee.
    if (!leconBase) {
      [leconBase] = await tx.$queryRawUnsafe(`${SELECT_LECON} where origine_module_id = $1::uuid and origine_slug = $2 for update`, moduleId, l.slug)
    }
    const fl = fusionImport(
      leconBase ? { edite: leconBase.edite, textes: { titre: leconBase.titre, contenu: leconBase.contenu } } : null,
      { titre: l.titre, contenu },
      ecraserEditions,
    )
    const pl = planImportLecon(
      leconBase ? {
        id: leconBase.id, module_id: leconBase.module_id, section_id: leconBase.section_id, slug: leconBase.slug,
        ordre: leconBase.ordre, statut: leconBase.statut, deplace: leconBase.deplace, statut_modifie: leconBase.statut_modifie,
        origine_module_id: leconBase.origine_module_id, origine_slug: leconBase.origine_slug,
      } : null,
      {
        module_id: moduleId, section_id: sectionId ?? null, slug: l.slug, ordre: l.ordre, statut: l.statut ?? 'brouillon',
        type: l.type, heberge: Boolean(bunnyVideoId || wistiaId), contenu: fl.valeurs.contenu,
      },
      ecraserEditions,
    )
    // Les champs qui suivent toujours le fichier (le texte et le titre : selon l'edition dans l'app).
    const champs = [
      l.type, l.format ?? 'cours', l.usage ?? 'interne', hebergeur,
      video && hebergeur === 'bunny' ? (l.bunny_bibliotheque ?? 'formation') : null,
      bunnyVideoId, wistiaId, l.duree_s ?? null, fl.valeurs.contenu, JSON.stringify(l.ressources ?? []), Boolean(l.apercu),
    ]
    if (leconBase) {
      await tx.$executeRawUnsafe(
        `update public.academie_lecons set module_id = $2::uuid, section_id = $3::uuid, slug = $4, ordre = $5, titre = $6,
           type = $7, format = $8, usage = $9, hebergeur = $10, bunny_bibliotheque = $11, bunny_video_id = $12,
           wistia_id = $13, duree_s = $14, contenu = $15, ressources = $16::jsonb, apercu = $17, statut = $18,
           edite_le = case when $19::boolean then null else edite_le end,
           edite_par = case when $19::boolean then null else edite_par end,
           deplace_le = case when $20::boolean then null else deplace_le end,
           origine_module_id = case when $20::boolean then null else origine_module_id end,
           origine_slug = case when $20::boolean then null else origine_slug end,
           statut_le = case when $21::boolean then null else statut_le end
         where id = $1::uuid`,
        leconBase.id, pl.module_id, pl.section_id, pl.slug, pl.ordre, fl.valeurs.titre, ...champs, pl.statut,
        fl.effacerEdition, pl.effacerPlace, pl.effacerStatut,
      )
    } else {
      await tx.$executeRawUnsafe(
        `insert into public.academie_lecons (module_id, section_id, slug, ordre, titre, type, format, usage, hebergeur,
           bunny_bibliotheque, bunny_video_id, wistia_id, duree_s, contenu, ressources, apercu, statut)
         values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17)`,
        moduleId, sectionId ?? null, l.slug, l.ordre, fl.valeurs.titre, ...champs, pl.statut,
      )
    }
    if (fl.garde) bilan.gardees.push(`lecon ${l.slug} (titre et texte)`)
    if (pl.gardePlace) bilan.places_gardees.push(`lecon ${l.slug}${pl.ailleurs ? ` (dans un autre module, slug ${pl.slug})` : ` (ordre ${pl.ordre})`}`)
    if (pl.gardeStatut) bilan.statuts_gardes.push(`lecon ${l.slug} (${pl.statut})`)
    if (pl.avertissement) bilan.avertissements.push(`lecon ${l.slug} : ${pl.avertissement}`)
    if (leconBase) await noterRangement('lecon', leconBase.id, `lecon ${l.slug}`, pl)
    if (fl.effacerEdition) {
      bilan.editions_ecrasees.push(`lecon ${l.slug}`)
      if (fl.historique.length) await tx.$executeRawUnsafe(SQL_EDITION_HISTORIQUE_IMPORT, 'lecon', leconBase.id, JSON.stringify(fl.historique))
    }
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
  const args = process.argv.slice(2)
  const OPTIONS = new Set(['--ecrire', '--ecraser-editions'])
  const chemin = args.find(a => !a.startsWith('--'))
  const inconnues = args.filter(a => a.startsWith('--') && !OPTIONS.has(a))
  if (!chemin || inconnues.length) {
    if (inconnues.length) console.error(`Option inconnue : ${inconnues.join(' ')}`)
    console.error('Usage : node scripts/importer-catalogue-academie.mjs <module.json> [--ecrire] [--ecraser-editions]')
    process.exit(2)
  }
  const ecrire = args.includes('--ecrire')
  const ecraserEditions = args.includes('--ecraser-editions')
  const donnees = JSON.parse(readFileSync(chemin, 'utf8'))
  const dossier = dirname(resolve(chemin))
  const prisma = new PrismaClient()
  class Annulation extends Error {}
  let bilan = { module: donnees.module?.slug }
  // Ce que l'import a garde (modifie dans l'app) ou ecrase (--ecraser-editions), ligne par ligne.
  const dire = () => {
    for (const g of bilan.gardees ?? []) console.log(`garde : modifie dans l'app : ${g}`)
    for (const e of bilan.editions_ecrasees ?? []) console.log(`ecrase (--ecraser-editions) : ${e}, l'ancienne version est dans academie_editions`)
    for (const g of bilan.places_gardees ?? []) console.log(`garde : deplace dans le cockpit : ${g}`)
    for (const g of bilan.statuts_gardes ?? []) console.log(`garde : statut change dans le cockpit : ${g}`)
    for (const e of bilan.rangements_ecrases ?? []) console.log(`ecrase (--ecraser-editions) : rangement du cockpit defait : ${e}, l'ancienne place est dans academie_editions`)
    for (const a of bilan.avertissements ?? []) console.log(`attention : ${a}`)
  }

  try {
    await prisma.$transaction(async tx => {
      bilan = await importerModule(tx, donnees, dossier, { ecraserEditions })
      if (!ecrire) throw new Annulation()
    }, { timeout: 120_000, maxWait: 20_000 })
    console.log('ECRIT :', JSON.stringify(bilan))
    dire()
  } catch (e) {
    if (e instanceof Annulation) { console.log('ESSAI A BLANC (rien ecrit) :', JSON.stringify(bilan)); dire() }
    else { console.error('ECHEC, rien ecrit :', e.message); process.exitCode = 1 }
  } finally {
    await prisma.$disconnect()
  }
}
