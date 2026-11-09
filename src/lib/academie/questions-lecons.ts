// Les QUESTIONS SOUS CHAQUE LECON de l'academie (09/11/2026 ; decision de
// Brice du 16/10, PLAN-ACADEMIE.md section 12 ; migration
// 20261109090000_academie_questions_lecons.sql).
//
// Sous chaque lecon, un bloc « Questions sur cette leçon » :
// - un membre connecte qui a acces a la lecon pose une question (texte seul,
//   1000 caracteres, 5 par 24 heures, comme le support de Mon espace) ;
// - il voit sa question « en attente de réponse » ; les autres ne la voient
//   qu'une fois repondue ET publiee ;
// - l'equipe repond depuis UNE boite du cockpit (onglet Support, « Questions
//   des leçons ») : publier sous la lecon, ou repondre en prive (seul l'auteur
//   lit la reponse). Elle peut corriger le texte de la question avant de le
//   publier (fautes, nom cite) ; le texte du membre reste en base a cote ;
// - une question, une reponse : pas de fil entre membres.
// - Auteur affiche : rien d'identifiant (« Un membre », « Ta question »).
//
// Routes : POST /api/academie/questions-lecon (lire, poser ; jeton du site),
// POST /api/cockpit/academie/questions-lecons (lister, repondre, ecarter ;
// allowlist du cockpit). Les envois (alerte Agent AOK a l'equipe, email au
// membre) : questions-lecons-envois.ts.
//
// CE FICHIER N'IMPORTE RIEN, expres (comme questions-entree.ts) :
// scripts/verifier-questions-lecons.mjs et
// scripts/essayer-migration-questions-lecons.mjs l'importent tel quel sous
// Node 22. Les membres ecrivent du texte libre : aucune fonction d'ici ne le
// met dans un journal.

// ---------------------------------------------------------------------------
// Les bornes
// ---------------------------------------------------------------------------

/** Longueur maximale d'une question, apres nettoyage (la migration la verifie aussi). */
export const MAX_QUESTION = 1000
/** Longueur maximale d'une reponse de l'equipe. */
export const MAX_REPONSE = 4000
/** Questions par membre sur 24 heures glissantes (le support de Mon espace est a 5 aussi). */
export const MAX_QUESTIONS_JOUR = 5
/** Au-dela, le corps de la requete n'est meme pas lu. */
export const CORPS_MAX = 20_000
/** Questions rendues pour une lecon (les plus recentes). */
export const MAX_PAR_LECON = 200
/** Lignes rendues a la boite du cockpit. */
export const MAX_LISTE_EQUIPE = 300

export const URL_SITE = 'https://aoknowledge.com'
/** La boite du cockpit : espace Support, onglet des questions. */
export const LIEN_BOITE = 'https://cockpit.aoknowledge.com/?vue=support&onglet=questions'

export type StatutQuestion = 'en_attente' | 'publiee' | 'privee' | 'ecartee'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const uuid = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return UUID_RE.test(s) ? s : null
}

// ---------------------------------------------------------------------------
// Nettoyer un texte (question ou reponse)
// ---------------------------------------------------------------------------

// Caracteres de controle et invisibles, construits par leur code pour qu'aucun
// ne figure en clair dans ce fichier (meme liste que questions-entree.ts et
// liveclub/resume-pur.ts), SAUF le retour a la ligne (0x0a). La tabulation
// devient une espace avant ce filtre.
const INVISIBLES = new RegExp(`[${[[0x00, 0x09], [0x0b, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
  .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`, 'g')

/**
 * Un texte tape : NFC, fins de ligne unifiees, sans caractere de controle ni
 * invisible (inversions de sens d'ecriture comprises), espaces resserrees,
 * trois lignes vides ou plus ramenees a une.
 * null = vide (ou absent) ; 'trop_long' au-dela de max ; 'invalide' si ce n'est pas du texte.
 */
export function nettoyerTexte(brut: unknown, max: number): string | null | 'trop_long' | 'invalide' {
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
  return s.length > max ? 'trop_long' : s
}

// ---------------------------------------------------------------------------
// Le corps de la route du site
// ---------------------------------------------------------------------------

export type DemandeEleve =
  | { action: 'lire'; lecon: string }
  | { action: 'poser'; lecon: string; question: string }

