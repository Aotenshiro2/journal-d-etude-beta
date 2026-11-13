// Les ANNONCES de l'academie (13/11/2026, branche academie-navigation ; migration
// 20261113160000_academie_annonces.sql du workspace).
//
// Brice, 13/11 : « Billets » devient « Annonces » (le mot vit dans une seule
// constante du site), une vraie page avec les recentes en haut et les anciennes
// dessous, les 75 annonces Skool comprises.
//
// LE STOCKAGE NE CHANGE PAS : une annonce EST un billet (billets.ts) : une lecon
// (titre, texte en Markdown, images dans le texte) et une ligne de academie_billets.
// La migration ajoute a academie_billets origine ('cockpit' | 'skool'), source
// (cle d'import, unique), categorie (filtre de la page) et epingle_le.
//
// CE QUE VOIT LE MEMBRE (tout compte connecte, gratuit compris) :
// - les billets du cockpit publies (lecon et module publies, heure passee, pas
//   retires), les plus recents d'abord ;
// - dessous, les annonces reprises de Skool (origine skool) : leurs lecons vivent
//   dans le module d'archive « annonces-skool », jamais dans le catalogue ;
// - non lue : un billet du cockpit de moins de NON_LUE_JOURS jours que le compte
//   n'a pas encore vu (academie_billets_vus, la table du pop-up : lu ici = le
//   pop-up ne revient pas). Une annonce Skool n'est jamais « non lue ».
// Lecture seule : on repond dans Questions (le salon), pas ici.
//
// CE FICHIER N'IMPORTE RIEN, expres (comme billets.ts) : scripts/verifier-annonces.mjs
// et scripts/importer-annonces-skool.mjs l'importent tel quel sous Node 22.

/** Un billet du cockpit est « non lu » pendant 30 jours au plus (un nouveau compte n'herite pas d'un mur de points). */
export const NON_LUE_JOURS = 30
/** Plafond de la liste (75 annonces Skool + les billets a venir). */
export const MAX_ANNONCES = 400
/** Plafond d'un POST { vues } (une page en montre bien moins). */
export const MAX_VUES = 100

export const MODULE_ARCHIVE_SKOOL = 'annonces-skool'

export type Origine = 'cockpit' | 'skool'

/** Les categories de la page (filtres). Un billet du cockpit n'en a pas (null). */
export const CATEGORIES = ['lives', 'academie', 'apps', 'echos', 'partenaires', 'marches'] as const
export type Categorie = (typeof CATEGORIES)[number]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// ---------------------------------------------------------------------------
// Pur : la categorie d'une annonce Skool, d'apres son titre
// ---------------------------------------------------------------------------

/**
 * La categorie d'une annonce reprise de Skool, d'apres son titre. Ordre voulu :
 * les apps et les Echos d'abord (« Release », « Echos » ne trompent pas), puis les
 * lives (« Live Beat The Propfirm » est un live, pas une offre partenaire), puis
 * les partenaires, les marches, et l'academie pour tout le reste (cursus,
 * niveaux, Skool, coaching...). Teste par scripts/verifier-annonces.mjs sur les
 * 75 titres de l'export.
 */
export function categorieDe(titre: string): Categorie {
  const t = titre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (/trading notes?|carnet du trader|release|patch notes?|journal d.?etudes|roadmap|\bapps?\b|notion|workbook/.test(t)) return 'apps'
  if (/echos|monthly news/.test(t)) return 'echos'
  if (/\blives?\b|liveclub|replay|masterclass|meeting|\bfaq\b|deep dive|nouvelle video/.test(t)) return 'lives'
  if (/topstep|phidias|propfirm|code promo|\bpromo\b/.test(t)) return 'partenaires'
  if (/marche|vigilance|message du jour|bon lundi|update du mercredi|debut de semaine/.test(t)) return 'marches'
  return 'academie'
}

// ---------------------------------------------------------------------------
// Pur : le texte d'une annonce Skool pour sa lecon
// ---------------------------------------------------------------------------

export type PieceJointe = { fichier?: string; type?: string; nom_origine?: string; telechargement?: string }

/**
 * Les echappements de l'export Skool (« \( », « \- », « \. ») retires : le texte
 * des lecons ne les lit pas. On ne touche ni aux asterisques ni aux crochets, qui
 * changeraient la mise en forme.
 */
