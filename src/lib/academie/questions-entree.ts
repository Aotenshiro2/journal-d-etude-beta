// Les QUESTIONS D'ENTREE de l'academie (30/10/2026, GO de Brice du 30/10 ;
// migration 20261031170000_academie_questions_entree.sql).
//
// Skool posait des questions a chaque demande d'acces ; leurs reponses
// nourrissaient le releve hebdo des pain points (extract_skool_painpoints.py).
// L'academie du site les pose de nouveau : a la premiere entree d'un membre
// CONNECTE (aucun visiteur, aucun compte admin), une fenetre avec deux zones de
// texte facultatives, « Envoyer » et « Passer ». Montree une seule fois.
//
// - /api/academie/moi rend `questions_entree` : { poser, version, questions }.
//   Le site ne pose rien si poser est faux (deja repondu ou passe, compte
//   admin, table absente) ; l'essai de Brice (?questions=essai) affiche quand
//   meme, avec le texte de la version actuelle.
// - POST /api/academie/questions : reponses ou « passe », UNE seule fois
//   (insert ... on conflict do nothing : une deuxieme ecriture ne remplace pas
//   la premiere). essai = verifie, n'ecrit rien.
// - POST /api/cockpit/academie/questions : les reponses d'un membre (fiche du
//   cockpit) ou la liste. Le releve hebdo lit la table avec la cle service_role.
//
// Le texte exact de chaque question est ecrit a cote de sa reponse (question_1,
// question_2) avec la version : changer un libelle = AJOUTER une version
// ci-dessous, jamais modifier une version existante.
//
// Les reponses sont des donnees personnelles : aucune route ne les recopie
// dans ses journaux (compte tronque seulement).
//
// CE FICHIER N'IMPORTE RIEN, expres (comme billets.ts) :
// scripts/verifier-questions-entree.mjs et scripts/essayer-migration-questions-entree.mjs
// l'importent tel quel sous Node 22.

// ---------------------------------------------------------------------------
// Les questions
// ---------------------------------------------------------------------------

export type VersionQuestions = { version: number; questions: readonly [string, string] }

/** Toutes les versions, de la plus ancienne a l'actuelle (la derniere). Mot pour mot le GO de Brice du 30/10. */
export const VERSIONS_QUESTIONS: readonly VersionQuestions[] = [
  {
    version: 1,
    questions: [
      "Qu'est-ce qui t'empêche aujourd'hui de progresser en trading ?",
      "Qu'est-ce qui t'a fait douter un instant avant de t'inscrire au 10% Club ou au Live Club ?",
    ],
  },
]

export const QUESTIONS_ACTUELLES: VersionQuestions = VERSIONS_QUESTIONS[VERSIONS_QUESTIONS.length - 1]

export function questionsDeVersion(version: unknown): VersionQuestions | null {
  if (typeof version !== 'number' || !Number.isInteger(version)) return null
  return VERSIONS_QUESTIONS.find(v => v.version === version) ?? null
}

/** Longueur maximale d'une reponse, apres nettoyage (la migration la verifie aussi). */
export const LONGUEUR_MAX_REPONSE = 2000
/** Au-dela, le corps de la requete n'est meme pas lu. */
export const CORPS_MAX = 20_000

// ---------------------------------------------------------------------------
// Pur : nettoyer, lire
// ---------------------------------------------------------------------------

// Caracteres de controle et invisibles, construits par leur code pour qu'aucun
// ne figure en clair dans ce fichier (meme liste que liveclub/resume-pur.ts),
// SAUF le retour a la ligne (0x0a), garde : une reponse peut tenir sur
// plusieurs lignes. La tabulation devient une espace avant ce filtre.
const INVISIBLES = new RegExp(`[${[[0x00, 0x09], [0x0b, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
  .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`, 'g')

/**
 * Une reponse tapee par un membre : NFC, fins de ligne unifiees, sans caractere
 * de controle ni invisible (inversions de sens d'ecriture comprises), espaces
 * resserrees, trois lignes vides ou plus ramenees a une.
 * null = vide (ou absente) ; 'trop_long' au-dela de LONGUEUR_MAX_REPONSE ;
 * 'invalide' si ce n'est pas du texte.
 */
