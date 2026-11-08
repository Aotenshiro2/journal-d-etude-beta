// Invitations des membres de Skool vers l'academie (passation, 08/11/2026) : la partie PURE, sans base ni
// reseau. Choix de Brice du 08/11 (options A2 et A4 de D:\6_Societe\Pilotage\Academie\PASSATION-SKOOL-OPTIONS-2026-11-08.md) :
// un email aux adresses connues (versions payant et gratuit, relance a J+3 pour qui n'a pas de compte), et
// pour les payants sans compte un lien personnel qui cree le compte et connecte en un clic.
//
// Qui s'en sert :
// - scripts/inviter-membres-skool.mjs (envoi, relance, compteur ; essai a blanc par defaut) ;
// - src/lib/academie/invitations.ts et GET /api/academie/invitation?j=<jeton> (l'ouverture du lien) ;
// - scripts/verifier-invitations-skool.mjs (hors ligne).
// Aucun import relatif : Node 22 charge ce fichier tel quel.
//
// Le lien (version payant seulement) :
// - jeton = 32 octets en base64url (43 caracteres), DERIVE du secret du serveur, de l'id de la ligne et de
//   son numero de jeton (deriverJeton). La base ne garde que son sha256 (jeton_hash) : le script le recalcule
//   pour la relance, la route n'a besoin d'aucun secret (elle hache ce qu'on lui presente) ;
// - valable VALIDITE_JOURS jours, cliquable PLUSIEURS FOIS jusqu'a expiration (telephone puis ordinateur) :
//   chaque clic genere un nouveau jeton Supabase a usage unique ;
// - un jeton ne connecte QUE l'email de sa ligne (email de connexion du compte, jamais une adresse secondaire).
//
// Le parcours d'un clic (ouvrirInvitation) :
// 1. jeton lu, hache, ligne trouvee (version payant), non expiree ;
// 2. compte de cet email (auth.users) : absent, cree par l'admin Supabase avec l'email CONFIRME (le lien
//    n'arrive que dans cette boite) ; l'email n'est qu'une adresse secondaire verifiee d'un AUTRE compte :
//    pas de session, renvoi vers la connexion (repere « compte ») ;
// 3. generateLink 'magiclink' (n'envoie rien) : on garde properties.hashed_token et verification_type ;
// 4. ouvert_le, compte_le, clics notes ; redirection vers aoknowledge.com/auth/invitation#token_hash=...&type=...
//    (FRAGMENT : jamais envoye au serveur du site). La page appelle verifyOtp({ token_hash, type }), qui marche
//    avec le client PKCE du site (ni code ni code_verifier), puis ouvre l'academie.
// Jeton absent, inconnu ou expire : aoknowledge.com/connexion?invitation=<repere>.
//
// Jamais le jeton, le token_hash ni l'adresse dans un log : 8 caracteres de l'id de la ligne pour recouper.

import { createHash, createHmac, randomBytes } from 'node:crypto'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Le lot de la passation : une invitation par email et par lot. */
export const LOT_DEFAUT = 'skool-2026-11'
export const POSE_PAR = 'agent:passation-skool'

/** Un lien d'invitation vaut 14 jours. */
export const VALIDITE_JOURS = 14
/** La relance part 3 jours (ou plus) apres le premier email. */
export const RELANCE_APRES_JOURS = 3
/**
 * Un lien qui expire dans moins de 5 jours n'est pas redonne : un nouveau part (14 jours). Vaut pour la
 * relance et pour un premier envoi repris apres un echec.
 */
export const RELANCE_SEUIL_JOURS = 5
/** Emails au plus par passage du script (le plan gratuit de Resend s'arrete a 100 par jour). */
export const MAX_DEFAUT = 90
/** Une ligne reservee par un passage du script n'est pas reprise par un autre avant 30 minutes. */
export const RESERVATION_MINUTES = 30

export const URL_SITE = 'https://aoknowledge.com'
export const URL_CONNEXION = `${URL_SITE}/connexion`
export const CHEMIN_PAGE_INVITATION = '/auth/invitation'
export const URL_ROUTE_DEFAUT = 'https://journal.aoknowledge.com/api/academie/invitation'

