// Le BILLET DU JOUR de l'academie (27/10/2026, fonction validee par Brice le 27/10 ;
// migration 20261027190000_academie_billets.sql).
//
// Ce que voit l'eleve : quand Brice publie un billet, tout compte CONNECTE a
// l'academie le voit une fois en pop-up (ferme = ne revient plus pour ce compte,
// memorise ici, table academie_billets_vus), puis le lit librement pendant 48 h
// (bandeau de l'accueil). Ensuite le billet reste une lecon de la section
// « Billets » des Chroniques de l'Accelerateur, avec l'acces normal du module.
//
// LA CONCEPTION :
// - Le billet EST des sa creation une lecon de la section Billets (academie_lecons :
//   titre, texte en Markdown, video Bunny eventuelle). Rien ne se deplace a 48 h.
// - La fenetre libre est une REGLE DE DROITS : ouvertureLecon (pur.ts) ajoute la
//   raison 'billet' tant que maintenant < publie_le + 48 h (FENETRE_LIBRE_BILLET_H).
//   Le catalogue et la lecture lisent publie_le par une jointure sur academie_billets
//   (requetes.ts, billet_publie_le) : la route de lecture, les pieces jointes et l'ecran
//   d'accueil appliquent donc la meme regle sans code a part.
// - academie_billets porte ce que la lecon n'a pas : la date de publication, la video
//   YouTube eventuelle (une video Bunny vit dans la lecon, type video), et
//   publication_faite_le.
// - Programme : la lecon reste en brouillon jusqu'a l'heure. Pas de pg_cron sur ce
//   projet : publierBilletsEchus la publie a la premiere lecture qui suit (route du
//   billet du jour, appelee par chaque accueil de l'academie, et liste du cockpit),
//   UNE seule fois (publication_faite_le), et inscrit le pop-up dans
//   cockpit_annonces_envoyees (canal popup-academie, source billet:<id>). Une lecon
//   cachee ensuite depuis l'arbre du cockpit n'est pas republiee, et un billet dont
//   la lecon n'est plus publiee ne s'affiche plus en pop-up.
// - Un seul billet du jour a la fois : le plus recent dans sa fenetre.
//
// CE FICHIER N'IMPORTE RIEN, expres (comme arbre.ts) : scripts/verifier-billets.mjs et
// scripts/essayer-migration-billets.mjs l'importent tel quel sous Node 22. La fenetre
// (48 h) vient de pur.ts : les fonctions qui en ont besoin la recoivent en parametre.

// ---------------------------------------------------------------------------
// Les mots
// ---------------------------------------------------------------------------

/** Le module et la section ou vivent les billets (section creee a l'import de Skool, 115 lecons au 27/10). */
export const MODULE_BILLETS = 'chroniques-de-l-accelerateur'
export const SECTION_BILLETS = 'billets'
/** La bibliotheque Bunny des videos de billets (celle des 8 billets video importes de Skool). */
export const BIBLIOTHEQUE_BILLETS = 'formation'
export const SITE_ACADEMIE = 'https://aoknowledge.com/academie'
export const CANAL_ANNONCE = 'popup-academie'
export const CIBLE_ANNONCE = 'membres connectés'

export const LIMITES_BILLET = { titre: 200, contenu: 50_000 } as const
const SLUG_MAX = 120
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/

export type VideoBillet =
  | { hebergeur: 'bunny'; id: string }
  | { hebergeur: 'youtube'; id: string }

/** L'etat d'un billet pour la liste du cockpit. */
export type EtatBillet = 'programme' | 'fenetre' | 'archive' | 'cache' | 'retire'

// ---------------------------------------------------------------------------
// Pur : lire la saisie
// ---------------------------------------------------------------------------

/**
 * La video d'un billet a partir de ce que Brice colle : un guid Bunny (36
 * caracteres) ou un lien YouTube (youtu.be, watch?v=, shorts, embed, live) ou
 * l'identifiant YouTube seul. Vide = pas de video. 'invalide' sinon.
 */