export function nettoyerReponse(brut: unknown): string | null | 'trop_long' | 'invalide' {
  if (brut === null || brut === undefined) return null
  if (typeof brut !== 'string') return 'invalide'
  const s = brut
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(INVISIBLES, '')
    .split('\n')
    .map(l => l.replace(/ {2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!s) return null
  return s.length > LONGUEUR_MAX_REPONSE ? 'trop_long' : s
}

export type SaisieQuestions = {
  version: number
  questions: readonly [string, string]
  passe: boolean
  reponses: [string | null, string | null]
  /** L'essai de Brice (?questions=essai) : tout est verifie, rien n'est ecrit. */
  essai: boolean
}

/** 'version' inconnue, 'reponse' pas du texte, 'longueur' trop longue, 'vide' ni reponse ni passe. */
export type ErreurSaisie = 'version' | 'reponse' | 'longueur' | 'vide'

/**
 * Le corps de POST /api/academie/questions :
 *   { version, reponse_1?, reponse_2?, passe?: true, essai?: true }
 * passe = true : les reponses eventuelles sont ignorees (le membre a passe).
 */
export function lireSaisieQuestions(corps: unknown): SaisieQuestions | { erreur: ErreurSaisie } {
  const c = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>
  const v = questionsDeVersion(c.version)
  if (!v) return { erreur: 'version' }
  const essai = c.essai === true
  if (c.passe === true) return { version: v.version, questions: v.questions, passe: true, reponses: [null, null], essai }
  const r1 = nettoyerReponse(c.reponse_1)
  const r2 = nettoyerReponse(c.reponse_2)
  if (r1 === 'invalide' || r2 === 'invalide') return { erreur: 'reponse' }
  if (r1 === 'trop_long' || r2 === 'trop_long') return { erreur: 'longueur' }
  if (r1 === null && r2 === null) return { erreur: 'vide' }
  return { version: v.version, questions: v.questions, passe: false, reponses: [r1, r2], essai }
}

/** Ce que le compte a deja fait : 'faites' (une ligne existe), 'a_poser', ou 'indisponible' (table absente, base illisible). */
export type EtatQuestions = 'faites' | 'a_poser' | 'indisponible'

export type VueQuestions = { poser: boolean; version: number; questions: readonly [string, string] }

/**
 * Le champ `questions_entree` de /api/academie/moi. Les questions actuelles
 * sont toujours rendues (l'essai de Brice s'en sert) ; poser seulement pour un
 * compte non admin qui n'a encore ni repondu ni passe.
 */
export function vueQuestions(etat: EtatQuestions, admin: boolean): VueQuestions {
  return { poser: etat === 'a_poser' && !admin, version: QUESTIONS_ACTUELLES.version, questions: QUESTIONS_ACTUELLES.questions }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const MAX_COMPTES_FICHE = 20
export const MAX_LISTE = 1000

export type DemandeCockpit =
  | { action: 'membre'; userIds: string[] }
  | { action: 'lister'; depuis: Date | null; limite: number }

/**
 * Le corps de POST /api/cockpit/academie/questions :
 *   { action: 'membre', user_ids: [uuid, ...] }  (1 a 20 comptes, ceux d'une personne)
 *   { action: 'lister', depuis?: ISO, limite?: 1..1000 }
 */
export function lireDemandeCockpit(corps: unknown): DemandeCockpit | { erreur: string } {
  const c = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>
  if (c.action === 'membre') {
    if (!Array.isArray(c.user_ids)) return { erreur: 'user_ids attendu (liste de uuid).' }
    const ids = [...new Set(c.user_ids.map(x => (typeof x === 'string' ? x.trim().toLowerCase() : '')))]
    if (!ids.length || ids.length > MAX_COMPTES_FICHE || ids.some(x => !UUID_RE.test(x))) {
      return { erreur: `user_ids : 1 a ${MAX_COMPTES_FICHE} uuid.` }
    }
    return { action: 'membre', userIds: ids }
  }
  if (c.action === 'lister') {
    let depuis: Date | null = null
    if (c.depuis !== undefined && c.depuis !== null && c.depuis !== '') {
      const d = typeof c.depuis === 'string' ? new Date(c.depuis) : null
      if (!d || !Number.isFinite(d.getTime())) return { erreur: 'depuis : date ISO attendue.' }
      depuis = d
    }
    let limite = MAX_LISTE
    if (c.limite !== undefined && c.limite !== null) {
      if (typeof c.limite !== 'number' || !Number.isInteger(c.limite) || c.limite < 1 || c.limite > MAX_LISTE) {
        return { erreur: `limite : 1 a ${MAX_LISTE}.` }
      }
      limite = c.limite
    }
    return { action: 'lister', depuis, limite }
  }
  return { erreur: 'Action inconnue.' }
}

// ---------------------------------------------------------------------------
// La base
// ---------------------------------------------------------------------------

export type ClientSql = {
  $queryRawUnsafe<T = unknown>(sql: string, ...valeurs: unknown[]): Promise<T>
  $executeRawUnsafe(sql: string, ...valeurs: unknown[]): Promise<number>
}

export const SQL_ETAT_QUESTIONS = `
select passe from public.academie_questions_entree where user_id = $1::uuid
`

/** Une seule fois : une ligne deja la n'est jamais remplacee (rien n'est rendu). */
export const SQL_ENREGISTRER_QUESTIONS = `
insert into public.academie_questions_entree (user_id, version, question_1, reponse_1, question_2, reponse_2, passe)
values ($1::uuid, $2::int, $3, $4, $5, $6, $7::boolean)
on conflict (user_id) do nothing
returning repondu_le
`

const COLONNES = `user_id::text as user_id, version, question_1, reponse_1, question_2, reponse_2, passe, repondu_le`

export const SQL_QUESTIONS_DES_COMPTES = `
select ${COLONNES}
  from public.academie_questions_entree
 where user_id = any($1::uuid[])
 order by repondu_le
`

export const SQL_LISTE_QUESTIONS = `
select ${COLONNES}
  from public.academie_questions_entree
 where $1::timestamptz is null or repondu_le >= $1::timestamptz
 order by repondu_le desc
 limit $2::int
`

type LigneQuestions = {
  user_id: string; version: number
  question_1: string; reponse_1: string | null; question_2: string; reponse_2: string | null
  passe: boolean; repondu_le: Date | string
}

/** Une ligne telle que la rend la route du cockpit. */
export type ReponsesQuestions = {
  user_id: string
  version: number
  questions: [string, string]
  reponses: [string | null, string | null]
  passe: boolean
  repondu_le: string
}

const iso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : new Date(d).toISOString())

export function versReponses(l: LigneQuestions): ReponsesQuestions {
  return {
    user_id: l.user_id,
    version: Number(l.version),
    questions: [l.question_1, l.question_2],
    reponses: [l.reponse_1, l.reponse_2],
    passe: l.passe === true,
    repondu_le: iso(l.repondu_le),
  }
}

/** 'faites' si le compte a deja repondu ou passe, sinon 'a_poser'. Jette si la base est illisible (table absente comprise). */
export async function etatQuestions(c: ClientSql, userId: string): Promise<'faites' | 'a_poser'> {
  const lignes = await c.$queryRawUnsafe<{ passe: boolean }[]>(SQL_ETAT_QUESTIONS, userId)
  return lignes.length ? 'faites' : 'a_poser'
}

/** Ecrit la saisie (jamais un essai). 'enregistre', ou 'deja' si le compte avait deja repondu ou passe. */
export async function enregistrerQuestions(c: ClientSql, userId: string, s: SaisieQuestions): Promise<'enregistre' | 'deja'> {
  const lignes = await c.$queryRawUnsafe<{ repondu_le: Date }[]>(SQL_ENREGISTRER_QUESTIONS,
    userId, s.version, s.questions[0], s.reponses[0], s.questions[1], s.reponses[1], s.passe)
  return lignes.length ? 'enregistre' : 'deja'
}

/** Les reponses des comptes d'une personne (fiche du cockpit). */
export async function questionsDesComptes(c: ClientSql, userIds: string[]): Promise<ReponsesQuestions[]> {
  const lignes = await c.$queryRawUnsafe<LigneQuestions[]>(SQL_QUESTIONS_DES_COMPTES, userIds)
  return lignes.map(versReponses)
}

/** Toutes les reponses (les plus recentes d'abord), depuis une date si donnee. */
export async function listerQuestions(c: ClientSql, depuis: Date | null, limite: number): Promise<ReponsesQuestions[]> {
  const lignes = await c.$queryRawUnsafe<LigneQuestions[]>(SQL_LISTE_QUESTIONS, depuis ? depuis.toISOString() : null, limite)
  return lignes.map(versReponses)
}