/** 'action' inconnue, 'lecon' pas un id, 'question' pas du texte, 'vide', 'longueur' au-dela de MAX_QUESTION. */
export type ErreurEleve = 'action' | 'lecon' | 'question' | 'vide' | 'longueur'

/**
 * Le corps de POST /api/academie/questions-lecon :
 *   { action: 'lire', lecon }              les questions visibles par ce compte
 *   { action: 'poser', lecon, question }   une question (texte seul)
 */
export function lireDemandeEleve(corps: unknown): DemandeEleve | { erreur: ErreurEleve } {
  const c = (corps && typeof corps === 'object' && !Array.isArray(corps) ? corps : {}) as Record<string, unknown>
  if (c.action !== 'lire' && c.action !== 'poser') return { erreur: 'action' }
  const lecon = uuid(c.lecon)
  if (!lecon) return { erreur: 'lecon' }
  if (c.action === 'lire') return { action: 'lire', lecon }
  const q = nettoyerTexte(c.question, MAX_QUESTION)
  if (q === 'invalide') return { erreur: 'question' }
  if (q === 'trop_long') return { erreur: 'longueur' }
  if (q === null) return { erreur: 'vide' }
  return { action: 'poser', lecon, question: q }
}

// ---------------------------------------------------------------------------
// Qui voit quoi
// ---------------------------------------------------------------------------

/** Une ligne de la table, telle que la rendent les requetes ci-dessous. */
export type LigneQuestion = {
  id: string
  user_id: string
  lecon_id: string
  question: string
  question_publiee: string | null
  reponse: string | null
  statut: StatutQuestion
  signature: string | null
  cree_le: Date | string
  traitee_le: Date | string | null
}

/** Ce que la page de la lecon recoit : jamais un identifiant de compte ni un email. */
export type QuestionVue = {
  id: string
  /** Le texte affiche : la version corrigee par l'equipe une fois publiee, sinon le texte du membre. */
  question: string
  /** La reponse, visible par ce compte (publiee pour tous ; privee pour son auteur seul). */
  reponse: string | null
  statut: StatutQuestion
  /** La question est celle de ce compte (« Ta question » au lieu de « Un membre »). */
  mienne: boolean
  /** Le prenom de qui a repondu (« Brice »), null tant qu'il n'y a pas de reponse. */
  signature: string | null
  cree_le: string
  repondue_le: string | null
}

const iso = (d: Date | string | null): string | null =>
  d === null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString()

/**
 * LA regle : un compte voit SES questions (en attente, publiee, privee ou
 * ecartee), et celles des autres seulement une fois publiees. La route y
 * ajoute le droit sur la lecon (droitsAcademie), verifie avant toute lecture.
 */
export function visiblePour(l: Pick<LigneQuestion, 'user_id' | 'statut'>, userId: string): boolean {
  if (l.statut === 'publiee') return true
  return Boolean(userId) && l.user_id === userId
}

export function vuePourMembre(l: LigneQuestion, userId: string): QuestionVue {
  const mienne = Boolean(userId) && l.user_id === userId
  const publiee = l.statut === 'publiee'
  const repondue = publiee || (l.statut === 'privee' && mienne)
  return {
    id: l.id,
    question: publiee && l.question_publiee ? l.question_publiee : l.question,
    reponse: repondue ? l.reponse : null,
    statut: l.statut,
    mienne,
    signature: repondue ? l.signature : null,
    cree_le: iso(l.cree_le) ?? '',
    repondue_le: repondue ? iso(l.traitee_le) : null,
  }
}

const temps = (d: Date | string | null): number => (d === null ? 0 : new Date(d).getTime() || 0)

/**
 * Les questions d'une lecon pour ce compte : filtrees par visiblePour, puis
 * dans l'ordre de l'ecran. D'abord les siennes sans reponse (en attente,
 * ecartees), la plus recente en tete, puis les questions repondues (publiees,
 * et ses reponses privees), de la reponse la plus recente a la plus ancienne.
 */
export function questionsPourMembre(lignes: LigneQuestion[], userId: string): QuestionVue[] {
  const visibles = lignes.filter(l => visiblePour(l, userId))
  const sansReponse = visibles
    .filter(l => l.statut === 'en_attente' || l.statut === 'ecartee')
    .sort((a, b) => temps(b.cree_le) - temps(a.cree_le))
  const repondues = visibles
    .filter(l => l.statut === 'publiee' || l.statut === 'privee')
    .sort((a, b) => temps(b.traitee_le) - temps(a.traitee_le) || temps(b.cree_le) - temps(a.cree_le))
  return [...sansReponse, ...repondues].slice(0, MAX_PAR_LECON).map(l => vuePourMembre(l, userId))
}

