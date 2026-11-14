// Connexion par adresse (14/11/2026, option 3 de Brice) : la partie PURE des
// routes /api/connexion/adresse et /api/connexion/envoi, appelées par la page
// de connexion du site (aoknowledge.com/connexion, la fenêtre d'achat d'un
// module, /acces-club). Partie serveur : connexion-adresse.ts. Migration :
// 20261114200000_aok_connexion_adresse.sql du dépôt workspace (table des appels
// en HMAC, fonctions aok_connexion_reconnaitre et aok_connexion_envoi, réservées
// à service_role).
//
// Reconnaître (POST /api/connexion/adresse { email }) : UN mot, toujours HTTP 200
// { reponse } : google | connue | inconnue | rattachee | simple. « simple » = la
// route ne peut pas répondre (limite atteinte, adresse refusée, base absente ou
// lente) : la page envoie le code. Jamais un nom, une offre ou une autre adresse.
//
// Envoyer (POST /api/connexion/envoi { email, creer?, newsletter?, retour?,
// origine? }) : toujours HTTP 200 { envoi, secondes? } : ok | delai | plafond |
// limite | rattachee | inconnue | invalide | indisponible. La base décide
// (aok_connexion_envoi), puis generateLink 'magiclink' (n'envoie rien ; une
// adresse sans compte : Supabase crée le compte, jeton 'signup'), puis Resend :
// le code à 6 chiffres et un lien <origine><chemin>?retour=...#token_hash=...&type=...
// que la page vérifie par verifyOtp({ token_hash, type }), sans PKCE.
//
// CORS : une liste blanche d'origines (ORIGINES). Toute autre origine, ou pas
// d'origine du tout, est refusée (403, sans en-tête CORS), préflight compris.
// Même délai minimal pour toutes les réponses (PLANCHER_MS).
//
// Aucun import relatif : Node 22 charge ce fichier tel quel
// (scripts/verifier-connexion-adresse.mjs).

import { createHmac } from 'node:crypto'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export const PLANCHER_MS = 700
export const SUPPORT = 'support@aoknowledge.com'
export const EXPEDITEUR = 'AO Knowledge <support@aoknowledge.com>'
/** L'objet de l'email : la page « Regarde ta boîte » du site le cite mot pour mot (SUJET_AOK). */
export const SUJET = 'Ton code de connexion AO Knowledge'

/**
 * Les pages qui ont le droit d'appeler les deux routes, et où revient le lien
 * de l'email (le chemin de la page qui vérifie le jeton). À ajouter quand leur
 * formulaire branchera la même vérification : masterclass.aoknowledge.com,
 * pilotage.aoknowledge.com, journal.aoknowledge.com (chacune avec sa page
 * /auth/lien).
 */
export const ORIGINES: Readonly<Record<string, string>> = {
  'https://aoknowledge.com': '/auth/lien',
  'https://www.aoknowledge.com': '/auth/lien',
  'https://academie.melaniechart.com': '/auth/lien',
}
export const ORIGINE_DEFAUT = 'https://aoknowledge.com'

export type Porte = 'google' | 'connue' | 'inconnue' | 'rattachee'
export type Reconnaissance = Porte | 'simple'
export type IssueEnvoi = 'ok' | 'delai' | 'plafond' | 'limite' | 'rattachee' | 'inconnue' | 'invalide' | 'indisponible'

const PORTES: ReadonlySet<string> = new Set(['google', 'connue', 'inconnue', 'rattachee'])
const REFUS_ENVOI: ReadonlySet<string> = new Set(['limite', 'plafond', 'rattachee', 'inconnue', 'invalide'])
export const TYPES_OTP: ReadonlySet<string> = new Set(['magiclink', 'signup', 'recovery', 'email', 'invite'])

// ---------------------------------------------------------------------------
// CORS et origine du lien
// ---------------------------------------------------------------------------