export function desechapper(texte: string): string {
  return texte.replace(/\\([()\-.!#+_~>|])/g, '$1')
}

/** Le nom publie d'une piece jointe : l'image passe en WebP, le PDF reste un PDF. */
export function fichierPublie(fichier: string): { nom: string; image: boolean } | null {
  const base = fichier.split('/').pop() ?? ''
  const m = /^(.+)\.([A-Za-z0-9]+)$/.exec(base)
  if (!m) return null
  const ext = m[2].toLowerCase()
  const propre = m[1].normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'piece'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ext)) return { nom: `${propre}.webp`, image: true }
  if (ext === 'pdf') return { nom: `${propre}.pdf`, image: false }
  return null
}

/**
 * Le texte de la lecon d'une annonce Skool : le texte de l'annonce (tel que dans
 * cockpit_annonces_envoyees), sans les echappements, puis ses images, chacune seule
 * sur sa ligne (le lecteur Markdown du site les montre), et ses PDF en ressources.
 * base : ou les pieces jointes sont publiees (/media/academie/annonces ou une URL
 * https), suivi de /<slug du post>/<fichier>.
 */
export function texteAnnonceSkool(
  contenu: string,
  slug: string,
  pieces: PieceJointe[],
  base: string,
): { contenu: string; ressources: { titre: string; url: string }[]; images: number } {
  const racine = base.replace(/\/+$/, '')
  const lignes: string[] = []
  const ressources: { titre: string; url: string }[] = []
  let n = 0
  for (const p of pieces) {
    if (!p.fichier || (p.telechargement && p.telechargement !== 'ok')) continue
    const f = fichierPublie(p.fichier)
    if (!f) continue
    const url = `${racine}/${slug}/${f.nom}`
    if (f.image) { n++; lignes.push(`![Image ${n} de l'annonce](${url})`) }
    else ressources.push({ titre: p.nom_origine?.trim() || f.nom, url })
  }
  const texte = desechapper(contenu.replace(/\r\n?/g, '\n')).trim()
  return { contenu: lignes.length ? `${texte}\n\n${lignes.join('\n\n')}` : texte, ressources, images: n }
}

// ---------------------------------------------------------------------------
// Pur : la reponse de la route
// ---------------------------------------------------------------------------

export type LigneAnnonce = {
  id: string
  publie_le: Date | string
  origine: string | null
  categorie: string | null
  epingle_le: Date | string | null
  youtube_id: string | null
  titre: string
  contenu: string | null
  type: string
  ressources: unknown
  lecon_slug: string
  lecon_statut: string
  module_slug: string
  non_lue: boolean
}

export type Annonce = {
  id: string
  titre: string
  contenu: string
  publie_le: string
  origine: Origine
  categorie: Categorie | null
  epingle: boolean
  non_lue: boolean
  /** La lecon sur le site (billet du cockpit publie), ou null (archive Skool). */
  lien: string | null
  /** Une video a voir dans la lecon (Bunny) ou sur YouTube. */
  video: { hebergeur: 'youtube'; id: string } | { hebergeur: 'lecon' } | null
  /** Les pieces jointes publiques (https ou /media/) ; les protegees restent dans la lecon. */
  ressources: { titre: string; url: string }[]
}

const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : typeof d === 'string' ? new Date(d).toISOString() : '')

function ressourcesPubliques(brut: unknown): { titre: string; url: string }[] {
  if (!Array.isArray(brut)) return []
  const res: { titre: string; url: string }[] = []
  for (const r of brut) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.url !== 'string' || typeof o.titre !== 'string') continue
    if (o.protege === true || o.chemin) continue
    if (!/^(https:\/\/|\/media\/)/.test(o.url)) continue
    res.push({ titre: o.titre.slice(0, 200), url: o.url })
  }
  return res
}

/** Une ligne de la base en annonce pour la page (rien d'autre ne sort : ni auteur, ni compte). */
export function versAnnonce(l: LigneAnnonce): Annonce {
  const origine: Origine = l.origine === 'skool' ? 'skool' : 'cockpit'
  const categorie = (CATEGORIES as readonly string[]).includes(l.categorie ?? '') ? (l.categorie as Categorie) : null
  const lien = origine === 'cockpit' && l.lecon_statut === 'publie' ? `/academie/${l.module_slug}/${l.lecon_slug}` : null
  return {
    id: l.id,
    titre: l.titre,
    contenu: l.contenu ?? '',
    publie_le: iso(l.publie_le),
    origine,
    categorie,
    epingle: Boolean(l.epingle_le),
    non_lue: origine === 'cockpit' && l.non_lue === true,
    lien,
    video: l.youtube_id ? { hebergeur: 'youtube', id: l.youtube_id } : l.type === 'video' && lien ? { hebergeur: 'lecon' } : null,
    ressources: ressourcesPubliques(l.ressources),
  }
}

/** Le corps de POST { vues: [uuid, ...] } : les ids propres, sans doublon, MAX_VUES au plus. null = refus. */
export function lireVues(corps: unknown): string[] | null {
  const c = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>
  if (!Array.isArray(c.vues) || c.vues.length === 0 || c.vues.length > MAX_VUES) return null
  const ids = new Set<string>()
  for (const v of c.vues) {
    const id = typeof v === 'string' ? v.trim().toLowerCase() : ''
    if (!UUID_RE.test(id)) return null
    ids.add(id)
  }
  return [...ids]
}