export function lireVideo(brut: unknown): VideoBillet | null | 'invalide' {
  if (brut === null || brut === undefined) return null
  if (typeof brut !== 'string') return 'invalide'
  const v = brut.trim()
  if (!v) return null
  if (UUID_RE.test(v.toLowerCase())) return { hebergeur: 'bunny', id: v.toLowerCase() }
  if (YOUTUBE_ID_RE.test(v) && !v.includes('.')) return { hebergeur: 'youtube', id: v }
  let u: URL
  try { u = new URL(v) } catch { return 'invalide' }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'invalide'
  const hote = u.hostname.toLowerCase().replace(/^www\.|^m\./, '')
  let id: string | null = null
  if (hote === 'youtu.be') id = u.pathname.split('/')[1] ?? null
  else if (hote === 'youtube.com' || hote === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v')
    else {
      const m = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname)
      id = m ? m[1] : null
    }
  }
  // Un lien Bunny (iframe.mediadelivery.net/embed/<bibliotheque>/<guid>, ou play/...) : on garde le guid.
  else if (hote.endsWith('mediadelivery.net')) {
    const guid = u.pathname.split('/').find(p => UUID_RE.test(p.toLowerCase()))
    if (guid) return { hebergeur: 'bunny', id: guid.toLowerCase() }
  }
  return id && YOUTUBE_ID_RE.test(id) ? { hebergeur: 'youtube', id } : 'invalide'
}

export type SaisieBillet = {
  /** Absent = nouveau billet. */
  id: string | null
  titre: string
  contenu: string
  /** null = maintenant (a l'enregistrement). */
  publieLe: Date | null
  video: VideoBillet | null
}

/**
 * Le corps de POST /api/cockpit/academie/billets { action: 'enregistrer', id?,
 * titre, contenu, publie_le? (ISO, absent ou vide = maintenant), video? }.
 * Rend la saisie propre, ou { erreur } en clair pour l'ecran.
 */
export function lireSaisieBillet(corps: unknown): SaisieBillet | { erreur: string } {
  const c = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>
  let id: string | null = null
  if (c.id !== undefined && c.id !== null && c.id !== '') {
    const v = typeof c.id === 'string' ? c.id.trim().toLowerCase() : ''
    if (!UUID_RE.test(v)) return { erreur: 'Billet inconnu.' }
    id = v
  }
  const titre = typeof c.titre === 'string' ? c.titre.replace(/\s+/g, ' ').trim() : ''
  if (!titre) return { erreur: 'Le titre est obligatoire.' }
  if (titre.length > LIMITES_BILLET.titre) return { erreur: `Titre trop long (${LIMITES_BILLET.titre} caractères au plus).` }
  const contenu = typeof c.contenu === 'string' ? c.contenu.replace(/\r\n?/g, '\n').trim() : ''
  if (!contenu) return { erreur: 'Le texte est obligatoire.' }
  if (contenu.length > LIMITES_BILLET.contenu) return { erreur: `Texte trop long (${LIMITES_BILLET.contenu} caractères au plus).` }
  let publieLe: Date | null = null
  if (c.publie_le !== undefined && c.publie_le !== null && c.publie_le !== '') {
    const d = typeof c.publie_le === 'string' ? new Date(c.publie_le) : null
    if (!d || !Number.isFinite(d.getTime())) return { erreur: 'Date de publication illisible.' }
    publieLe = d
  }
  const video = lireVideo(c.video)
  if (video === 'invalide') return { erreur: 'Vidéo : colle un guid Bunny (36 caractères) ou un lien YouTube.' }
  return { id, titre, contenu, publieLe, video }
}