/** L'origine est-elle sur la liste blanche ? */
export function origineAutorisee(origin: string | null | undefined): origin is string {
  return typeof origin === 'string' && Object.prototype.hasOwnProperty.call(ORIGINES, origin)
}

/** Les en-têtes CORS d'une origine autorisée, ou null : la route refuse alors (403, sans en-tête). */
export function enTetesCors(origin: string | null | undefined): Record<string, string> | null {
  if (!origineAutorisee(origin)) return null
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

/**
 * La base du lien de l'email : l'origine demandée par la page si elle est sur
 * la liste, sinon l'origine de la requête, sinon aoknowledge.com. Le chemin est
 * celui de l'origine (jamais lu dans la requête).
 */
export function baseDuLien(demandee: unknown, origin: string | null | undefined): string {
  const o = typeof demandee === 'string' && origineAutorisee(demandee) ? demandee
    : origineAutorisee(origin) ? origin : ORIGINE_DEFAUT
  return o + ORIGINES[o]
}

/** Un chemin de retour interne et sûr (mêmes règles que src/lib/retour.ts du site), sinon null. */
export function cheminRetourSur(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null
  const chemin = valeur.trim()
  if (!chemin || chemin.length > 300) return null
  if (!chemin.startsWith('/') || chemin.startsWith('//')) return null
  if (/[\\\u0000-\u001f\u007f]/.test(chemin)) return null
  return chemin
}

/** Le lien de l'email (le jeton est dans le FRAGMENT : jamais envoyé au serveur du site). */
export function urlDuLien(base: string, retour: string | null, jeton: string, type: string): string {
  return base + (retour ? `?retour=${encodeURIComponent(retour)}` : '')
    + `#token_hash=${encodeURIComponent(jeton)}&type=${encodeURIComponent(type)}`
}

// ---------------------------------------------------------------------------
// HMAC (une clé par usage, dérivée du secret du serveur)
// ---------------------------------------------------------------------------

const USAGE_IP = 'aok/connexion/ip/v1'
const USAGE_ADRESSE = 'aok/connexion/adresse/v1'

function cleDerivee(secret: string, usage: string): Buffer {
  return createHmac('sha256', secret).update(usage, 'utf8').digest()
}

/** HMAC-SHA256 hexadécimal (64) de l'IP : la base ne voit jamais l'IP. */
export function hmacIp(secret: string, ip: string | null): string {
  return createHmac('sha256', cleDerivee(secret, USAGE_IP)).update(ip ?? 'inconnue', 'utf8').digest('hex')
}

/** HMAC-SHA256 hexadécimal (64) de l'adresse : les compteurs, jamais l'adresse en clair. */
export function hmacAdresse(secret: string, email: string): string {
  return createHmac('sha256', cleDerivee(secret, USAGE_ADRESSE)).update(email, 'utf8').digest('hex')
}

/** 8 caractères d'un HMAC : de quoi recouper deux lignes de log, rien de plus. */
export const ref = (hmac: string) => hmac.slice(0, 8)

// ---------------------------------------------------------------------------
// Réponses de la base
// ---------------------------------------------------------------------------

/** Ce que rend aok_connexion_reconnaitre, ramené au contrat (limite, invalide, autre : simple). */
export function lireReconnaissanceSql(v: unknown): Reconnaissance {
  return typeof v === 'string' && PORTES.has(v) ? (v as Porte) : 'simple'
}

/** Ce que rend aok_connexion_envoi : ok, delai:N, ou un refus ; null = réponse inattendue. */
export function lireEnvoiSql(v: unknown): { issue: 'ok' } | { issue: 'delai'; secondes: number } | { issue: IssueEnvoi } | null {
  if (v === 'ok') return { issue: 'ok' }
  const d = typeof v === 'string' ? /^delai:([0-9]{1,4})$/.exec(v) : null
  if (d) return { issue: 'delai', secondes: Math.max(1, Number(d[1])) }
  if (typeof v === 'string' && REFUS_ENVOI.has(v)) return { issue: v as IssueEnvoi }
  return null
}

/** Le jeton rendu par generateLink, vérifié ; null : réponse inutilisable. */
export function lireJetonSupabase(p: { email_otp?: unknown; hashed_token?: unknown; verification_type?: unknown } | null | undefined): { code: string; jeton: string; type: string } | null {
  const code = String(p?.email_otp ?? '')
  const jeton = String(p?.hashed_token ?? '')
  const brut = String(p?.verification_type ?? '')
  if (!/^[0-9]{6,10}$/.test(code) || !/^[A-Za-z0-9_-]{16,256}$/.test(jeton)) return null
  return { code, jeton, type: TYPES_OTP.has(brut) ? brut : 'magiclink' }
}

// ---------------------------------------------------------------------------
// L'email
// ---------------------------------------------------------------------------

function echapper(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export type ModeleEmail = { sujet: string; html: string; texte: string }

/** L'email de connexion : le code, le bouton, les règles. Tutoiement, comme les autres emails AOK. */
export function modeleEmailConnexion({ code, url }: { code: string; url: string }): ModeleEmail {
  const avant = 'Voici ton code pour te connecter à AO Knowledge :'
  const tape = "Tape-le sur la page où tu l'as demandé. Ou clique ce bouton : il te connecte dans le navigateur où il s'ouvre."
  const regles = "Le code et le bouton ne servent qu'une fois, et seul le dernier email reçu fonctionne."
  const pasToi = "Si ce n'est pas toi qui l'as demandé, ignore cet email : il ne se passera rien."
  const souci = 'Un souci ? Réponds à cet email.'
  const p = (t: string) => `<p style="margin:0 0 16px;line-height:1.5">${echapper(t)}</p>`
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#ffffff;color:#1a1a1a;font-family:Arial,Helvetica,sans-serif;font-size:16px">
<div style="max-width:480px;margin:0 auto">
${p('Salut,')}
${p(avant)}
<p style="margin:8px 0 20px;font-size:30px;font-weight:700;letter-spacing:6px;font-family:Menlo,Consolas,monospace">${echapper(code)}</p>
${p(tape)}
<p style="margin:24px 0">
  <a href="${echapper(url)}" style="background:#F5C842;color:#000000;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:6px;display:inline-block">Me connecter</a>
</p>
<p style="margin:0 0 16px;line-height:1.5;font-size:14px;color:#555555">${echapper(regles)} ${echapper(pasToi)}</p>
${p(souci)}
<p style="margin:0;line-height:1.5">À tout de suite,<br>L'équipe AOK</p>
</div></body></html>`
  const texte = ['Salut,', '', avant, '', code, '', tape, url, '', regles, pasToi, '', souci, '', 'À tout de suite,', "L'équipe AOK"].join('\n')
  return { sujet: SUJET, html, texte }
}

// ---------------------------------------------------------------------------
// Le déroulé (dépendances injectées : la base, Supabase, Resend)
// ---------------------------------------------------------------------------

export type Entree = {
  /** Adresse déjà normalisée (normaliserEmail), ou null si illisible. */
  email: string | null
  ip: string | null
  /** Le secret des HMAC (SUPABASE_SERVICE_ROLE_KEY), null si absent. */
  secret: string | null
}

export type DepsReconnaitre = {
  rpc: (email: string, cleIp: string, cleEmail: string) => Promise<unknown>
  journal: (ligne: string) => void
  codeErreur: (err: unknown) => string
}

/** Reconnaître une adresse. Ne jette pas. */
export async function reconnaitre(e: Entree, deps: DepsReconnaitre): Promise<{ reponse: Reconnaissance }> {
  if (!e.email) return { reponse: 'simple' }
  if (!e.secret) { deps.journal('config incomplete'); return { reponse: 'simple' } }
  const cleEmail = hmacAdresse(e.secret, e.email)
  try {
    const v = await deps.rpc(e.email, hmacIp(e.secret, e.ip), cleEmail)
    const reponse = lireReconnaissanceSql(v)
    deps.journal(`adresse ${ref(cleEmail)} : ${typeof v === 'string' && /^[a-z]{1,12}$/.test(v) ? v : 'autre'}`)
    return { reponse }
  } catch (err) {
    deps.journal(`adresse ${ref(cleEmail)} : erreur ${deps.codeErreur(err)}`)
    return { reponse: 'simple' }
  }
}

export type EntreeEnvoi = Entree & {
  creer: boolean
  newsletter: boolean
  retour: string | null
  /** La base du lien (baseDuLien). */
  base: string
  /** La clé Resend est-elle posée ? */
  resend: boolean
}

export type DepsEnvoyer = {
  rpc: (email: string, cleIp: string, cleEmail: string, creer: boolean) => Promise<unknown>
  genererLien: (email: string, donnees: Record<string, unknown> | null) => Promise<{ email_otp?: unknown; hashed_token?: unknown; verification_type?: unknown } | null>
  envoyerEmail: (email: string, m: ModeleEmail) => Promise<void>
  journal: (ligne: string) => void
  codeErreur: (err: unknown) => string
}

export type SortieEnvoi = { envoi: IssueEnvoi; secondes?: number }

/** Envoyer le code et le lien. Ne jette pas. Refus de la base : ni generateLink, ni email. */
export async function envoyer(e: EntreeEnvoi, deps: DepsEnvoyer): Promise<SortieEnvoi> {
  if (!e.email) return { envoi: 'invalide' }
  if (!e.secret || !e.resend) { deps.journal('config incomplete'); return { envoi: 'indisponible' } }
  const cleEmail = hmacAdresse(e.secret, e.email)
  const r = ref(cleEmail)
  let decision: ReturnType<typeof lireEnvoiSql>
  try {
    decision = lireEnvoiSql(await deps.rpc(e.email, hmacIp(e.secret, e.ip), cleEmail, e.creer))
  } catch (err) {
    deps.journal(`envoi ${r} : base ${deps.codeErreur(err)}`)
    return { envoi: 'indisponible' }
  }
  if (!decision) { deps.journal(`envoi ${r} : decision inattendue`); return { envoi: 'indisponible' } }
  if (decision.issue === 'delai') return { envoi: 'delai', secondes: (decision as { secondes: number }).secondes }
  if (decision.issue !== 'ok') { deps.journal(`envoi ${r} : ${decision.issue}`); return { envoi: decision.issue } }

  let jeton: ReturnType<typeof lireJetonSupabase>
  try {
    jeton = lireJetonSupabase(await deps.genererLien(e.email, e.creer && e.newsletter ? { newsletter_subscribed: true } : null))
  } catch (err) {
    deps.journal(`envoi ${r} : supabase ${deps.codeErreur(err)}`)
    return { envoi: 'indisponible' }
  }
  if (!jeton) { deps.journal(`envoi ${r} : supabase reponse inutilisable`); return { envoi: 'indisponible' } }
  try {
    await deps.envoyerEmail(e.email, modeleEmailConnexion({ code: jeton.code, url: urlDuLien(e.base, e.retour, jeton.jeton, jeton.type) }))
  } catch (err) {
    deps.journal(`envoi ${r} : resend ${deps.codeErreur(err)}`)
    return { envoi: 'indisponible' }
  }
  deps.journal(`envoi ${r} : ok (${jeton.type})`)
  return { envoi: 'ok' }
}

/** Attend que la réponse ait pris au moins `ms` depuis `debut` : même délai pour toutes les réponses. */
export async function plancher(debut: number, ms = PLANCHER_MS, maintenant = () => Date.now()): Promise<void> {
  const reste = ms - (maintenant() - debut)
  if (reste > 0) await new Promise(r => setTimeout(r, reste))
}
