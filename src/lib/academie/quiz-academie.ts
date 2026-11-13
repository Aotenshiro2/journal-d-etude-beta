// Le QUIZ DE FIN DE MODULE (13/11/2026, inventaire B9, brief 2026-11-13-quiz-et-module-suivant) : quelques
// questions a choix pour verifier qu'on a compris, avec le score, la bonne reponse et une phrase d'explication.
//
// Les questions vivent dans les donnees du module, comme le reste du catalogue : le champ « quiz » du fichier
// D:\6_Societe\Pilotage\Academie\catalogue\modules\<slug>.json, recopie tel quel (apres verification par lireQuiz)
// dans academie_modules.quiz (migration 20261113231500_academie_quiz.sql) par l'import du catalogue.
//
//   "quiz": {
//     "version": 1,                       entier, a monter quand les questions changent (un resultat garde sa version)
//     "statut": "brouillon",              brouillon = vu par l'equipe seulement (a relire) ; publie = tous les membres
//     "note": "A relire par Brice",       facultatif, jamais envoye au membre
//     "questions": [
//       { "id": "q1", "question": "...", "lecon": "<slug de la lecon>",
//         "choix": [{ "id": "a", "texte": "..." }, ...], "bonne": "b", "explication": "..." }
//     ]
//   }
//
// La correction se fait au SERVEUR : la page recoit les questions et les choix (vueQuiz), jamais la bonne reponse
// avant d'avoir repondu. Le deblocage de la suite apres un quiz (B8) viendra plus tard : il s'appuiera sur
// academie_quiz_resultats.
//
// SANS IMPORT (comme chat-academie.ts) : la partie pure est testee par scripts/verifier-quiz-academie.mjs, la partie
// base (en bas, client SQL passe en parametre) par scripts/essayer-migration-quiz-academie.mjs, sous Node.
// Le droit sur le module (droitsAcademie, catalogue) est verifie par la route /api/academie/quiz.

export type StatutQuiz = 'brouillon' | 'publie'
export type ChoixQuiz = { id: string; texte: string }
export type QuestionQuiz = {
  id: string
  question: string
  choix: ChoixQuiz[]
  bonne: string
  explication: string
  /** Le slug de la lecon qui enseigne la reponse (lien « revoir la lecon »), ou null. */
  lecon: string | null
}
export type Quiz = { version: number; statut: StatutQuiz; note: string | null; questions: QuestionQuiz[] }

/** Ce que la page recoit : ni la bonne reponse, ni l'explication, ni la note. */
export type QuizPublic = {
  version: number
  brouillon: boolean
  questions: { id: string; question: string; lecon: string | null; choix: ChoixQuiz[] }[]
}

export type Correction = {
  question: string
  choisie: string
  bonne: string
  juste: boolean
  explication: string
  lecon: string | null
}

export const LIMITES_QUIZ = {
  questions: 15,
  choixMin: 2,
  choixMax: 5,
  question: 300,
  choix: 200,
  explication: 500,
  note: 300,
  version: 9999,
} as const

/** Au plus tant de quiz envoyes par compte et par heure (route, academie_quiz_resultats). */
export const MAX_QUIZ_HEURE = 30

/** La taille du corps du POST, en caracteres (15 reponses tiennent largement). */
export const CORPS_QUIZ_MAX = 4000

const ID_RE = /^[a-z0-9][a-z0-9-]{0,19}$/
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Un slug de module ou de lecon valide (80 caracteres au plus), ou null. */
export function lireSlug(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null
  const s = valeur.trim()
  return s.length > 0 && s.length <= 80 && SLUG_RE.test(s) ? s : null
}

/** Un texte nettoye (caracteres de controle et invisibles retires, espaces resserres), ou null s'il est vide ou trop long. */
function texte(valeur: unknown, max: number): string | null {
  if (typeof valeur !== 'string') return null
  const t = valeur.replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
  return t.length >= 1 && t.length <= max ? t : null
}

type Lecture<T> = { ok: true; quiz: T } | { ok: false; erreur: string }