/** Les questions qu'il peut encore poser sur 24 heures glissantes. */
export function restantes(posees24h: number, max = MAX_QUESTIONS_JOUR): number {
  const n = Number.isFinite(posees24h) ? Math.max(0, Math.floor(posees24h)) : max
  return Math.max(0, max - n)
}

/** Le prenom affiche sous une reponse, tire du libelle de cockpit_allowlist (« Tab (agent IA de Brice) » donne « Tab »). */
export function signatureDeLabel(label: unknown): string | null {
  if (typeof label !== 'string') return null
  const mot = label.normalize('NFC').trim().split(/[\s(]/)[0]?.trim() ?? ''
  if (!mot) return null
  return mot.slice(0, 60)
}

// ---------------------------------------------------------------------------
// Le corps de la route du cockpit
// ---------------------------------------------------------------------------

export type VueEquipe = 'attente' | 'traitees'
export type ModeReponse = 'publier' | 'prive'

export type DemandeEquipe =
  | { action: 'lister'; vue: VueEquipe }
  | { action: 'repondre'; id: string; reponse: string; question: string | null; mode: ModeReponse }
  | { action: 'ecarter'; id: string }

/**
 * Le corps de POST /api/cockpit/academie/questions-lecons :
 *   { action: 'lister', vue?: 'attente' | 'traitees' }
 *   { action: 'repondre', id, reponse, question?, mode: 'publier' | 'prive' }
 *     question = le texte corrige a publier (vide = celui du membre)
 *   { action: 'ecarter', id }
 */
export function lireDemandeEquipe(corps: unknown): DemandeEquipe | { erreur: string } {
  const c = (corps && typeof corps === 'object' && !Array.isArray(corps) ? corps : {}) as Record<string, unknown>
  if (c.action === 'lister') {
    if (c.vue === undefined || c.vue === null || c.vue === 'attente') return { action: 'lister', vue: 'attente' }
    if (c.vue === 'traitees') return { action: 'lister', vue: 'traitees' }
    return { erreur: "vue : 'attente' ou 'traitees'." }
  }
  if (c.action !== 'repondre' && c.action !== 'ecarter') return { erreur: 'Action inconnue.' }
  const id = uuid(c.id)
  if (!id) return { erreur: 'id : uuid attendu.' }
  if (c.action === 'ecarter') return { action: 'ecarter', id }
  if (c.mode !== 'publier' && c.mode !== 'prive') return { erreur: "mode : 'publier' ou 'prive'." }
  const reponse = nettoyerTexte(c.reponse, MAX_REPONSE)
  if (reponse === 'invalide' || reponse === null) return { erreur: 'La réponse est vide.' }
  if (reponse === 'trop_long') return { erreur: `La réponse dépasse ${MAX_REPONSE} caractères.` }
  const question = nettoyerTexte(c.question, MAX_QUESTION)
  if (question === 'invalide') return { erreur: 'question : texte attendu.' }
  if (question === 'trop_long') return { erreur: `La question dépasse ${MAX_QUESTION} caractères.` }
  return { action: 'repondre', id, reponse, question, mode: c.mode }
}

/** Le statut que prend une question repondue. */
export const statutDuMode = (m: ModeReponse): StatutQuestion => (m === 'publier' ? 'publiee' : 'privee')

/**
 * Le texte corrige a ranger : null s'il est vide ou identique a celui du
 * membre (rien a corriger), sinon le texte de l'equipe.
 */
export function questionCorrigee(originale: string, corrigee: string | null): string | null {
  if (corrigee === null) return null
  return corrigee === originale ? null : corrigee
}

/** Un email part a la PREMIERE reponse (ou au repechage d'une question ecartee), jamais a une retouche. */
export function premiereReponse(avant: StatutQuestion): boolean {
  return avant === 'en_attente' || avant === 'ecartee'
}

// ---------------------------------------------------------------------------
// L'alerte a l'equipe (Agent AOK, meme canal que le support de Mon espace)
// ---------------------------------------------------------------------------

/**
 * Le texte de l'alerte, sobre, sans emoji ni tiret long. `question` arrive deja
 * rendu visible par l'appelant si l'analyse de securite l'a trouve suspect, et
 * `securite` dit alors pourquoi.
 */
export function texteAlerteQuestion(a: {
  qui: string | null; moduleTitre: string; leconTitre: string; question: string; securite?: string | null
}): string {
  const message = a.question.replace(/\s+/g, ' ').trim()
  const cite = message.length > 300 ? `${message.slice(0, 300)}...` : message
  return [
    "Nouvelle question sous une leçon de l'académie.",
    `Leçon : ${a.leconTitre} (${a.moduleTitre})`,
    `Qui : ${a.qui?.trim() || 'un membre'}`,
    `Sa question : « ${cite} »`,
    a.securite?.trim() || null,
    `Pour répondre (publier sous la leçon ou en privé, il reçoit un email) : Cockpit, onglet Support, Questions des leçons. Je ne peux pas y répondre d'ici. ${LIEN_BOITE}`,
  ].filter(Boolean).join('\n')
}

// ---------------------------------------------------------------------------
// L'email au membre : sa question a une reponse
// ---------------------------------------------------------------------------

export const PREFIXE_ESSAI = '[Essai] '
export const SUPPORT_MAIL = 'support@aoknowledge.com'

/** Le lien de la lecon, ancre sur le bloc des questions. */
export function lienLecon(moduleSlug: string, leconSlug: string): string {
  return `${URL_SITE}/academie/${encodeURIComponent(moduleSlug)}/${encodeURIComponent(leconSlug)}#questions`
}

export function echapper(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export type MailQuestion = { objet: string; preheader: string; paragraphes: string[]; bouton: { texte: string; url: string }; texte: string; html: string }

/**
 * Un email court, au tutoiement de l'academie : qui a repondu, sur quelle
 * lecon, et le lien. La reponse elle-meme n'y est pas : elle se lit sous la
 * lecon (une reponse privee aussi, visible par lui seul).
 */
export function mailReponse(m: {
  moduleTitre: string; leconTitre: string; lien: string; mode: ModeReponse; signature: string | null; essai?: boolean
}): MailQuestion {
  const qui = m.signature?.trim() || "L'équipe"
  const objet = `${m.essai ? PREFIXE_ESSAI : ''}Ta question sur « ${m.leconTitre} » a sa réponse`
  const preheader = `${qui} t'a répondu sous la leçon.`
  const paragraphes = [
    'Bonjour,',
    `${qui} a répondu à la question que tu as posée sous la leçon « ${m.leconTitre} » (${m.moduleTitre}).`,
    m.mode === 'publier'
      ? "Sa réponse t'attend sous la leçon. Elle y reste pour les membres qui arriveront après toi : ta question leur sert aussi."
      : "Sa réponse t'attend sous la leçon. Elle n'est visible que par toi.",
  ]
  const bouton = { texte: 'Lire la réponse', url: m.lien }
  const signature = "À bientôt dans l'académie,\nBrice et Mélanie"
  const texte = [...paragraphes, `${bouton.texte} : ${bouton.url}`, signature].join('\n\n')
  const corps = paragraphes.map(p => `<p style="margin:0 0 16px;line-height:1.5">${echapper(p)}</p>`).join('\n')
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#ffffff;color:#111827;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${echapper(preheader)}</div>
<div style="max-width:560px;margin:0 auto">
${corps}
<p style="margin:24px 0"><a href="${echapper(bouton.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600">${echapper(bouton.texte)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280">Si le bouton ne marche pas, copie ce lien : ${echapper(bouton.url)}</p>
<p style="margin:32px 0 0;line-height:1.5">${echapper(signature).replace(/\n/g, '<br>')}</p>
</div></body></html>`
  return { objet, preheader, paragraphes, bouton, texte, html }
}

// ---------------------------------------------------------------------------
// La base
// ---------------------------------------------------------------------------

export type ClientSql = {
  $queryRawUnsafe<T = unknown>(sql: string, ...valeurs: unknown[]): Promise<T>
  $executeRawUnsafe(sql: string, ...valeurs: unknown[]): Promise<number>
}

const COLONNES = `id::text as id, user_id::text as user_id, lecon_id::text as lecon_id, question, question_publiee,
       reponse, statut, signature, cree_le, traitee_le`

export const SQL_POSEES_24H = `
select count(*)::int as n
  from public.academie_questions_lecons
 where user_id = $1::uuid and cree_le > now() - interval '1 day'
`

/**
 * La question, si le compte n'a pas deja atteint la limite sur 24 heures
 * (rien n'est rendu sinon). La limite et l'ecriture tiennent dans un seul ordre.
 */
export const SQL_POSER = `
insert into public.academie_questions_lecons (user_id, lecon_id, question)
select $1::uuid, $2::uuid, $3
 where (select count(*) from public.academie_questions_lecons
         where user_id = $1::uuid and cree_le > now() - interval '1 day') < $4::int
returning ${COLONNES}
`

/** Ce qu'un compte peut voir d'une lecon : les publiees et les siennes (la regle complete est visiblePour). */
export const SQL_QUESTIONS_DE_LECON = `
select ${COLONNES}
  from public.academie_questions_lecons
 where lecon_id = $1::uuid and (statut = 'publiee' or user_id = $2::uuid)
 order by traitee_le desc nulls first, cree_le desc
 limit $3::int
`

export const SQL_NOTER_PREVENUE = `update public.academie_questions_lecons set prevenue = true where id = $1::uuid`

export const SQL_NOTER_MAIL = `
update public.academie_questions_lecons set mail_issue = $2, mail_le = now() where id = $1::uuid
`

/** La boite du cockpit : en attente (la plus ancienne d'abord) ou traitees (la plus recente d'abord). */
export const SQL_LISTE_EQUIPE = `
select q.id::text as id, q.user_id::text as user_id, q.lecon_id::text as lecon_id, q.question, q.question_publiee,
       q.reponse, q.statut, q.signature, q.cree_le, q.traitee_le, q.prevenue, q.mail_issue,
       l.slug as lecon_slug, l.titre as lecon_titre, l.ordre as lecon_ordre,
       m.slug as module_slug, m.titre as module_titre, m.ordre as module_ordre,
       (select lower(u.email) from auth.users u where u.id = q.user_id) as email
  from public.academie_questions_lecons q
  join public.academie_lecons l on l.id = q.lecon_id
  join public.academie_modules m on m.id = l.module_id
 where case when $1 = 'attente' then q.statut = 'en_attente' else q.statut <> 'en_attente' end
 order by case when $1 = 'attente' then q.cree_le end asc,
          q.traitee_le desc nulls last, q.cree_le desc
 limit $2::int
`

export const SQL_COMPTE_ATTENTE = `
select count(*)::int as n from public.academie_questions_lecons where statut = 'en_attente'
`

/**
 * Repondre, ou retoucher une reponse. Le statut d'avant est lu sous verrou
 * (deux reponses simultanees : la seconde voit la premiere). Une premiere
 * reponse (ou le repechage d'une question ecartee) date la reponse et prend
 * la signature de qui repond ; une retouche garde la date et la signature.
 * Rend aussi la lecon, le module et l'email de l'auteur, pour l'email.
 */
export const SQL_REPONDRE = `
with avant as (
  select id, statut from public.academie_questions_lecons where id = $1::uuid for update
)
update public.academie_questions_lecons q
   set statut = $2,
       reponse = $3,
       question_publiee = $4,
       signature = case when avant.statut in ('publiee', 'privee') then q.signature else $5 end,
       traitee_par = case when avant.statut in ('publiee', 'privee') then q.traitee_par else $6::uuid end,
       traitee_le = case when avant.statut in ('publiee', 'privee') then q.traitee_le else now() end
  from avant, public.academie_lecons l, public.academie_modules m
 where q.id = avant.id and l.id = q.lecon_id and m.id = l.module_id
returning avant.statut as avant, q.id::text as id, q.statut, q.question,
          l.slug as lecon_slug, l.titre as lecon_titre, m.slug as module_slug, m.titre as module_titre,
          q.signature, (select lower(u.email) from auth.users u where u.id = q.user_id and u.email_confirmed_at is not null) as email
`

export const SQL_QUESTION_ORIGINALE = `select question from public.academie_questions_lecons where id = $1::uuid`

export const SQL_ECARTER = `
update public.academie_questions_lecons
   set statut = 'ecartee', traitee_le = now(), traitee_par = $2::uuid
 where id = $1::uuid and statut = 'en_attente'
returning id::text as id
`

export const SQL_LABEL_EQUIPE = `select label from public.cockpit_allowlist where user_id = $1::uuid`

export async function poseesSur24h(c: ClientSql, userId: string): Promise<number> {
  const l = await c.$queryRawUnsafe<{ n: number }[]>(SQL_POSEES_24H, userId)
  return Number(l[0]?.n ?? 0)
}

/** La question enregistree, ou 'limite' si le compte en a deja pose MAX_QUESTIONS_JOUR sur 24 heures. */
export async function poserQuestion(c: ClientSql, userId: string, leconId: string, question: string): Promise<LigneQuestion | 'limite'> {
  const l = await c.$queryRawUnsafe<LigneQuestion[]>(SQL_POSER, userId, leconId, question, MAX_QUESTIONS_JOUR)
  return l[0] ?? 'limite'
}

export async function questionsDeLecon(c: ClientSql, leconId: string, userId: string): Promise<QuestionVue[]> {
  const l = await c.$queryRawUnsafe<LigneQuestion[]>(SQL_QUESTIONS_DE_LECON, leconId, userId, MAX_PAR_LECON)
  return questionsPourMembre(l, userId)
}

/** Une ligne de la boite du cockpit (l'equipe voit l'email de l'auteur). */
export type QuestionEquipe = {
  id: string
  user_id: string
  lecon_id: string
  lecon_slug: string
  lecon_titre: string
  lecon_ordre: number
  module_slug: string
  module_titre: string
  module_ordre: number
  question: string
  question_publiee: string | null
  reponse: string | null
  statut: StatutQuestion
  signature: string | null
  email: string | null
  prevenue: boolean
  mail_issue: string | null
  cree_le: string
  traitee_le: string | null
}

type LigneEquipe = Omit<QuestionEquipe, 'cree_le' | 'traitee_le'> & { cree_le: Date | string; traitee_le: Date | string | null }

export async function listerPourEquipe(c: ClientSql, vue: VueEquipe): Promise<{ questions: QuestionEquipe[]; attente: number }> {
  const l = await c.$queryRawUnsafe<LigneEquipe[]>(SQL_LISTE_EQUIPE, vue, MAX_LISTE_EQUIPE)
  const n = await c.$queryRawUnsafe<{ n: number }[]>(SQL_COMPTE_ATTENTE)
  return {
    questions: l.map(x => ({
      ...x,
      lecon_ordre: Number(x.lecon_ordre),
      module_ordre: Number(x.module_ordre),
      prevenue: x.prevenue === true,
      cree_le: iso(x.cree_le) ?? '',
      traitee_le: iso(x.traitee_le),
    })),
    attente: Number(n[0]?.n ?? 0),
  }
}

export type IssueReponse = {
  avant: StatutQuestion
  id: string
  statut: StatutQuestion
  question: string
  lecon_slug: string
  lecon_titre: string
  module_slug: string
  module_titre: string
  signature: string | null
  email: string | null
}

/** Repond (ou retouche). null si la question n'existe pas. */
export async function repondreQuestion(c: ClientSql, d: Extract<DemandeEquipe, { action: 'repondre' }>, par: string, signature: string | null): Promise<IssueReponse | null> {
  const o = await c.$queryRawUnsafe<{ question: string }[]>(SQL_QUESTION_ORIGINALE, d.id)
  if (!o[0]) return null
  const l = await c.$queryRawUnsafe<IssueReponse[]>(SQL_REPONDRE,
    d.id, statutDuMode(d.mode), d.reponse, questionCorrigee(o[0].question, d.question), signature, par)
  return l[0] ?? null
}

/** Ecarte une question en attente. false si elle n'existe pas ou n'est plus en attente. */
export async function ecarterQuestion(c: ClientSql, id: string, par: string): Promise<boolean> {
  const l = await c.$queryRawUnsafe<{ id: string }[]>(SQL_ECARTER, id, par)
  return l.length > 0
}

export async function signatureDuCompte(c: ClientSql, userId: string): Promise<string | null> {
  const l = await c.$queryRawUnsafe<{ label: string | null }[]>(SQL_LABEL_EQUIPE, userId)
  return signatureDeLabel(l[0]?.label ?? null)
}
