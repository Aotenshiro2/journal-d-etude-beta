// LE CONNECTEUR MCP DE CHATGPT POUR BELRIVE (23/10/2026) : les requetes SQL.
//
// En texte, parametres positionnels ($1, $2...) passes a $queryRawUnsafe
// (lies par le pilote, jamais colles dans le texte). Aucun import a
// l'execution : scripts/essayer-migration-gpt-belrive.mjs joue EXACTEMENT ces
// requetes contre la vraie base, dans une transaction toujours annulee.
//
// PERIMETRE (controle par scripts/verifier-mcp-gpt.mjs) : cinq tables, pas
// une de plus (cockpit_perso_images depuis le 25/10/2026 : les images de
// ChatGPT, projet 'belrive' en dur, insertion seulement).
// - cockpit_perso_documents et cockpit_perso_notes, TOUJOURS avec
//   projet = 'belrive' ecrit en dur dans le texte. Les notes ecrites portent
//   auteur 'gpt' et projet 'belrive' en dur, les documents deposes source
//   'gpt' et projet 'belrive' en dur.
// - cockpit_tab_cles (les cles de portee gpt_belrive) et cockpit_tab_acces
//   (le compteur du debit, lu ici, ecrit par src/lib/tab/acces.ts).
//
// Tables : migrations 20261023170000_cockpit_perso_documents.sql et
// 20261023171000_cockpit_tab_cles_portee.sql.

import type {
  DepotGpt, Document, DocumentResume, FiltreStatut, ImageAEnregistrer, ImageBelrive, NoteBelrive, NoteGpt, Recherche, StatutNote, Trouvaille,
} from './pur'

/** Ce qu'il faut d'un client Prisma (ou d'une transaction) pour ces requetes. */
export type Executeur = {
  $queryRawUnsafe<T = unknown>(requete: string, ...valeurs: unknown[]): Promise<T>
}

// La forme SANS ACCENTS de la recherche. La MEME expression calcule la colonne
// tsv dans la migration 20261023170000 (verifie par verifier-mcp-gpt.mjs) :
// minuscules, œ -> oe, æ -> ae, puis une lettre accentuee -> sa lettre nue.
export const ACCENTS_SQL = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ'
export const SANS_ACCENTS_SQL = 'aaaaaaceeeeiiiinooooouuuuyy'

export function normaliserSql(expression: string): string {
  return `translate(replace(replace(lower(${expression}), 'œ', 'oe'), 'æ', 'ae'), '${ACCENTS_SQL}', '${SANS_ACCENTS_SQL}')`
}

// ---------------------------------------------------------------------------
// La cle
// ---------------------------------------------------------------------------

/** Les cles actives de ChatGPT et leurs appels de la derniere minute (le debit). */
export const SQL_CLES_GPT = `
select c.cle_id::text as cle_id, c.empreinte,
  (select count(*)::int from public.cockpit_tab_acces a
    where a.cle_id = c.cle_id and a.appele_le > now() - interval '1 minute') as appels
from public.cockpit_tab_cles c
where c.portee = 'gpt_belrive' and c.coupee_le is null`

export type LigneCle = { cle_id: string; empreinte: string; appels: number }

export async function clesActives(db: Executeur): Promise<LigneCle[]> {
  return db.$queryRawUnsafe<LigneCle[]>(SQL_CLES_GPT)
}

// ---------------------------------------------------------------------------
// Les documents
// ---------------------------------------------------------------------------

const COLONNES_DOC = `d.document_id::text as document_id, d.titre, d.chemin, d.taille, d.source, d.version, d.maj_le`

/**
 * $1 = la requete sans accents, $2 = motif LIKE (echappe), $3 = mots (text[]),
 * $4 = limite. Score : plein texte francais, plus 1 quand le titre ou le
 * chemin contient la requete entiere. L'extrait part de la premiere
 * occurrence d'un des mots.
 */