// ---------------------------------------------------------------------------
// La base
// ---------------------------------------------------------------------------

export type ClientSql = {
  $queryRawUnsafe<T = unknown>(sql: string, ...valeurs: unknown[]): Promise<T>
  $executeRawUnsafe(sql: string, ...valeurs: unknown[]): Promise<number>
}

// $1 = compte, $2 = jours d'une annonce « non lue », $3 = plafond.
// Un billet du cockpit : lecon et module publies (comme le billet du jour). Une annonce
// Skool : son module d'archive n'est jamais publie, elle se lit ici seulement.
export const SQL_ANNONCES = `
select b.id::text as id, b.publie_le, b.origine, b.categorie, b.epingle_le, b.youtube_id,
       l.titre, l.contenu, l.type, l.ressources, l.slug as lecon_slug, l.statut as lecon_statut, m.slug as module_slug,
       (b.origine = 'cockpit'
         and b.publie_le > now() - make_interval(days => $2::int)
         and not exists (select 1 from public.academie_billets_vus v where v.billet_id = b.id and v.user_id = $1::uuid)) as non_lue
  from public.academie_billets b
  join public.academie_lecons l on l.id = b.lecon_id
  join public.academie_modules m on m.id = l.module_id
 where b.retire_le is null and b.publie_le <= now()
   and (b.origine = 'skool' or (l.statut = 'publie' and m.statut = 'publie'))
 order by b.publie_le desc
 limit $3::int
`

// Avant la migration du 13/11 (colonnes absentes) : les billets du cockpit seulement.
export const SQL_ANNONCES_AVANT_MIGRATION = `
select b.id::text as id, b.publie_le, 'cockpit'::text as origine, null::text as categorie, null::timestamptz as epingle_le, b.youtube_id,
       l.titre, l.contenu, l.type, l.ressources, l.slug as lecon_slug, l.statut as lecon_statut, m.slug as module_slug,
       (b.publie_le > now() - make_interval(days => $2::int)
         and not exists (select 1 from public.academie_billets_vus v where v.billet_id = b.id and v.user_id = $1::uuid)) as non_lue
  from public.academie_billets b
  join public.academie_lecons l on l.id = b.lecon_id
  join public.academie_modules m on m.id = l.module_id
 where b.retire_le is null and b.publie_le <= now() and l.statut = 'publie' and m.statut = 'publie'
 order by b.publie_le desc
 limit $3::int
`

const SQL_NOTER_VUES = `
insert into public.academie_billets_vus (billet_id, user_id)
select b.id, $2::uuid from public.academie_billets b where b.id = any($1::uuid[])
on conflict (billet_id, user_id) do nothing
`

/** Colonne absente (la migration du 13/11 n'est pas encore appliquee). */
export function colonneAbsente(err: unknown): boolean {
  return /42703|column .* does not exist/i.test(err instanceof Error ? err.message : String(err))
}

/** Les annonces du compte, les plus recentes d'abord. */
export async function lireAnnonces(c: ClientSql, userId: string): Promise<Annonce[]> {
  let lignes: LigneAnnonce[]
  try {
    lignes = await c.$queryRawUnsafe<LigneAnnonce[]>(SQL_ANNONCES, userId, NON_LUE_JOURS, MAX_ANNONCES)
  } catch (err) {
    if (!colonneAbsente(err)) throw err
    lignes = await c.$queryRawUnsafe<LigneAnnonce[]>(SQL_ANNONCES_AVANT_MIGRATION, userId, NON_LUE_JOURS, MAX_ANNONCES)
  }
  return lignes.map(versAnnonce)
}

/** Le compte a vu ces annonces (page ouverte) : plus de point, et le pop-up ne revient pas. Rend le nombre de lignes ajoutees. */
export async function noterAnnoncesVues(c: ClientSql, ids: string[], userId: string): Promise<number> {
  if (!ids.length) return 0
  return c.$executeRawUnsafe(SQL_NOTER_VUES, ids, userId)
}

/** Ce que la barre et l'accueil demandent (GET ?resume=1) : le nombre de non lues et la derniere annonce. */
export function resumer(annonces: Annonce[]): { non_lues: number; derniere: Pick<Annonce, 'id' | 'titre' | 'publie_le' | 'non_lue' | 'origine'> | null } {
  const d = annonces[0]
  return {
    non_lues: annonces.filter(a => a.non_lue).length,
    derniere: d ? { id: d.id, titre: d.titre, publie_le: d.publie_le, non_lue: d.non_lue, origine: d.origine } : null,
  }
}
