// Le catalogue de l'academie (tables academie_modules, academie_sections,
// academie_lecons ; migration 20261015210000), lu par le serveur du journal.
//
// - lireCatalogue : ce que montrent les ecrans (modules publies ou a venir,
//   leurs sections, leurs lecons publiees ou a venir), SANS identifiant
//   d'hebergeur ni contenu. Cache de 30 s par instance : le catalogue change
//   rarement, et l'ecran d'accueil le demande a chaque visite.
// - lireLeconParId, lireLeconsParVideo : une lecon entiere (identifiants
//   Bunny ou Wistia, contenu), lue FRAICHE a chaque lecture, pour la route
//   de lecture qui decide du droit juste apres.
//
// Les fonctions jettent sur une panne de base ; une table absente (migration
// pas encore appliquee) se reconnait avec relationAbsente.

import { prisma } from '@/lib/db'
import { ressourcesPropres, type Ressource, type TypeLecon } from './pur'
import {
  SQL_LECON_PAR_ID, SQL_LECONS_PAR_VIDEO, SQL_LECONS_VISIBLES, SQL_MODULES_VISIBLES, SQL_OFFRES_DES_MODULES,
  SQL_SECTIONS_VISIBLES,
} from './requetes'

export type StatutContenu = 'brouillon' | 'publie' | 'archive' | 'a_venir'

export type ModuleCatalogue = {
  id: string
  slug: string
  titre: string
  resume: string | null
  ordre: number
  parcours: string | null
  statut: StatutContenu
  auteur: string | null
  image: string | null
  /** Prix du module vendu seul (vide = pas vendu seul). */
  prixEur: number | null
}

/** Une offre qui ouvre quelque chose d'un module (cadenas des ecrans). */
export type OffreDuModule = {
  slug: string
  titre: string
  type: string
  prixEur: number | null
  /** module : le module entier ; sections : une partie ; tout : l'offre ouvre tout le catalogue (ETM). */
  portee: 'module' | 'sections' | 'tout'
}

export type SectionCatalogue = { id: string; moduleId: string; ordre: number; titre: string }

export type LeconCatalogue = {
  id: string
  moduleId: string
  sectionId: string | null
  slug: string
  ordre: number
  titre: string
  type: TypeLecon
  format: string
  usage: string
  dureeS: number | null
  apercu: boolean
  statut: StatutContenu
}

export type Catalogue = {
  modules: ModuleCatalogue[]
  sections: SectionCatalogue[]
  lecons: LeconCatalogue[]
  /** Par module : les offres qui ouvrent le module ou une de ses sections, puis celles qui ouvrent tout. */
  offresParModule: Map<string, OffreDuModule[]>
}

export type LeconComplete = LeconCatalogue & {
  hebergeur: 'bunny' | 'wistia' | null
  bunnyBibliotheque: string | null
  bunnyVideoId: string | null
  wistiaId: string | null
  contenu: string | null
  ressources: Ressource[]
  moduleStatut: StatutContenu
  moduleSlug: string
  moduleTitre: string
}

const DUREE_CACHE_MS = 30_000
let cache: { catalogue: Catalogue; expire: number } | null = null
let lectureEnCours: Promise<Catalogue> | null = null

type LigneModule = {
  id: string; slug: string; titre: string; resume: string | null; ordre: number; parcours: string | null
  statut: StatutContenu; auteur: string | null; image: string | null; prix_eur: number | null
}
type LigneOffre = {
  module_id: string | null; slug: string; titre: string; type: string; prix_eur: number | null
  portee: 'module' | 'sections' | 'tout'
}
type LigneSection = { id: string; module_id: string; ordre: number; titre: string }
type LigneLecon = {
  id: string; module_id: string; section_id: string | null; slug: string; ordre: number; titre: string
  type: TypeLecon; format: string; usage: string; duree_s: number | null; apercu: boolean; statut: StatutContenu
}
type LigneLeconComplete = LigneLecon & {
  hebergeur: 'bunny' | 'wistia' | null; bunny_bibliotheque: string | null; bunny_video_id: string | null
  wistia_id: string | null; contenu: string | null; ressources: unknown
  module_statut: StatutContenu; module_slug: string; module_titre: string
}