export const SQL_CHERCHER_DOCUMENTS = `
select ${COLONNES_DOC}, s.score::float8 as score,
  substring(d.contenu from greatest(1, coalesce((
    select min(nullif(strpos(n.nc, w), 0)) from unnest($3::text[]) as w), 1) - 160) for 480) as extrait
from (
  select d0.document_id,
    ts_rank_cd(d0.tsv, q.tq)
      + case when ${normaliserSql(`d0.titre || ' ' || d0.chemin`)} like $2::text escape '\\' then 1 else 0 end as score
  from public.cockpit_perso_documents d0, (select websearch_to_tsquery('french', $1::text) as tq) q
  where d0.projet = 'belrive' and d0.retire_le is null
    and (d0.tsv @@ q.tq or ${normaliserSql(`d0.titre || ' ' || d0.chemin`)} like $2::text escape '\\')
  order by score desc, d0.maj_le desc
  limit $4::int
) s
join public.cockpit_perso_documents d on d.document_id = s.document_id and d.projet = 'belrive'
cross join lateral (select ${normaliserSql('d.contenu')} as nc) n
order by s.score desc, d.maj_le desc`

/** $1 = limite. Requete vide : les documents les plus recents. */
export const SQL_RECENTS_DOCUMENTS = `
select ${COLONNES_DOC}, 0::float8 as score, left(d.contenu, 480) as extrait
from public.cockpit_perso_documents d
where d.projet = 'belrive' and d.retire_le is null
order by d.maj_le desc
limit $1::int`

/** $1 = uuid. */
export const SQL_LIRE_DOCUMENT = `
select ${COLONNES_DOC}, d.contenu
from public.cockpit_perso_documents d
where d.document_id = $1::uuid and d.projet = 'belrive' and d.retire_le is null`

/** $1 = chemin relatif au dossier Belrive (ETAT.md, Lots/FILE-DES-LOTS.md...). */
export const SQL_LIRE_DOCUMENT_CHEMIN = `
select ${COLONNES_DOC}, d.contenu
from public.cockpit_perso_documents d
where d.chemin = $1::text and d.projet = 'belrive' and d.retire_le is null`

export const SQL_LISTER_DOCUMENTS = `
select ${COLONNES_DOC}
from public.cockpit_perso_documents d
where d.projet = 'belrive' and d.retire_le is null
order by d.source, d.chemin`

/**
 * Le depot de ChatGPT : $1 = famille (le titre en slug), $2 = titre,
 * $3 = contenu, $4 = empreinte. Version = la derniere de la famille + 1,
 * chemin Scenario/De-GPT/<famille>-v<version>.md. Un depot concurrent de la
 * meme famille percute l'unicite (projet, chemin) : rien n'est ecrit, on
 * recommence une fois.
 */
export const SQL_DEPOSER_DOCUMENT = `
insert into public.cockpit_perso_documents (projet, chemin, titre, contenu, empreinte, source, famille, version)
select 'belrive', 'Scenario/De-GPT/' || $1::text || '-v' || s.v::text || '.md', $2::text, $3::text, $4::text, 'gpt', $1::text, s.v
from (select coalesce(max(x.version), 0) + 1 as v from public.cockpit_perso_documents x
       where x.projet = 'belrive' and x.source = 'gpt' and x.famille = $1::text) s
on conflict (projet, chemin) do nothing
returning document_id::text as document_id, titre, chemin, taille, source, version, maj_le`

// ---------------------------------------------------------------------------
// Les notes du projet belrive
// ---------------------------------------------------------------------------

const COLONNES_NOTE = `n.note_id::text as note_id, n.sens, n.auteur, n.instance, n.sujet, n.texte, n.liens, n.statut, n.cree_le`