/**
 * Le champ « quiz » d'un fichier de module, ou la colonne academie_modules.quiz, verifie et remis en forme.
 * Rend { ok: false, erreur } sur la premiere faute (l'import s'arrete et la dit ; la route n'affiche aucun quiz).
 */
export function lireQuiz(brut: unknown): Lecture<Quiz> {
  const faux = (erreur: string): Lecture<Quiz> => ({ ok: false, erreur })
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return faux('quiz : objet attendu')
  const b = brut as Record<string, unknown>
  const version = b.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > LIMITES_QUIZ.version) {
    return faux('quiz : version (entier de 1 a 9999)')
  }
  const statut = b.statut ?? 'brouillon'
  if (statut !== 'brouillon' && statut !== 'publie') return faux('quiz : statut (brouillon ou publie)')
  let note: string | null = null
  if (b.note !== undefined && b.note !== null) {
    note = texte(b.note, LIMITES_QUIZ.note)
    if (!note) return faux(`quiz : note (1 a ${LIMITES_QUIZ.note} caracteres)`)
  }
  if (!Array.isArray(b.questions) || b.questions.length < 1 || b.questions.length > LIMITES_QUIZ.questions) {
    return faux(`quiz : questions (1 a ${LIMITES_QUIZ.questions})`)
  }
  const questions: QuestionQuiz[] = []
  const ids = new Set<string>()
  for (const [i, brute] of b.questions.entries()) {
    const ou = `quiz : question ${i + 1}`
    if (!brute || typeof brute !== 'object' || Array.isArray(brute)) return faux(`${ou} : objet attendu`)
    const q = brute as Record<string, unknown>
    const id = typeof q.id === 'string' && ID_RE.test(q.id) ? q.id : null
    if (!id) return faux(`${ou} : id (a-z, 0-9, tiret, 20 caracteres au plus)`)
    if (ids.has(id)) return faux(`${ou} : id ${id} en double`)
    ids.add(id)
    const question = texte(q.question, LIMITES_QUIZ.question)
    if (!question) return faux(`${ou} : texte de la question (1 a ${LIMITES_QUIZ.question} caracteres)`)
    if (!Array.isArray(q.choix) || q.choix.length < LIMITES_QUIZ.choixMin || q.choix.length > LIMITES_QUIZ.choixMax) {
      return faux(`${ou} : choix (${LIMITES_QUIZ.choixMin} a ${LIMITES_QUIZ.choixMax})`)
    }
    const choix: ChoixQuiz[] = []
    const idsChoix = new Set<string>()
    for (const [j, c] of q.choix.entries()) {
      const cc = (c && typeof c === 'object' && !Array.isArray(c) ? c : {}) as Record<string, unknown>
      const idc = typeof cc.id === 'string' && ID_RE.test(cc.id) ? cc.id : null
      const t = texte(cc.texte, LIMITES_QUIZ.choix)
      if (!idc || !t) return faux(`${ou} : choix ${j + 1} (id et texte de 1 a ${LIMITES_QUIZ.choix} caracteres)`)
      if (idsChoix.has(idc)) return faux(`${ou} : choix ${idc} en double`)
      idsChoix.add(idc)
      choix.push({ id: idc, texte: t })
    }
    const bonne = typeof q.bonne === 'string' && idsChoix.has(q.bonne) ? q.bonne : null
    if (!bonne) return faux(`${ou} : bonne (l'id d'un de ses choix)`)
    const explication = texte(q.explication, LIMITES_QUIZ.explication)
    if (!explication) return faux(`${ou} : explication (1 a ${LIMITES_QUIZ.explication} caracteres)`)
    let lecon: string | null = null
    if (q.lecon !== undefined && q.lecon !== null) {
      lecon = lireSlug(q.lecon)
      if (!lecon) return faux(`${ou} : lecon (slug)`)
    }
    questions.push({ id, question, choix, bonne, explication, lecon })
  }
  return { ok: true, quiz: { version, statut, note, questions } }
}

/** Le quiz tel que la page le recoit : les questions et les choix, sans la reponse. */
export function vueQuiz(q: Quiz): QuizPublic {
  return {
    version: q.version,
    brouillon: q.statut !== 'publie',
    questions: q.questions.map(x => ({ id: x.id, question: x.question, lecon: x.lecon, choix: x.choix.map(c => ({ id: c.id, texte: c.texte })) })),
  }
}