export const SUPPORT = 'support@aoknowledge.com'
export const EXPEDITEUR = 'AO Knowledge <support@aoknowledge.com>'

/** Le type de lien Supabase genere a l'ouverture (le compte existe deja : il n'en cree pas). */
export const TYPE_LIEN_SUPABASE = 'magiclink'
/** Les types que la page du site accepte de passer a verifyOtp (verification_type rendu par generateLink). */
export const TYPES_OTP = ['magiclink', 'signup', 'recovery', 'email', 'invite'] as const
export type TypeOtp = (typeof TYPES_OTP)[number]

export type VersionCsv = 'payant' | 'gratuit'
export type Version = 'payant' | 'payant-compte' | 'gratuit'
/** Le repere de /connexion?invitation= (la page de connexion du site affiche une phrase). */
export type Repere = 'invalide' | 'expiree' | 'compte' | 'erreur'

const JOUR_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Jetons
// ---------------------------------------------------------------------------

const USAGE_JETON = 'aok/academie_invitation/jeton/v1'

/**
 * Le jeton d'une ligne : HMAC-SHA256 (cle derivee du secret pour cet usage) de « <id>:<numero> », en
 * base64url (43 caracteres). Le meme secret, la meme ligne et le meme numero rendent le meme jeton : la
 * relance peut redonner le lien du premier email sans que la base garde le jeton.
 */
export function deriverJeton(secret: string, id: string, numero: number): string {
  if (!secret || secret.length < 32) throw new Error('secret trop court')
  if (!Number.isInteger(numero) || numero < 1) throw new Error('numero de jeton invalide')
  const cle = createHmac('sha256', secret).update(USAGE_JETON, 'utf8').digest()
  return createHmac('sha256', cle).update(`${id}:${numero}`, 'utf8').digest('base64url')
}

/** Ce que la base garde du jeton : son sha256 en hexadecimal (64 caracteres). */
export function hacherJeton(jeton: string): string {
  return createHash('sha256').update(jeton, 'utf8').digest('hex')
}

/** Un jeton qui n'est dans aucune ligne (emails d'essai) : 32 octets aleatoires. */
export function jetonAleatoire(): string {
  return randomBytes(32).toString('base64url')
}

/** Le jeton lu dans une requete, ou null : exactement 43 caracteres base64url. */
export function lireJeton(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v) ? v : null
}

/** La base de la route (https sur aoknowledge.com, ou localhost en dev), sinon celle de la production. */
export function baseRoute(v: string | undefined | null): string {
  const b = (v ?? '').trim().replace(/\/+$/, '')
  if (/^https:\/\/([a-z0-9-]+\.)*aoknowledge\.com\/api\/academie\/invitation$/.test(b)) return b
  if (/^http:\/\/localhost(:\d{2,5})?\/api\/academie\/invitation$/.test(b)) return b
  return URL_ROUTE_DEFAUT
}

/** Le lien de l'email (version payant). */
export function lienInvitation(jeton: string, base: string = URL_ROUTE_DEFAUT): string {
  return `${baseRoute(base)}?j=${jeton}`
}

/** Le lien de l'email selon la version : la route pour un payant sans compte, la connexion sinon. */
export function lienPourVersion(version: Version, jeton: string | null, base?: string): string {
  if (version === 'payant') {
    if (!jeton) throw new Error('jeton manquant pour la version payant')
    return lienInvitation(jeton, base)
  }
  return URL_CONNEXION
}

// ---------------------------------------------------------------------------
// CSV : email;version;prenom
// ---------------------------------------------------------------------------

export type LigneCsv = { numero: number; email: string; version: VersionCsv; prenom: string | null }

const EMAIL_RE = /^[^\s@;,<>"'()]+@[^\s@;,<>"'()]+\.[^\s@;,<>"'()]+$/