/** Memes parametres que SQL_CHERCHER_DOCUMENTS. */
export const SQL_CHERCHER_NOTES = `
select n.note_id::text as id, n.sujet as titre, n.cree_le as date, s.score::float8 as score,
  substring(n.texte from greatest(1, coalesce((
    select min(nullif(strpos(t.nt, w), 0)) from unnest($3::text[]) as w), 1) - 160) for 480) as extrait
from (
  select n0.note_id,
    ts_rank_cd(to_tsvector('french', ${normaliserSql(`n0.sujet || ' ' || n0.texte`)}), q.tq)
      + case when ${normaliserSql('n0.sujet')} like $2::text escape '\\' then 1 else 0 end as score
  from public.cockpit_perso_notes n0, (select websearch_to_tsquery('french', $1::text) as tq) q
  where n0.projet = 'belrive'
    and (to_tsvector('french', ${normaliserSql(`n0.sujet || ' ' || n0.texte`)}) @@ q.tq
      or ${normaliserSql(`n0.sujet || ' ' || n0.texte`)} like $2::text escape '\\')
  order by score desc, n0.cree_le desc
  limit $4::int
) s
join public.cockpit_perso_notes n on n.note_id = s.note_id and n.projet = 'belrive'
cross join lateral (select ${normaliserSql('n.texte')} as nt) t
order by s.score desc, n.cree_le desc`

/** $1 = limite. */
export const SQL_RECENTES_NOTES = `
select n.note_id::text as id, n.sujet as titre, n.cree_le as date, 0::float8 as score, left(n.texte, 480) as extrait
from public.cockpit_perso_notes n
where n.projet = 'belrive'
order by n.cree_le desc
limit $1::int`

/** $1 = uuid. */
export const SQL_LIRE_NOTE = `
select ${COLONNES_NOTE}
from public.cockpit_perso_notes n
where n.note_id = $1::uuid and n.projet = 'belrive'`

/** $1 = statut ou 'toutes', $2 = limite. */
export const SQL_LISTER_NOTES = `
select ${COLONNES_NOTE}
from public.cockpit_perso_notes n
where n.projet = 'belrive' and ($1::text = 'toutes' or n.statut = $1::text)
order by n.cree_le desc
limit $2::int`

/**
 * La note de ChatGPT : $1 = sens (vers_claude ou vers_tab), $2 = sujet,
 * $3 = texte, $4 = liens, $5 = instance (sora, umi, sekai, toutes, ou null
 * pour Tab). Auteur gpt et projet belrive en dur. Memes colonnes rendues que
 * src/lib/tab/notes.ts (pour le ping).
 */
export const SQL_ECRIRE_NOTE = `
insert into public.cockpit_perso_notes (sens, auteur, sujet, texte, projet, liens, instance)
values ($1::text, 'gpt', $2::text, $3::text, 'belrive', $4::text[], $5::text)
returning note_id::text as note_id, sens, auteur, sujet, texte, projet, liens, statut,
  cree_le, lu_le, traite_le, ping_envoye_le, instance, lue_par`

// ---------------------------------------------------------------------------
// Les images de Belrive (25/10/2026, migration 20261025120000)
// ---------------------------------------------------------------------------

const COLONNES_IMAGE = `i.image_id::text as image_id, i.titre, i.role, i.nom_fichier, i.chemin, i.mime, i.taille, i.empreinte, i.origine, i.depose_le`

/** $1 = empreinte sha256 des octets. */
export const SQL_IMAGE_PAR_EMPREINTE = `
select ${COLONNES_IMAGE}
from public.cockpit_perso_images i
where i.empreinte = $1::text and i.projet = 'belrive'`

/** $1 = uuid. */
export const SQL_LIRE_IMAGE = `
select ${COLONNES_IMAGE}
from public.cockpit_perso_images i
where i.image_id = $1::uuid and i.projet = 'belrive'`

/** $1 = limite. Les plus recentes d'abord. */
export const SQL_LISTER_IMAGES = `
select ${COLONNES_IMAGE}
from public.cockpit_perso_images i
where i.projet = 'belrive'
order by i.depose_le desc
limit $1::int`