/** Un slug de lecon a partir du titre et du jour de publication (comme les billets importes : « titre-26-06-2026 »). */
export function slugBillet(titre: string, publieLe: Date): string {
  const jour = publieLe.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' })
    .replace(/\//g, '-')
  const base = titre.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const suffixe = `-${jour}`
  const tete = (base || 'billet').slice(0, SLUG_MAX - suffixe.length).replace(/-+$/, '')
  return `${tete}${suffixe}`
}

/** Un slug libre : le meme, sinon slug-2, slug-3... (borne a 120 caracteres). */
export function slugLibreBillet(slug: string, pris: ReadonlySet<string>): string {
  if (!pris.has(slug)) return slug
  for (let n = 2; ; n++) {
    const suffixe = `-${n}`
    const essai = `${slug.slice(0, SLUG_MAX - suffixe.length).replace(/-+$/, '')}${suffixe}`
    if (!pris.has(essai)) return essai
  }
}

/** Les colonnes de la lecon qui portent le billet (type, hebergeur, video, pieces jointes). */
export function colonnesLecon(video: VideoBillet | null): {
  type: 'video' | 'texte'; hebergeur: 'bunny' | null; bibliotheque: string | null; bunnyVideoId: string | null
  ressources: { titre: string; url: string }[]
} {
  if (video?.hebergeur === 'bunny') {
    return { type: 'video', hebergeur: 'bunny', bibliotheque: BIBLIOTHEQUE_BILLETS, bunnyVideoId: video.id, ressources: [] }
  }
  // Une video YouTube ne se joue pas dans le lecteur de l'academie (Bunny ou Wistia) : la lecon est
  // un texte, et le lien de la video est sa piece jointe (le pop-up et le bandeau, eux, l'integrent).
  const ressources = video?.hebergeur === 'youtube'
    ? [{ titre: 'La vidéo sur YouTube', url: `https://www.youtube.com/watch?v=${video.id}` }]
    : []
  return { type: 'texte', hebergeur: null, bibliotheque: null, bunnyVideoId: null, ressources }
}

/** L'etat d'un billet a maintenantMs (fenetreMs = 48 h, de pur.ts). */
export function etatBillet(
  b: { publie_le: Date | string; retire_le: Date | string | null; lecon_statut: string },
  maintenantMs: number,
  fenetreMs: number,
): EtatBillet {
  if (b.retire_le) return 'retire'
  const t = new Date(b.publie_le).getTime()
  if (t > maintenantMs) return 'programme'
  if (b.lecon_statut !== 'publie') return 'cache'
  return maintenantMs < t + fenetreMs ? 'fenetre' : 'archive'
}

/** Le chemin de la lecon sur le site. */
export const lienLeconBillet = (moduleSlug: string, leconSlug: string) => `${SITE_ACADEMIE}/${moduleSlug}/${leconSlug}`

// ---------------------------------------------------------------------------
// La base
// ---------------------------------------------------------------------------

export type ClientSql = {
  $queryRawUnsafe<T = unknown>(sql: string, ...valeurs: unknown[]): Promise<T>
  $executeRawUnsafe(sql: string, ...valeurs: unknown[]): Promise<number>
}

/** Le meme verrou que l'arbre du cockpit et l'importeur : un geste a la fois sur le catalogue. */
const SQL_VERROU = `select id from public.academie_modules order by id for update`

const SQL_SECTION_BILLETS = `
select m.id::text as module_id, m.slug as module_slug, s.id::text as section_id
  from public.academie_modules m
  join public.academie_sections s on s.module_id = m.id
 where m.slug = $1 and lower(btrim(s.titre)) = $2
 order by s.ordre
 limit 1
`

const SQL_SLUGS_DU_MODULE = `select slug from public.academie_lecons where module_id = $1::uuid`
const SQL_ORDRE_SUIVANT = `select coalesce(max(ordre), 0) + 1 as ordre from public.academie_lecons where module_id = $1::uuid`

const SQL_CREER_LECON = `
insert into public.academie_lecons
  (module_id, section_id, slug, ordre, titre, type, format, usage, hebergeur, bunny_bibliotheque, bunny_video_id,
   contenu, ressources, statut, edite_le, edite_par, statut_le)
values ($1::uuid, $2::uuid, $3, $4, $5, $6, 'cours', 'interne', $7, $8, $9, $10, $11::jsonb, 'brouillon', now(), $12::uuid, now())
returning id::text as id
`

const SQL_CREER_BILLET = `
insert into public.academie_billets (lecon_id, publie_le, youtube_id, cree_par, maj_par)
values ($1::uuid, $2::timestamptz, $3, $4::uuid, $4::uuid)
returning id::text as id
`

const SQL_LIRE_BILLET_POUR_EDITION = `
select b.id::text as id, b.lecon_id::text as lecon_id, b.publie_le, b.publication_faite_le, b.retire_le,
       l.titre, l.contenu, l.type, l.hebergeur, l.bunny_video_id, l.ressources
  from public.academie_billets b
  join public.academie_lecons l on l.id = b.lecon_id
 where b.id = $1::uuid
 for update of b
`

// Le titre et le texte changent : on garde l'historique comme l'edition dans l'app (academie_editions,
// champs titre et contenu ; la video et la date se lisent dans academie_billets / la lecon).
const SQL_MAJ_LECON = `
update public.academie_lecons
   set titre = $2, contenu = $3, type = $4, hebergeur = $5, bunny_bibliotheque = $6, bunny_video_id = $7,
       ressources = $8::jsonb, edite_le = now(), edite_par = $9::uuid, maj_le = now()
 where id = $1::uuid
`

const SQL_HISTORIQUE = `
insert into public.academie_editions (cible, cible_id, champ, avant, apres, par, origine)
select 'lecon', $1::uuid, h.champ, h.avant, h.apres, $2::uuid, 'app'
  from jsonb_to_recordset($3::jsonb) as h(champ text, avant text, apres text)
`

const SQL_MAJ_BILLET = `
update public.academie_billets
   set publie_le = $2::timestamptz, youtube_id = $3, maj_par = $4::uuid, maj_le = now()
 where id = $1::uuid
`

// Le pop-up deja inscrit suit le titre et le texte (pas la date : c'est l'historique).
const SQL_MAJ_ANNONCE = `
update public.cockpit_annonces_envoyees
   set titre = left($2, 200), contenu = left($3, 20000)
 where source = 'billet:' || $1
`

/**
 * Les billets dont l'heure est passee et qui ne sont pas encore publies : la
 * lecon passe 'publie' (si elle est encore en brouillon), le pop-up s'inscrit
 * dans cockpit_annonces_envoyees, une seule fois. skip locked : deux lectures
 * simultanees ne publient pas deux fois. Rend les billets publies.
 */
const SQL_PUBLIER_ECHUS = `
with dus as (
  select b.id, b.lecon_id, b.publie_le, b.cree_par
    from public.academie_billets b
   where b.publication_faite_le is null and b.retire_le is null and b.publie_le <= now()
   for update skip locked
), lecons as (
  update public.academie_lecons l
     set statut = 'publie', statut_le = now(), maj_le = now()
    from dus
   where l.id = dus.lecon_id and l.statut = 'brouillon'
  returning l.id
), marques as (
  update public.academie_billets b
     set publication_faite_le = now()
    from dus
   where b.id = dus.id
  returning b.id
), annonces as (
  insert into public.cockpit_annonces_envoyees (canal, titre, contenu, envoye_le, cible, lien, source, pose_par)
  select $1, left(l.titre, 200), left(coalesce(l.contenu, ''), 20000), dus.publie_le, $2,
         $3 || '/' || m.slug || '/' || l.slug, 'billet:' || dus.id::text, dus.cree_par
    from dus
    join public.academie_lecons l on l.id = dus.lecon_id
    join public.academie_modules m on m.id = l.module_id
  on conflict (source) do nothing
  returning id
)
select dus.id::text as id, (select count(*) from lecons)::int as lecons, (select count(*) from annonces)::int as annonces
  from dus
`

/**
 * Le billet du jour : le plus recent publie dans sa fenetre ($2 heures), lecon et
 * module publies. vu = le compte $1 a deja ferme son pop-up.
 */
const SQL_BILLET_DU_JOUR = `
select b.id::text as id, b.publie_le, b.youtube_id,
       l.id::text as lecon_id, l.slug as lecon_slug, l.titre, l.contenu, l.type, l.hebergeur,
       l.bunny_bibliotheque, l.bunny_video_id,
       m.slug as module_slug, m.titre as module_titre,
       exists (select 1 from public.academie_billets_vus v where v.billet_id = b.id and v.user_id = $1::uuid) as vu
  from public.academie_billets b
  join public.academie_lecons l on l.id = b.lecon_id
  join public.academie_modules m on m.id = l.module_id
 where b.retire_le is null
   and b.publie_le <= now() and b.publie_le > now() - make_interval(hours => $2::int)
   and l.statut = 'publie' and m.statut = 'publie'
 order by b.publie_le desc
 limit 1
`

const SQL_NOTER_VU = `
insert into public.academie_billets_vus (billet_id, user_id)
select b.id, $2::uuid from public.academie_billets b where b.id = $1::uuid
on conflict (billet_id, user_id) do nothing
`

const SQL_LISTE = `
select b.id::text as id, b.publie_le, b.publication_faite_le, b.youtube_id, b.retire_le, b.cree_le, b.maj_le,
       l.id::text as lecon_id, l.slug as lecon_slug, l.titre, l.contenu, l.type, l.statut as lecon_statut,
       l.bunny_video_id, m.slug as module_slug,
       (select count(*) from public.academie_billets_vus v where v.billet_id = b.id)::int as vus
  from public.academie_billets b
  join public.academie_lecons l on l.id = b.lecon_id
  join public.academie_modules m on m.id = l.module_id
 order by b.publie_le desc
 limit 200
`

const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : typeof d === 'string' ? d : null)