/** Le quiz se montre-t-il a ce compte : publie pour tous, brouillon pour l'equipe seulement (relecture). */
export function quizVisible(q: Pick<Quiz, 'statut'>, compte: { admin: boolean; equipe: boolean }): boolean {
  return q.statut === 'publie' || compte.admin || compte.equipe
}

export type DemandeQuiz = { module: string; version: number; reponses: Record<string, string> }

/** Le corps du POST : { module, version, reponses: { <id de question>: <id de choix> } }. */
export function lireDemandeQuiz(corps: unknown): { ok: true; demande: DemandeQuiz } | { ok: false; erreur: 'module' | 'version' | 'reponses' } {
  const c = (corps && typeof corps === 'object' && !Array.isArray(corps) ? corps : {}) as Record<string, unknown>
  const slug = lireSlug(c.module)
  if (!slug) return { ok: false, erreur: 'module' }
  const version = c.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > LIMITES_QUIZ.version) {
    return { ok: false, erreur: 'version' }
  }
  const r = c.reponses
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, erreur: 'reponses' }
  const entrees = Object.entries(r as Record<string, unknown>)
  if (entrees.length < 1 || entrees.length > LIMITES_QUIZ.questions) return { ok: false, erreur: 'reponses' }
  const reponses: Record<string, string> = {}
  for (const [q, choix] of entrees) {
    if (!ID_RE.test(q) || typeof choix !== 'string' || !ID_RE.test(choix)) return { ok: false, erreur: 'reponses' }
    reponses[q] = choix
  }
  return { ok: true, demande: { module: slug, version, reponses } }
}

/**
 * La correction : une reponse par question du quiz, chacune un choix de la question. Rend null si une question
 * n'a pas de reponse, si une reponse vise une question inconnue ou un choix qui n'existe pas (la route dit 400).
 */
export function corriger(q: Quiz, reponses: Record<string, string>): { bonnes: number; total: number; corrections: Correction[] } | null {
  if (Object.keys(reponses).some(id => !q.questions.some(x => x.id === id))) return null
  const corrections: Correction[] = []
  for (const x of q.questions) {
    const choisie = reponses[x.id]
    if (!choisie || !x.choix.some(c => c.id === choisie)) return null
    corrections.push({ question: x.id, choisie, bonne: x.bonne, juste: choisie === x.bonne, explication: x.explication, lecon: x.lecon })
  }
  return { bonnes: corrections.filter(c => c.juste).length, total: corrections.length, corrections }
}

/** Les raisons qui ouvrent un contenu (pur.ts, Raison), vues ici comme de simples mots. */
export type AccesModuleQuiz = { acces: 'entier' | 'partiel' | 'ferme' | 'inconnu'; raisons: readonly string[] }

/**
 * Le quiz s'ouvre-t-il a ce compte : le module lui est ouvert en entier ou en partie, et pas seulement par une
 * lecon d'apercu ou le billet du jour (la regle de « Mes cours » du site, estAMoi). 'inconnu' : seule une source
 * illisible (Live Club chez Stripe) pouvait l'ouvrir. r : ouvertureModule (pur.ts), calcule par la route.
 */
export function droitAuQuiz(r: AccesModuleQuiz): 'oui' | 'non' | 'inconnu' {
  if (r.acces === 'inconnu') return 'inconnu'
  if (r.acces !== 'entier' && r.acces !== 'partiel') return 'non'
  return r.raisons.some(x => x !== 'apercu' && x !== 'billet') ? 'oui' : 'non'
}

// ---------------------------------------------------------------------------
// La base (migration 20261113231500) : la colonne academie_modules.quiz et la table academie_quiz_resultats.
// Avant la migration : la colonne absente se lit comme « pas de quiz » (la page n'affiche rien), la table absente
// comme « aucun resultat », et un resultat n'est pas garde (la correction est rendue quand meme).
// ---------------------------------------------------------------------------