/** L'email en minuscules, sans espaces autour, ou null s'il est illisible. */
export function normaliserEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim().toLowerCase()
  return e.length >= 3 && e.length <= 320 && EMAIL_RE.test(e) ? e : null
}

/**
 * Le prenom tel qu'il entre dans un email : sans caracteres de controle, ni accolades (gabarits), ni
 * chevrons, espaces resserres, 60 caracteres au plus. Vide = null.
 */
export function nettoyerPrenom(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const p = v.replace(/[\u0000-\u001f\u007f{}<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim()
  return p || null
}

/**
 * Lit le CSV « email;version;prenom » (en-tete facultatif, lignes vides et « # » ignorees, BOM et fins de
 * ligne Windows acceptes). Version : payant ou gratuit. Une adresse vue deux fois compte une fois (doublons) :
 * payant l'emporte sur gratuit, le premier prenom non vide est garde. Les erreurs donnent le NUMERO de ligne,
 * jamais l'adresse.
 */
export function lireCsvInvitations(texte: string): {
  lignes: LigneCsv[]
  erreurs: { numero: number; motif: string }[]
  doublons: number
} {
  const lignes: LigneCsv[] = []
  const erreurs: { numero: number; motif: string }[] = []
  const parEmail = new Map<string, LigneCsv>()
  let doublons = 0
  const brutes = texte.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  brutes.forEach((brute, i) => {
    const numero = i + 1
    const ligne = brute.trim()
    if (!ligne || ligne.startsWith('#')) return
    const [emailBrut = '', versionBrute = '', ...reste] = ligne.split(';')
    if (emailBrut.trim().toLowerCase() === 'email') return // en-tete
    const email = normaliserEmail(emailBrut)
    if (!email) { erreurs.push({ numero, motif: 'email illisible' }); return }
    const v = versionBrute.trim().toLowerCase()
    if (v !== 'payant' && v !== 'gratuit') { erreurs.push({ numero, motif: `version inconnue (${v.slice(0, 20) || 'vide'})` }); return }
    const prenom = nettoyerPrenom(reste.join(';'))
    const deja = parEmail.get(email)
    if (deja) {
      doublons++
      if (v === 'payant') deja.version = 'payant'
      if (!deja.prenom && prenom) deja.prenom = prenom
      return
    }
    const l: LigneCsv = { numero, email, version: v, prenom }
    parEmail.set(email, l)
    lignes.push(l)
  })
  return { lignes, erreurs, doublons }
}

// ---------------------------------------------------------------------------
// Comptes et versions
// ---------------------------------------------------------------------------

/**
 * Le compte d'une adresse : 'utilisable' = un compte dont l'email de connexion confirme EST l'adresse, ou
 * une adresse verifiee de profile_emails (les droits s'ouvrent a la connexion, droits.ts) ;
 * 'non_confirme' = un compte existe avec cet email de connexion, jamais confirme (le lien d'invitation le
 * confirme) ; 'aucun'.
 */
export type EtatCompte = 'utilisable' | 'non_confirme' | 'aucun'

/** La version envoyee : un payant qui a deja un compte utilisable recoit le lien de connexion, pas de jeton. */
export function versionPour(v: VersionCsv, compte: EtatCompte): Version {
  if (v === 'gratuit') return 'gratuit'
  return compte === 'utilisable' ? 'payant-compte' : 'payant'
}

// ---------------------------------------------------------------------------
// Les lignes de la table et le plan d'un passage
// ---------------------------------------------------------------------------

export type LigneInvitation = {
  id: string
  email: string
  version: Version
  prenom: string | null
  jetonHash: string | null
  jetonNumero: number
  expireLe: Date | null
  envoyeLe: Date | null
  relanceLe: Date | null
  reserveLe: Date | null
  ouvertLe: Date | null
  compteLe: Date | null
  compteCree: boolean
  erreur: string | null
}

/** 'nouveau' : un jeton neuf (numero + 1, 14 jours) ; 'reprendre' : le jeton de la ligne, encore assez long. */
export type DecisionJeton = 'nouveau' | 'reprendre'

/**
 * Le jeton d'un envoi. Premier envoi : celui de la ligne s'il est encore valable (un envoi rate est repris
 * avec le meme lien), sinon un neuf. Relance : un neuf si le lien expire dans moins de seuilJours.
 */
export function decisionJeton(
  l: Pick<LigneInvitation, 'jetonHash' | 'expireLe' | 'jetonNumero'> | null,
  maintenant: Date,
  seuilJours = 0,
): DecisionJeton {
  if (!l || !l.jetonHash || !l.expireLe || l.jetonNumero < 1) return 'nouveau'
  return l.expireLe.getTime() - maintenant.getTime() <= seuilJours * JOUR_MS ? 'nouveau' : 'reprendre'
}

/** La date d'expiration d'un jeton neuf. */
export function expirationNouveauJeton(maintenant: Date, jours = VALIDITE_JOURS): Date {
  return new Date(maintenant.getTime() + jours * JOUR_MS)
}

/** Vrai si une autre execution tient la ligne (reservee il y a moins de RESERVATION_MINUTES). */
export function estReservee(l: Pick<LigneInvitation, 'reserveLe'> | null, maintenant: Date): boolean {
  return Boolean(l?.reserveLe && maintenant.getTime() - l.reserveLe.getTime() < RESERVATION_MINUTES * 60 * 1000)
}

export type EtatRelance = 'due' | 'non_envoye' | 'deja_relance' | 'trop_tot' | 'compte' | 'reservee'

/**
 * Une ligne a relancer : premier email parti il y a RELANCE_APRES_JOURS jours ou plus, aucune relance faite,
 * toujours pas de compte utilisable (un payant-compte en a un par definition).
 */
export function etatRelance(
  l: Pick<LigneInvitation, 'version' | 'envoyeLe' | 'relanceLe' | 'reserveLe'> | null,
  compte: EtatCompte,
  maintenant: Date,
): EtatRelance {
  if (!l || !l.envoyeLe) return 'non_envoye'
  if (l.relanceLe) return 'deja_relance'
  if (l.version === 'payant-compte' || compte === 'utilisable') return 'compte'
  if (maintenant.getTime() - l.envoyeLe.getTime() < RELANCE_APRES_JOURS * JOUR_MS) return 'trop_tot'
  if (estReservee(l, maintenant)) return 'reservee'
  return 'due'
}

export type Mode = 'envoi' | 'relance'

export type Action = {
  numero: number
  email: string
  prenom: string | null
  versionCsv: VersionCsv
  version: Version
  ligne: LigneInvitation | null
  /** null : pas de jeton (payant-compte, gratuit). */
  jeton: DecisionJeton | null
}

export type BilanPlan = {
  mode: Mode
  lignes: number
  par_version_csv: Record<VersionCsv, number>
  comptes: Record<EtatCompte, number>
  /** Ce qui partirait, par version envoyee (avant le plafond). */
  a_envoyer: Record<Version, number>
  eligibles: number
  retenus: number
  reportes: number
  jetons_neufs: number
  jetons_repris: number
  ecartees: Record<string, number>
}

/**
 * Le plan d'un passage : ce qui part (au plus `max`), ce qui est ecarte et pourquoi. Les payants passent
 * d'abord (leurs acces sont en jeu, et le plafond du jour ne doit pas les repousser derriere 164 gratuits),
 * puis les gratuits, chacun dans l'ordre du CSV.
 * comptes : l'etat de compte par email (absent = 'aucun'). table : les lignes deja en base pour ce lot.
 */
export function planifier(opts: {
  mode: Mode
  lignes: LigneCsv[]
  comptes: Map<string, EtatCompte>
  table: Map<string, LigneInvitation>
  max: number
  maintenant: Date
}): { actions: Action[]; bilan: BilanPlan } {
  const { mode, lignes, comptes, table, max, maintenant } = opts
  const bilan: BilanPlan = {
    mode,
    lignes: lignes.length,
    par_version_csv: { payant: 0, gratuit: 0 },
    comptes: { utilisable: 0, non_confirme: 0, aucun: 0 },
    a_envoyer: { payant: 0, 'payant-compte': 0, gratuit: 0 },
    eligibles: 0,
    retenus: 0,
    reportes: 0,
    jetons_neufs: 0,
    jetons_repris: 0,
    ecartees: {},
  }
  const ecarter = (motif: string) => { bilan.ecartees[motif] = (bilan.ecartees[motif] ?? 0) + 1 }
  const actions: Action[] = []
  const ordonnees = [...lignes.filter(l => l.version === 'payant'), ...lignes.filter(l => l.version !== 'payant')]

  for (const l of ordonnees) {
    bilan.par_version_csv[l.version]++
    const compte = comptes.get(l.email) ?? 'aucun'
    bilan.comptes[compte]++
    const ligne = table.get(l.email) ?? null

    let version: Version
    let jeton: DecisionJeton | null = null
    if (mode === 'envoi') {
      if (ligne?.envoyeLe) { ecarter('deja_envoye'); continue }
      if (estReservee(ligne, maintenant)) { ecarter('reservee'); continue }
      version = versionPour(l.version, compte)
      if (version === 'payant') jeton = decisionJeton(ligne?.version === 'payant' ? ligne : null, maintenant, RELANCE_SEUIL_JOURS)
    } else {
      const etat = etatRelance(ligne, compte, maintenant)
      if (etat !== 'due' || !ligne) { ecarter(etat); continue }
      // La relance garde la version du premier email (payant ou gratuit).
      version = ligne.version
      if (version === 'payant') jeton = decisionJeton(ligne, maintenant, RELANCE_SEUIL_JOURS)
    }

    bilan.eligibles++
    bilan.a_envoyer[version]++
    if (actions.length >= max) { bilan.reportes++; continue }
    actions.push({ numero: l.numero, email: l.email, prenom: l.prenom ?? ligne?.prenom ?? null, versionCsv: l.version, version, ligne, jeton })
    bilan.retenus++
    if (jeton === 'nouveau') bilan.jetons_neufs++
    if (jeton === 'reprendre') bilan.jetons_repris++
  }
  return { actions, bilan }
}

// ---------------------------------------------------------------------------
// Compteur (lecture seule) : par version du CSV
// ---------------------------------------------------------------------------

/** Les chiffres d'une version. null : pas mesure (table absente, migration pas appliquee). */
export type LigneCompteur = {
  adresses: number
  comptes: number
  comptes_non_confirmes: number
  recus: number | null
  relances: number | null
  ouverts: number | null
  comptes_crees_par_invitation: number | null
}

/**
 * Les chiffres du compteur, par version du CSV (payant, gratuit) et au total. Compte = compte utilisable
 * (email de connexion confirme, ou adresse verifiee de profile_emails). Recu = premier email parti, ouvert =
 * lien d'invitation clique au moins une fois (version payant seulement : les autres n'ont pas de lien suivi).
 */
export function compter(
  lignes: LigneCsv[],
  comptes: Map<string, EtatCompte>,
  table: Map<string, LigneInvitation> | null,
): Record<VersionCsv | 'total', LigneCompteur> {
  const vide = (): LigneCompteur => ({
    adresses: 0, comptes: 0, comptes_non_confirmes: 0,
    recus: table ? 0 : null, relances: table ? 0 : null, ouverts: table ? 0 : null, comptes_crees_par_invitation: table ? 0 : null,
  })
  const r: Record<VersionCsv | 'total', LigneCompteur> = { payant: vide(), gratuit: vide(), total: vide() }
  const plus = (n: number | null, oui: boolean) => (n === null ? null : n + (oui ? 1 : 0))
  for (const l of lignes) {
    const etat = comptes.get(l.email) ?? 'aucun'
    const t = table?.get(l.email)
    for (const cle of [l.version, 'total'] as const) {
      const c = r[cle]
      c.adresses++
      if (etat === 'utilisable') c.comptes++
      if (etat === 'non_confirme') c.comptes_non_confirmes++
      c.recus = plus(c.recus, Boolean(t?.envoyeLe))
      c.relances = plus(c.relances, Boolean(t?.relanceLe))
      c.ouverts = plus(c.ouverts, Boolean(t?.ouvertLe))
      c.comptes_crees_par_invitation = plus(c.comptes_crees_par_invitation, Boolean(t?.compteCree))
    }
  }
  return r
}

// ---------------------------------------------------------------------------
// Modeles d'email : {{prenom}} et {{lien}}
// ---------------------------------------------------------------------------

export type Modele = { sujet: string; corps: string }

/** Le nom de fichier d'un modele : <prefixe><version>.sujet.txt et .corps.txt (prefixe 'relance-' a la relance). */
export function nomModele(mode: Mode, version: Version): string {
  return `${mode === 'relance' ? 'relance-' : ''}${version}`
}

const MARQUES_RE = /\{\{\s*([^}]*?)\s*\}\}/g
const MARQUES_CONNUES = new Set(['prenom', 'lien'])

/** Les defauts d'un modele (vide = bon). */
export function verifierModele(m: Modele): string[] {
  const defauts: string[] = []
  const sujet = m.sujet.trim()
  if (!sujet) defauts.push('sujet vide')
  if (/\n/.test(sujet)) defauts.push('sujet sur plusieurs lignes')
  if (sujet.length > 200) defauts.push('sujet de plus de 200 caracteres')
  if (/\{\{\s*lien\s*\}\}/.test(sujet)) defauts.push('{{lien}} dans le sujet')
  if (!m.corps.trim()) defauts.push('corps vide')
  if (!/\{\{\s*lien\s*\}\}/.test(m.corps)) defauts.push('corps sans {{lien}}')
  for (const texte of [sujet, m.corps]) {
    for (const [, nom] of texte.matchAll(MARQUES_RE)) {
      if (!MARQUES_CONNUES.has(nom)) defauts.push(`marque inconnue {{${nom}}}`)
    }
  }
  return [...new Set(defauts)]
}

/** Vrai si le modele est un brouillon (le mot BROUILLON dans le sujet ou le corps) : il ne part a aucun membre. */
export function estBrouillon(m: Modele): boolean {
  return /brouillon/i.test(m.sujet) || /brouillon/i.test(m.corps)
}

/** Remplace {{prenom}} et {{lien}}. Sans prenom, « Bonjour {{prenom}}, » devient « Bonjour, ». */
export function remplir(texte: string, v: { prenom: string | null; lien: string }): string {
  return texte
    .replace(/([ \t]*)\{\{\s*prenom\s*\}\}/g, (_m, espaces: string) => (v.prenom ? `${espaces}${v.prenom}` : ''))
    .replace(/\{\{\s*lien\s*\}\}/g, () => v.lien)
}

const echapper = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/**
 * Le HTML d'un corps en texte : paragraphes aux lignes vides, retours a la ligne gardes, adresses https en
 * liens, tout le reste echappe.
 */
export function htmlDepuisTexte(texte: string): string {
  const paragraphes = texte.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/)
  const corps = paragraphes.map(p => {
    const lignes = p.split('\n').map(ligne =>
      ligne.split(/(https:\/\/[^\s<>"']+)/g).map((morceau, i) =>
        i % 2 === 1 ? `<a href="${echapper(morceau)}" style="color:#1a56db">${echapper(morceau)}</a>` : echapper(morceau),
      ).join(''),
    )
    return `<p style="margin:0 0 16px">${lignes.join('<br>')}</p>`
  }).join('\n')
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;max-width:560px">\n${corps}\n</div>`
}

/** L'email d'une action : sujet, texte et HTML. */
export function emailDepuisModele(m: Modele, v: { prenom: string | null; lien: string }, essai = false): { sujet: string; texte: string; html: string } {
  const sujet = remplir(m.sujet.trim(), v).replace(/\s+/g, ' ').trim()
  const texte = remplir(m.corps.replace(/\r\n?/g, '\n').trim(), v)
  return { sujet: essai ? `[Essai] ${sujet}` : sujet, texte, html: htmlDepuisTexte(texte) }
}

/** Les adresses de test de Resend, seules acceptees par --test-vers. */
export function estAdresseTestResend(v: unknown): boolean {
  return typeof v === 'string' && /^(delivered|bounced|complained|suppressed)(\+[a-z0-9_-]{1,40})?@resend\.dev$/.test(v.trim().toLowerCase())
}

/** Un message d'erreur sans adresse email (remplacee par [email]), 300 caracteres au plus. */
export function masquerEmails(v: unknown): string {
  return String(v instanceof Error ? v.message : v)
    .split('\n').slice(-3).join(' ')
    .replace(/[^\s@;,()<>"']+@[^\s@;,()<>"']+/g, '[email]')
    .slice(0, 300)
}

// ---------------------------------------------------------------------------
// L'ouverture du lien (route GET /api/academie/invitation)
// ---------------------------------------------------------------------------

// Les requetes de la route (invitations.ts), ici pour que scripts/essayer-migration-invitations.mjs joue
// EXACTEMENT les memes.

/** $1 = jeton_hash. */
export const SQL_TROUVER = `
select i.id::text as id, i.email, i.prenom, i.version, i.expire_le
  from public.academie_invitations i
 where i.jeton_hash = $1
 limit 1`

/** $1 = email (minuscules). L'email de CONNEXION seulement : c'est le seul compte qu'un lien peut ouvrir. */
export const SQL_COMPTE_CONNEXION = `
select u.id::text as user_id, (u.email_confirmed_at is not null) as confirme
  from auth.users u
 where lower(btrim(u.email)) = $1
 order by u.created_at
 limit 1`

/** $1 = email : une adresse verifiee d'un autre compte (profile_emails). */
export const SQL_COMPTE_SECONDAIRE = `
select exists (
  select 1 from public.profile_emails pe where lower(btrim(pe.email)) = $1 and pe.verified
) as secondaire`

/** $1 = id de la ligne, $2 = user_id, $3 = compte cree par ce clic. */
export const SQL_NOTER = `
update public.academie_invitations
   set ouvert_le = coalesce(ouvert_le, now()),
       dernier_clic_le = now(),
       clics = clics + 1,
       compte_le = coalesce(compte_le, now()),
       compte_cree = compte_cree or $3::boolean,
       user_id = $2::uuid
 where id = $1::uuid`

export type InvitationTrouvee = { id: string; email: string; prenom: string | null; version: Version; expireLe: Date | null }

export type CompteTrouve =
  | { etat: 'connexion'; userId: string; confirme: boolean }
  | { etat: 'secondaire' }
  | null

export type PortsOuverture = {
  /** La ligne du jeton_hash, ou null. Jette si la base est illisible (table absente comprise). */
  trouver(jetonHash: string): Promise<InvitationTrouvee | null>
  /** Le compte dont l'email de connexion est l'adresse, sinon 'secondaire' si un autre compte l'a verifiee. */
  compte(email: string): Promise<CompteTrouve>
  /** Cree le compte, email confirme. existe : un compte a ete cree entre-temps (on relit). */
  creerCompte(email: string, prenom: string | null): Promise<{ ok: true; userId: string } | { ok: false; existe: boolean; erreur: string }>
  /** generateLink (n'envoie aucun email). */
  genererJeton(email: string): Promise<{ ok: true; userId: string; email: string | null; tokenHash: string; type: string } | { ok: false; erreur: string }>
  /** ouvert_le (premier clic), dernier clic, clics, compte_le, compte_cree, user_id. */
  noter(id: string, f: { userId: string; compteCree: boolean }): Promise<void>
  journal(ligne: string): void
  codeErreur(err: unknown): string
  maintenant(): Date
}

export type IssueOuverture =
  | 'jeton_illisible' | 'inconnue' | 'expiree' | 'compte_secondaire' | 'creation_echec' | 'generation_echec'
  | 'autre_compte' | 'type_inconnu' | 'erreur' | 'ok' | 'ok_compte_cree'

/** /connexion?invitation=<repere> */
export function urlConnexionRepere(repere: Repere, site = URL_SITE): string {
  return `${site}/connexion?invitation=${repere}`
}

/** La page du site qui appelle verifyOtp : token_hash et type dans le FRAGMENT. */
export function urlPageInvitation(tokenHash: string, type: TypeOtp, site = URL_SITE): string {
  return `${site}${CHEMIN_PAGE_INVITATION}#token_hash=${encodeURIComponent(tokenHash)}&type=${type}`
}

const estTypeOtp = (t: string): t is TypeOtp => (TYPES_OTP as readonly string[]).includes(t)

/** 8 caracteres de l'id de la ligne : de quoi recouper deux logs. */
const refLigne = (id: string) => id.replace(/-/g, '').slice(0, 8)

/**
 * Le deroule d'un clic sur le lien : rend l'adresse de redirection et l'issue (pour le log, deja ecrit).
 * Ne jette pas : une panne rend la connexion avec le repere 'erreur'.
 */
export async function ouvrirInvitation(brut: unknown, ports: PortsOuverture, site = URL_SITE): Promise<{ url: string; issue: IssueOuverture }> {
  const fin = (issue: IssueOuverture, repere: Repere, ref = '-'): { url: string; issue: IssueOuverture } => {
    ports.journal(`issue=${issue} inv=${ref}`)
    return { url: urlConnexionRepere(repere, site), issue }
  }
  const jeton = lireJeton(brut)
  if (!jeton) return fin('jeton_illisible', 'invalide')

  let inv: InvitationTrouvee | null
  try {
    inv = await ports.trouver(hacherJeton(jeton))
  } catch (err) {
    ports.journal(`lecture impossible (${ports.codeErreur(err)})`)
    return fin('erreur', 'erreur')
  }
  if (!inv || inv.version !== 'payant') return fin('inconnue', 'invalide')
  const ref = refLigne(inv.id)
  if (!inv.expireLe || inv.expireLe.getTime() <= ports.maintenant().getTime()) return fin('expiree', 'expiree', ref)

  try {
    let compte = await ports.compte(inv.email)
    if (compte?.etat === 'secondaire') return fin('compte_secondaire', 'compte', ref)

    let compteCree = false
    if (!compte) {
      const cree = await ports.creerCompte(inv.email, inv.prenom)
      if (cree.ok) {
        compteCree = true
        compte = { etat: 'connexion', userId: cree.userId, confirme: true }
      } else if (cree.existe) {
        compte = await ports.compte(inv.email)
        if (compte?.etat === 'secondaire') return fin('compte_secondaire', 'compte', ref)
      } else {
        ports.journal(`creation du compte refusee (${cree.erreur}) inv=${ref}`)
        return fin('creation_echec', 'erreur', ref)
      }
      if (!compte) return fin('creation_echec', 'erreur', ref)
    }

    const g = await ports.genererJeton(inv.email)
    if (!g.ok) {
      ports.journal(`generateLink refuse (${g.erreur}) inv=${ref}`)
      return fin('generation_echec', 'erreur', ref)
    }
    // Un jeton ne connecte QUE l'email de sa ligne, et le compte trouve ou cree.
    if (g.userId !== compte.userId || (g.email ?? '').trim().toLowerCase() !== inv.email) return fin('autre_compte', 'erreur', ref)
    if (!estTypeOtp(g.type)) return fin('type_inconnu', 'erreur', ref)

    try {
      await ports.noter(inv.id, { userId: compte.userId, compteCree })
    } catch (err) {
      // Le suivi ne bloque pas la connexion.
      ports.journal(`suivi non note (${ports.codeErreur(err)}) inv=${ref}`)
    }
    const issue: IssueOuverture = compteCree ? 'ok_compte_cree' : 'ok'
    ports.journal(`issue=${issue} inv=${ref}`)
    return { url: urlPageInvitation(g.tokenHash, g.type, site), issue }
  } catch (err) {
    ports.journal(`panne (${ports.codeErreur(err)}) inv=${ref}`)
    return fin('erreur', 'erreur', ref)
  }
}