/** Publie les billets echus (voir SQL_PUBLIER_ECHUS). Rend le nombre de billets publies. */
export async function publierBilletsEchus(c: ClientSql): Promise<number> {
  const lignes = await c.$queryRawUnsafe<{ id: string }[]>(SQL_PUBLIER_ECHUS, CANAL_ANNONCE, CIBLE_ANNONCE, SITE_ACADEMIE)
  return lignes.length
}

export type IssueEnregistrer =
  | { issue: 'ok'; id: string; leconId: string; cree: boolean }
  | { issue: 'section' }
  | { issue: 'introuvable' }
  | { issue: 'retire' }
  | { issue: 'date_figee' }

/**
 * Cree ou modifie un billet DANS la transaction tx (la route l'ouvre ; les
 * scripts d'essai passent la leur, toujours annulee). par = le compte du
 * cockpit. Verrouille le catalogue comme l'arbre. La date d'un billet deja
 * publie ne bouge plus (sa fenetre et son pop-up sont partis) ; avant, elle
 * se change librement. Ne publie pas : la route appelle publierBilletsEchus
 * juste apres (un billet « maintenant » part donc tout de suite).
 */
export async function enregistrerBillet(tx: ClientSql, par: string, s: SaisieBillet, maintenant: Date): Promise<IssueEnregistrer> {
  await tx.$queryRawUnsafe(SQL_VERROU)
  const col = colonnesLecon(s.video)
  const youtube = s.video?.hebergeur === 'youtube' ? s.video.id : null

  if (!s.id) {
    const [sec] = await tx.$queryRawUnsafe<{ module_id: string; module_slug: string; section_id: string }[]>(
      SQL_SECTION_BILLETS, MODULE_BILLETS, SECTION_BILLETS)
    if (!sec) return { issue: 'section' }
    const publieLe = s.publieLe ?? maintenant
    const pris = new Set((await tx.$queryRawUnsafe<{ slug: string }[]>(SQL_SLUGS_DU_MODULE, sec.module_id)).map(r => r.slug))
    const slug = slugLibreBillet(slugBillet(s.titre, publieLe), pris)
    const [{ ordre }] = await tx.$queryRawUnsafe<{ ordre: number }[]>(SQL_ORDRE_SUIVANT, sec.module_id)
    const [lecon] = await tx.$queryRawUnsafe<{ id: string }[]>(SQL_CREER_LECON,
      sec.module_id, sec.section_id, slug, ordre, s.titre, col.type, col.hebergeur, col.bibliotheque, col.bunnyVideoId,
      s.contenu, JSON.stringify(col.ressources), par)
    // La creation se lit dans academie_billets (cree_par, cree_le) : academie_editions n'a pas de champ « creation » pour une lecon.
    const [billet] = await tx.$queryRawUnsafe<{ id: string }[]>(SQL_CREER_BILLET, lecon.id, publieLe.toISOString(), youtube, par)
    return { issue: 'ok', id: billet.id, leconId: lecon.id, cree: true }
  }

  const [b] = await tx.$queryRawUnsafe<{
    id: string; lecon_id: string; publie_le: Date; publication_faite_le: Date | null; retire_le: Date | null
    titre: string; contenu: string | null; type: string; bunny_video_id: string | null
  }[]>(SQL_LIRE_BILLET_POUR_EDITION, s.id)
  if (!b) return { issue: 'introuvable' }
  if (b.retire_le) return { issue: 'retire' }
  let publieLe = new Date(b.publie_le)
  if (s.publieLe && s.publieLe.getTime() !== publieLe.getTime()) {
    if (b.publication_faite_le) return { issue: 'date_figee' }
    publieLe = s.publieLe
  } else if (!s.publieLe && !b.publication_faite_le) {
    // « Maintenant » sur un billet encore programme : il part tout de suite.
    publieLe = maintenant
  }
  await tx.$executeRawUnsafe(SQL_MAJ_LECON, b.lecon_id, s.titre, s.contenu, col.type, col.hebergeur, col.bibliotheque,
    col.bunnyVideoId, JSON.stringify(col.ressources), par)
  const historique = [
    { champ: 'titre', avant: b.titre, apres: s.titre },
    { champ: 'contenu', avant: b.contenu, apres: s.contenu },
  ].filter(h => (h.avant ?? null) !== (h.apres ?? null))
  if (historique.length) await tx.$executeRawUnsafe(SQL_HISTORIQUE, b.lecon_id, par, JSON.stringify(historique))
  await tx.$executeRawUnsafe(SQL_MAJ_BILLET, b.id, publieLe.toISOString(), youtube, par)
  if (b.publication_faite_le) await tx.$executeRawUnsafe(SQL_MAJ_ANNONCE, b.id, s.titre, s.contenu)
  return { issue: 'ok', id: b.id, leconId: b.lecon_id, cree: false }
}