/**
 * Le depot : $1 = titre, $2 = role, $3 = nom de fichier, $4 = chemin dans le
 * bucket, $5 = type, $6 = taille, $7 = empreinte, $8 = origine. Projet
 * belrive et auteur gpt en dur. Meme empreinte deja la : rien n'est ecrit
 * (on relit la ligne existante).
 */
export const SQL_INSERER_IMAGE = `
insert into public.cockpit_perso_images (projet, titre, role, nom_fichier, chemin, mime, taille, empreinte, origine, depose_par)
values ('belrive', $1::text, $2::text, $3::text, $4::text, $5::text, $6::int, $7::text, $8::text, 'gpt')
on conflict (projet, empreinte) do nothing
returning image_id::text as image_id, titre, role, nom_fichier, chemin, mime, taille, empreinte, origine, depose_le`

// ---------------------------------------------------------------------------
// Les fonctions (une requete chacune, ou deux pour chercher)
// ---------------------------------------------------------------------------

type Quand = Date | string
type LigneDoc = Omit<DocumentResume, 'maj_le'> & { maj_le: Quand }
type LigneDocContenu = LigneDoc & { contenu: string }
type LigneNote = Omit<NoteBelrive, 'cree_le'> & { cree_le: Quand }
type LigneTrouvee = { document_id?: string; id?: string; titre: string; chemin?: string; date?: Quand; maj_le?: Quand; score: number; extrait: string | null }
export type LigneNoteEcrite = LigneNote & {
  projet: string
  lu_le: Quand | null
  traite_le: Quand | null
  ping_envoye_le: Quand | null
  lue_par: string[]
}

export function iso(d: Quand | null | undefined): string {
  if (!d) return ''
  return d instanceof Date ? d.toISOString() : String(d)
}

export function versDocumentResume(l: LigneDoc): DocumentResume {
  return { document_id: l.document_id, titre: l.titre, chemin: l.chemin, taille: Number(l.taille), source: l.source, version: Number(l.version), maj_le: iso(l.maj_le) }
}

export function versNoteBelrive(l: LigneNote): NoteBelrive {
  return {
    note_id: l.note_id, sens: l.sens, auteur: l.auteur, instance: l.instance, sujet: l.sujet, texte: l.texte,
    liens: l.liens ?? [], statut: l.statut as StatutNote, cree_le: iso(l.cree_le),
  }
}

function propre(extrait: string | null): string {
  return (extrait ?? '').replace(/\s+/g, ' ').trim()
}

export async function chercher(db: Executeur, r: Recherche): Promise<Trouvaille[]> {
  let docs: LigneTrouvee[]
  let notes: LigneTrouvee[]
  if (r.normalisee) {
    docs = await db.$queryRawUnsafe<LigneTrouvee[]>(SQL_CHERCHER_DOCUMENTS, r.normalisee, r.motif, r.mots, r.limite)
    notes = await db.$queryRawUnsafe<LigneTrouvee[]>(SQL_CHERCHER_NOTES, r.normalisee, r.motif, r.mots, r.limite)
  } else {
    docs = await db.$queryRawUnsafe<LigneTrouvee[]>(SQL_RECENTS_DOCUMENTS, r.limite)
    notes = await db.$queryRawUnsafe<LigneTrouvee[]>(SQL_RECENTES_NOTES, r.limite)
  }
  const toutes: Trouvaille[] = [
    ...docs.map((d): Trouvaille => ({
      genre: 'doc', id: d.document_id ?? '', titre: d.titre, chemin: d.chemin ?? null,
      extrait: propre(d.extrait), date: iso(d.maj_le), score: Number(d.score) || 0,
    })),
    ...notes.map((n): Trouvaille => ({
      genre: 'note', id: n.id ?? '', titre: n.titre, chemin: null,
      extrait: propre(n.extrait), date: iso(n.date), score: Number(n.score) || 0,
    })),
  ]
  return toutes
    .sort((a, b) => (b.score - a.score) || b.date.localeCompare(a.date))
    .slice(0, r.limite)
}