export type ClientSql = {
  $queryRawUnsafe<T = unknown>(sql: string, ...valeurs: unknown[]): Promise<T>
  $executeRawUnsafe(sql: string, ...valeurs: unknown[]): Promise<number>
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
/** Une colonne absente (42703) : la migration n'est pas appliquee. */
export const colonneQuizAbsente = (err: unknown) => /42703|column .* does not exist/i.test(message(err))
/** Une table absente (42P01) : la migration n'est pas appliquee. */
export const tableQuizAbsente = (err: unknown) => /42P01|relation .* does not exist/i.test(message(err))

export const SQL_QUIZ_DU_MODULE = `select quiz from public.academie_modules where id = $1::uuid`

export const SQL_DERNIER_RESULTAT = `
select version, bonnes, total, fait_le
  from public.academie_quiz_resultats
 where user_id = $1::uuid and module_id = $2::uuid
 order by fait_le desc
 limit 1
`

export const SQL_ENVOIS_HEURE = `
select count(*)::int as n
  from public.academie_quiz_resultats
 where user_id = $1::uuid and fait_le > now() - interval '1 hour'
`

export const SQL_NOTER_RESULTAT = `
insert into public.academie_quiz_resultats (user_id, module_id, version, bonnes, total, reponses)
values ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
returning fait_le
`

/**
 * Le quiz du module, verifie. null : pas de quiz, ou un quiz illisible (journalise) ; 'migration' : la colonne
 * n'existe pas encore. Jette sur une autre panne de base.
 */
export async function quizDuModule(c: ClientSql, moduleId: string): Promise<Quiz | null | 'migration'> {
  let lignes: { quiz: unknown }[]
  try {
    lignes = await c.$queryRawUnsafe<{ quiz: unknown }[]>(SQL_QUIZ_DU_MODULE, moduleId)
  } catch (err) {
    if (colonneQuizAbsente(err)) return 'migration'
    throw err
  }
  const brut = lignes[0]?.quiz
  if (brut === null || brut === undefined) return null
  const lu = lireQuiz(brut)
  if (!lu.ok) {
    console.warn(`[academie/quiz] quiz illisible module=${moduleId.slice(0, 8)} : ${lu.erreur}`)
    return null
  }
  return lu.quiz
}

export type DernierResultat = { version: number; bonnes: number; total: number; fait_le: string }

/** Le dernier resultat du compte sur ce module (toutes versions), ou null (aucun, ou table absente). */
export async function dernierResultat(c: ClientSql, userId: string, moduleId: string): Promise<DernierResultat | null> {
  try {
    const l = await c.$queryRawUnsafe<{ version: number; bonnes: number; total: number; fait_le: Date }[]>(SQL_DERNIER_RESULTAT, userId, moduleId)
    const r = l[0]
    return r ? { version: Number(r.version), bonnes: Number(r.bonnes), total: Number(r.total), fait_le: new Date(r.fait_le).toISOString() } : null
  } catch (err) {
    if (tableQuizAbsente(err)) return null
    throw err
  }
}

/** Les quiz envoyes par ce compte depuis une heure (0 si la table n'existe pas encore). */
export async function envoisSurUneHeure(c: ClientSql, userId: string): Promise<number> {
  try {
    const l = await c.$queryRawUnsafe<{ n: number }[]>(SQL_ENVOIS_HEURE, userId)
    return Number(l[0]?.n ?? 0)
  } catch (err) {
    if (tableQuizAbsente(err)) return 0
    throw err
  }
}

/** Garde le resultat ; rend sa date. null si la table n'existe pas encore (la correction est rendue quand meme). */
export async function noterResultat(
  c: ClientSql, userId: string, moduleId: string, version: number, bonnes: number, total: number, reponses: Record<string, string>,
): Promise<string | null> {
  try {
    const l = await c.$queryRawUnsafe<{ fait_le: Date }[]>(SQL_NOTER_RESULTAT, userId, moduleId, version, bonnes, total, JSON.stringify(reponses))
    return l[0] ? new Date(l[0].fait_le).toISOString() : null
  } catch (err) {
    if (tableQuizAbsente(err)) return null
    throw err
  }
}