export type BilletListe = {
  id: string; lecon_id: string; lecon_slug: string; module_slug: string
  titre: string; contenu: string; type: string; lecon_statut: string
  publie_le: string; publication_faite_le: string | null; retire_le: string | null; cree_le: string; maj_le: string
  video: string | null
  etat: EtatBillet
  fin_fenetre: string
  vus: number
  lien: string
}

/** La liste du cockpit (200 derniers), avec l'etat de chacun a maintenantMs. */
export async function listerBillets(c: ClientSql, maintenantMs: number, fenetreMs: number): Promise<BilletListe[]> {
  const lignes = await c.$queryRawUnsafe<{
    id: string; publie_le: Date; publication_faite_le: Date | null; youtube_id: string | null; retire_le: Date | null
    cree_le: Date; maj_le: Date; lecon_id: string; lecon_slug: string; titre: string; contenu: string | null; type: string
    lecon_statut: string; bunny_video_id: string | null; module_slug: string; vus: number
  }[]>(SQL_LISTE)
  return lignes.map(l => ({
    id: l.id,
    lecon_id: l.lecon_id,
    lecon_slug: l.lecon_slug,
    module_slug: l.module_slug,
    titre: l.titre,
    contenu: l.contenu ?? '',
    type: l.type,
    lecon_statut: l.lecon_statut,
    publie_le: iso(l.publie_le) ?? '',
    publication_faite_le: iso(l.publication_faite_le),
    retire_le: iso(l.retire_le),
    cree_le: iso(l.cree_le) ?? '',
    maj_le: iso(l.maj_le) ?? '',
    video: l.bunny_video_id ?? (l.youtube_id ? `https://youtu.be/${l.youtube_id}` : null),
    etat: etatBillet({ publie_le: l.publie_le, retire_le: l.retire_le, lecon_statut: l.lecon_statut }, maintenantMs, fenetreMs),
    fin_fenetre: new Date(new Date(l.publie_le).getTime() + fenetreMs).toISOString(),
    vus: l.vus,
    lien: lienLeconBillet(l.module_slug, l.lecon_slug),
  }))
}

export type LigneBilletDuJour = {
  id: string; publie_le: Date; youtube_id: string | null
  lecon_id: string; lecon_slug: string; titre: string; contenu: string | null; type: string; hebergeur: string | null
  bunny_bibliotheque: string | null; bunny_video_id: string | null
  module_slug: string; module_titre: string; vu: boolean
}

/** Le billet du jour pour le compte userId (fenetre en heures, de pur.ts), ou null. */
export async function lireBilletDuJour(c: ClientSql, userId: string, fenetreH: number): Promise<LigneBilletDuJour | null> {
  const [l] = await c.$queryRawUnsafe<LigneBilletDuJour[]>(SQL_BILLET_DU_JOUR, userId, fenetreH)
  return l ?? null
}

/** Le compte a ferme le pop-up : il ne revient plus. Rend false si le billet n'existe pas. */
export async function noterBilletVu(c: ClientSql, billetId: string, userId: string): Promise<boolean> {
  const n = await c.$executeRawUnsafe(SQL_NOTER_VU, billetId, userId)
  if (n > 0) return true
  const [e] = await c.$queryRawUnsafe<{ ok: number }[]>(`select 1 as ok from public.academie_billets where id = $1::uuid`, billetId)
  return Boolean(e)
}