export async function lireDocument(db: Executeur, id: string): Promise<Document | null> {
  const l = await db.$queryRawUnsafe<LigneDocContenu[]>(SQL_LIRE_DOCUMENT, id)
  return l[0] ? { ...versDocumentResume(l[0]), contenu: l[0].contenu } : null
}

export async function lireDocumentParChemin(db: Executeur, chemin: string): Promise<Document | null> {
  const l = await db.$queryRawUnsafe<LigneDocContenu[]>(SQL_LIRE_DOCUMENT_CHEMIN, chemin)
  return l[0] ? { ...versDocumentResume(l[0]), contenu: l[0].contenu } : null
}

export async function listerDocuments(db: Executeur): Promise<DocumentResume[]> {
  const l = await db.$queryRawUnsafe<LigneDoc[]>(SQL_LISTER_DOCUMENTS)
  return l.map(versDocumentResume)
}

export async function lireNote(db: Executeur, id: string): Promise<NoteBelrive | null> {
  const l = await db.$queryRawUnsafe<LigneNote[]>(SQL_LIRE_NOTE, id)
  return l[0] ? versNoteBelrive(l[0]) : null
}

export async function listerNotes(db: Executeur, statut: FiltreStatut, limite: number): Promise<NoteBelrive[]> {
  const l = await db.$queryRawUnsafe<LigneNote[]>(SQL_LISTER_NOTES, statut, limite)
  return l.map(versNoteBelrive)
}

export async function ecrireNote(db: Executeur, n: NoteGpt): Promise<LigneNoteEcrite> {
  const l = await db.$queryRawUnsafe<LigneNoteEcrite[]>(
    SQL_ECRIRE_NOTE, n.destinataire.sens, n.sujet, n.texte, n.liens, n.destinataire.instance)
  return l[0]
}

type LigneImage = Omit<ImageBelrive, 'depose_le'> & { depose_le: Quand }

export function versImage(l: LigneImage): ImageBelrive {
  return { ...l, taille: Number(l.taille), depose_le: iso(l.depose_le) }
}

export async function imageParEmpreinte(db: Executeur, empreinte: string): Promise<ImageBelrive | null> {
  const l = await db.$queryRawUnsafe<LigneImage[]>(SQL_IMAGE_PAR_EMPREINTE, empreinte)
  return l[0] ? versImage(l[0]) : null
}

export async function lireImage(db: Executeur, id: string): Promise<ImageBelrive | null> {
  const l = await db.$queryRawUnsafe<LigneImage[]>(SQL_LIRE_IMAGE, id)
  return l[0] ? versImage(l[0]) : null
}

export async function listerImages(db: Executeur, limite: number): Promise<ImageBelrive[]> {
  const l = await db.$queryRawUnsafe<LigneImage[]>(SQL_LISTER_IMAGES, limite)
  return l.map(versImage)
}

/** null = la meme empreinte est deja en base (depot concurrent) : relire par imageParEmpreinte. */
export async function insererImage(db: Executeur, i: ImageAEnregistrer): Promise<ImageBelrive | null> {
  const l = await db.$queryRawUnsafe<LigneImage[]>(
    SQL_INSERER_IMAGE, i.titre, i.role, i.nomFichier, i.chemin, i.mime, i.octets.length, i.empreinte, i.origine)
  return l[0] ? versImage(l[0]) : null
}

export async function deposerDocument(db: Executeur, d: DepotGpt): Promise<DocumentResume | null> {
  for (let essai = 0; essai < 2; essai += 1) {
    const l = await db.$queryRawUnsafe<LigneDoc[]>(SQL_DEPOSER_DOCUMENT, d.famille, d.titre, d.contenu, d.empreinte)
    if (l[0]) return versDocumentResume(l[0])
  }
  return null
}