function leconDeLigne(l: LigneLecon): LeconCatalogue {
  return {
    id: l.id,
    moduleId: l.module_id,
    sectionId: l.section_id,
    slug: l.slug,
    ordre: l.ordre,
    titre: l.titre,
    type: l.type,
    format: l.format,
    usage: l.usage,
    dureeS: l.duree_s,
    apercu: l.apercu,
    statut: l.statut,
  }
}

async function lireCatalogueEnBase(): Promise<Catalogue> {
  const modules = await prisma.$queryRawUnsafe<LigneModule[]>(SQL_MODULES_VISIBLES)
  const sections = await prisma.$queryRawUnsafe<LigneSection[]>(SQL_SECTIONS_VISIBLES)
  const lecons = await prisma.$queryRawUnsafe<LigneLecon[]>(SQL_LECONS_VISIBLES)
  const offres = await prisma.$queryRawUnsafe<LigneOffre[]>(SQL_OFFRES_DES_MODULES)

  const offreDeLigne = (o: LigneOffre): OffreDuModule =>
    ({ slug: o.slug, titre: o.titre, type: o.type, prixEur: o.prix_eur, portee: o.portee })
  const offresTout = offres.filter(o => o.module_id === null).map(offreDeLigne)
  const offresParModule = new Map<string, OffreDuModule[]>()
  for (const m of modules) {
    offresParModule.set(m.id, [
      ...offres.filter(o => o.module_id === m.id).map(offreDeLigne),
      ...offresTout,
    ])
  }

  return {
    modules: modules.map(({ prix_eur, ...m }) => ({ ...m, prixEur: prix_eur })),
    sections: sections.map(s => ({ id: s.id, moduleId: s.module_id, ordre: s.ordre, titre: s.titre })),
    lecons: lecons.map(leconDeLigne),
    offresParModule,
  }
}

/** Le catalogue visible (cache de 30 s). Jette sur une panne de base. */
export async function lireCatalogue(): Promise<Catalogue> {
  if (cache && cache.expire > Date.now()) return cache.catalogue
  // Une seule lecture a la fois par instance : les appels simultanes l'attendent.
  lectureEnCours ??= lireCatalogueEnBase()
    .then(catalogue => {
      cache = { catalogue, expire: Date.now() + DUREE_CACHE_MS }
      return catalogue
    })
    .finally(() => { lectureEnCours = null })
  return lectureEnCours
}

function leconCompleteDeLigne(l: LigneLeconComplete): LeconComplete {
  return {
    ...leconDeLigne(l),
    hebergeur: l.hebergeur,
    bunnyBibliotheque: l.bunny_bibliotheque,
    bunnyVideoId: l.bunny_video_id,
    wistiaId: l.wistia_id,
    contenu: l.contenu,
    ressources: ressourcesPropres(l.ressources),
    moduleStatut: l.module_statut,
    moduleSlug: l.module_slug,
    moduleTitre: l.module_titre,
  }
}

/** Une lecon entiere par son id, quel que soit son statut (la route juge). null si elle n'existe pas. */
export async function lireLeconParId(id: string): Promise<LeconComplete | null> {
  const lignes = await prisma.$queryRawUnsafe<LigneLeconComplete[]>(SQL_LECON_PAR_ID, id)
  return lignes[0] ? leconCompleteDeLigne(lignes[0]) : null
}

/** Les lecons publiees (module publie) qui portent cette video Bunny. */
export async function lireLeconsParVideo(guid: string): Promise<LeconComplete[]> {
  const lignes = await prisma.$queryRawUnsafe<LigneLeconComplete[]>(SQL_LECONS_PAR_VIDEO, guid)
  return lignes.map(leconCompleteDeLigne)
}
