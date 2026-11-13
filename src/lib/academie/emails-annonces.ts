// EMAIL A TOUS LES MEMBRES DEPUIS LE COCKPIT (13/11/2026 ; brief
// D:\7_Agents\briefs\2026-11-13-email-a-tous-cockpit.md ; migration du workspace
// 20261113210000_academie_emails_annonces.sql, ECRITE NON appliquee).
//
// Skool ferme le 16/11 et emporte son « email a tous les membres » (une fois par
// 72 h au plus). Le cockpit le remplace : espace Annonces, onglet « Emails aux
// membres ». Une annonce (souvent un billet du jour) part par email a un GROUPE
// pris en base, apres un apercu, un essai vers l'equipe et une confirmation qui
// redonne le nombre exact de destinataires.
//
// LA PARTIE PURE, sans base ni reseau. CE FICHIER N'IMPORTE QUE node:crypto, expres
// (comme invitations-pur.ts) : scripts/verifier-emails-annonces.mjs et
// scripts/essayer-email-annonce.mjs l'importent tel quel sous Node 22.
// La base et Resend : emails-annonces-serveur.ts.
//
// LES GROUPES (ce qui existe vraiment en base le 13/11) :
// - comptes : chaque compte confirme, par son email de connexion. Son statut vient de
//   aok_annuaire_acces (la regle de l'annuaire, du classement et du salon) :
//   equipe, live_club, club_10, eleve = « programme » ; communaute = « gratuit » ;
// - adresses SANS compte : un acces actif de l'academie pose par email (pack Premium ou
//   VIP de Skool, module, statut) = « programme_sans_compte » ; une invitation de Skool
//   envoyee sans erreur = « invite_sans_compte ». Une adresse deja connue d'un compte
//   (email de connexion ou adresse verifiee) n'y entre pas : le compte la porte deja ;
// - une adresse = un email, meme si elle releve de plusieurs raisons (la plus forte gagne).
// GROUPES : tous, comptes, programmes, gratuits (comptes gratuits), sans_compte.
//
// SECURITE (grille bots-securite-par-conception) : le texte est ecrit par l'equipe,
// mais il est traite comme une DONNEE. Tout le HTML est echappe ; aucun lien du texte
// n'est cliquable (les adresses sont desamorcees : « https[:]//... », « www[.]... »,
// « exemple[.]com ») ; le Markdown leger des billets (## intertitre, **gras**,
// [texte](lien), - liste) est rendu par NOS balises autour du texte echappe. Les deux
// seuls liens de l'email sont ceux du serveur : le bouton vers l'academie (adresse
// verifiee : https://aoknowledge.com/...) et la desinscription (jeton signe).
//
// SIMULATION : tant que la variable ANNONCES_EMAIL_MODE du journal ne vaut pas
// exactement « reel », rien ne part. Les essais et les envois passent par le meme
// chemin, les lignes sont notees « simule » et l'email est ecrit dans les journaux
// du serveur (texte seul, lien de desinscription remplace, aucune adresse).
//
// LA VOIE D'ENVOI (13/11/2026, Brice : « Ok B ») : l'envoi aux membres est un BROADCAST
// de Resend (gratuit, hors quota transactionnel) vers le segment « tous » ou « comptes »,
// limite au sujet « Annonces de l'academie » ; la desinscription est tenue par Resend
// ({{{RESEND_UNSUBSCRIBE_URL}}}). Les essais restent des emails transactionnels (lien de
// desinscription signe de notre route). Contacts, segments, sujet et sens des
// desinscriptions : emails-broadcast.ts. Seuls « tous » et « comptes » s'envoient
// (GROUPES_ENVOI) : le plan gratuit n'a que 3 segments.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export const GROUPES = ['tous', 'comptes', 'programmes', 'gratuits', 'sans_compte'] as const
export type Groupe = (typeof GROUPES)[number]

/** Les groupes qu'on peut ENVOYER : un segment Resend chacun (plan gratuit : 3 segments). Les autres restent des compteurs. */
export const GROUPES_ENVOI = ['tous', 'comptes'] as const satisfies readonly Groupe[]
export type GroupeEnvoi = (typeof GROUPES_ENVOI)[number]

export const LIBELLE_GROUPE: Record<Groupe, string> = {
  tous: 'Tous les membres (comptes et adresses sans compte)',
  comptes: 'Tous les comptes de l\'académie',
  programmes: 'Membres des programmes (Live Club, 10% Club, élèves), avec ou sans compte',
  gratuits: 'Comptes gratuits',
  sans_compte: 'Adresses sans compte (invités de Skool, accès posés par email)',
}

export const RAISONS = ['equipe', 'programme', 'gratuit', 'programme_sans_compte', 'invite_sans_compte', 'essai'] as const
export type Raison = (typeof RAISONS)[number]

/** Garde : un envoi reel au plus par DELAI_GARDE_H heures (Skool : 72 h), sauf forcage de Brice. */
export const DELAI_GARDE_H = 72
/** Resend, API batch (les ESSAIS seulement depuis le 13/11) : 100 emails au plus par appel. */
export const TAILLE_LOT = 100
export const LIMITES = { objet: 200, texte: 20_000 } as const

export const EXPEDITEUR_DEFAUT = 'AO Knowledge <support@aoknowledge.com>'
export const REPONSE_A = 'support@aoknowledge.com'
export const URL_ACADEMIE = 'https://aoknowledge.com/academie'
export const PREFIXE_LIEN_AUTORISE = 'https://aoknowledge.com/'
export const ROUTE_DESINSCRIPTION_DEFAUT = 'https://journal.aoknowledge.com/api/academie/emails/desinscription'
export const SOURCE_ANNONCE = 'email-academie:'
export const CANAL_ANNONCE = 'email'

/** simulation : rien ne part. resend : email transactionnel (les essais). broadcast : Broadcast Resend (l'envoi aux membres). */
export type Transport = 'simulation' | 'resend' | 'broadcast'
export type ModeEnvoi = 'essai' | 'reel'

/** Le mode du serveur : « resend » SEULEMENT si la variable vaut exactement « reel ». Tout le reste = simulation. */
export function transportDepuis(valeur: string | undefined | null): 'simulation' | 'resend' {
  return typeof valeur === 'string' && valeur.trim() === 'reel' ? 'resend' : 'simulation'
}

/** Le transport d'un envoi : l'essai en email transactionnel, l'envoi aux membres en Broadcast. Simulation reste simulation. */
export function transportEnvoi(mode: ModeEnvoi, serveur: 'simulation' | 'resend'): Transport {
  if (serveur === 'simulation') return 'simulation'
  return mode === 'essai' ? 'resend' : 'broadcast'
}

/** Les transports que la garde de 72 h regarde : les envois reels (Broadcast, et l'ancien batch), ou ceux de la simulation. */
export function transportsGarde(serveur: 'simulation' | 'resend'): string[] {
  return serveur === 'simulation' ? ['simulation'] : ['resend', 'broadcast']
}

// ---------------------------------------------------------------------------
// La saisie du cockpit
// ---------------------------------------------------------------------------

export type SaisieEmail = {
  objet: string
  texte: string
  groupe: GroupeEnvoi
  billetId: string | null
}

export function estGroupeEnvoi(v: unknown): v is GroupeEnvoi {
  return typeof v === 'string' && (GROUPES_ENVOI as readonly string[]).includes(v)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Retire les caracteres de controle (sauf retour a la ligne et tabulation) et normalise les fins de ligne. */
export function nettoyerTexte(v: string): string {
  return v.replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '')
}

export function estGroupe(v: unknown): v is Groupe {
  return typeof v === 'string' && (GROUPES as readonly string[]).includes(v)
}

/** Le corps d'une action (apercu, essai, envoyer), ou { erreur } en clair. Le groupe n'est exige que si `avecGroupe`. */
export function lireSaisieEmail(corps: unknown, avecGroupe: boolean): SaisieEmail | { erreur: string } {
  const c = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>
  const objet = typeof c.objet === 'string' ? nettoyerTexte(c.objet).replace(/\s+/g, ' ').trim() : ''
  const texte = typeof c.texte === 'string' ? nettoyerTexte(c.texte).trim() : ''
  if (!objet) return { erreur: 'L\'objet est obligatoire.' }
  if (objet.length > LIMITES.objet) return { erreur: `L'objet tient en ${LIMITES.objet} caractères au plus.` }
  if (!texte) return { erreur: 'Le texte est obligatoire.' }
  if (texte.length > LIMITES.texte) return { erreur: `Le texte tient en ${LIMITES.texte} caractères au plus.` }
  let groupe: GroupeEnvoi = 'tous'
  if (avecGroupe) {
    if (!estGroupeEnvoi(c.groupe)) return { erreur: 'Choisis le groupe des destinataires : tous les membres, ou les comptes.' }
    groupe = c.groupe
  }
  let billetId: string | null = null
  if (c.billet_id !== undefined && c.billet_id !== null && c.billet_id !== '') {
    if (typeof c.billet_id !== 'string' || !UUID.test(c.billet_id)) return { erreur: 'Billet inconnu.' }
    billetId = c.billet_id.toLowerCase()
  }
  return { objet, texte, groupe, billetId }
}

/** Le lien du bouton : une adresse de aoknowledge.com seulement, sinon l'accueil de l'academie. */
export function lienBouton(v: string | null | undefined): string {
  return typeof v === 'string' && v.startsWith(PREFIXE_LIEN_AUTORISE) && !/[\s"'<>]/.test(v) ? v : URL_ACADEMIE
}

// ---------------------------------------------------------------------------
// Le rendu : texte de l'equipe -> email (HTML echappe, liens desamorces)
// ---------------------------------------------------------------------------

export function echapper(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const TLD = '(?:com|fr|net|org|io|co|me|app|dev|ly|gg|tv|be|ch|ca|eu|info|xyz|link|site|club|shop|live|pro|biz|us|uk|de|es|it|ai|to|so|sh|tech|online|store)'
const RE_DOMAINE = new RegExp(`\\b([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9-]+)*)\\.(${TLD})\\b`, 'gi')

/**
 * Aucune adresse du texte ne doit devenir un lien, meme par l'auto-lien des
 * messageries : « https://x.fr » -> « https[:]//x[.]fr », « www.x.fr » ->
 * « www[.]x[.]fr », « exemple.com » -> « exemple[.]com ». Lisible, jamais cliquable.
 * Les adresses email gardent leur @ mais perdent le point du domaine.
 */
export function desamorcerLiens(t: string): string {
  return t
    .replace(/\b([a-z][a-z0-9+.-]{1,15}):\/\//gi, '$1[:]//')
    .replace(/\bwww\./gi, 'www[.]')
    .replace(RE_DOMAINE, '$1[.]$2')
}

/**
 * Les variables de Resend ({{{RESEND_UNSUBSCRIBE_URL}}}, {{{contact.email}}}...) ne doivent
 * venir que de NOTRE gabarit : dans le texte de l'equipe, deux accolades qui se suivent sont
 * separees par une espace (« {{ » -> « { { »). Lisible, jamais remplace par Resend.
 */
export function neutraliserVariables(t: string): string {
  return t.replace(/\{(?=\{)/g, '{ ').replace(/\}(?=\})/g, '} ')
}

/** [texte](adresse) -> « texte (adresse) » : le texte reste, l'adresse sera desamorcee ensuite. */
function aplatirLiensMarkdown(t: string): string {
  return t.replace(/\[([^\]\n]{1,300})\]\(([^)\s]{1,500})\)/g, (_m, txt: string, url: string) => `${txt} (${url})`)
}

/** Une ligne du texte, en HTML sur : liens aplatis puis desamorces, echappee, **gras** rendu par nos balises. */
function ligneHtml(ligne: string): string {
  const sure = echapper(desamorcerLiens(aplatirLiensMarkdown(ligne)))
  return sure.replace(/\*\*([^*\n]{1,300})\*\*/g, '<strong>$1</strong>')
}

/** Une ligne du texte en version texte brut : memes regles, marques Markdown retirees. */
function ligneTexte(ligne: string): string {
  return desamorcerLiens(aplatirLiensMarkdown(ligne)).replace(/\*\*([^*\n]{1,300})\*\*/g, '$1')
}

type Bloc = { genre: 'titre' | 'paragraphe' | 'liste'; lignes: string[] }

/** Le texte en blocs : intertitres (#), listes (- ou *), paragraphes (lignes vides entre eux). */
export function blocs(texte: string): Bloc[] {
  const sortie: Bloc[] = []
  let courant: Bloc | null = null
  for (const brute of nettoyerTexte(texte).split('\n')) {
    const ligne = brute.trimEnd()
    if (!ligne.trim()) { courant = null; continue }
    const titre = /^\s{0,3}#{1,6}\s+(.*)$/.exec(ligne)
    if (titre) { sortie.push({ genre: 'titre', lignes: [titre[1].trim()] }); courant = null; continue }
    const puce = /^\s{0,3}[-*]\s+(.*)$/.exec(ligne)
    if (puce) {
      if (!courant || courant.genre !== 'liste') { courant = { genre: 'liste', lignes: [] }; sortie.push(courant) }
      courant.lignes.push(puce[1])
      continue
    }
    const citation = /^\s{0,3}>\s?(.*)$/.exec(ligne)
    const contenu = citation ? citation[1] : ligne
    if (!courant || courant.genre !== 'paragraphe') { courant = { genre: 'paragraphe', lignes: [] }; sortie.push(courant) }
    courant.lignes.push(contenu)
  }
  return sortie
}

const STYLE_P = 'margin:0 0 16px'

/** Le corps HTML du texte de l'equipe (sans enveloppe). */
export function corpsHtml(texte: string): string {
  return blocs(texte).map((b) => {
    if (b.genre === 'titre') return `<p style="${STYLE_P};font-size:17px;font-weight:bold;color:#111827">${ligneHtml(b.lignes[0])}</p>`
    if (b.genre === 'liste') {
      return `<ul style="margin:0 0 16px;padding-left:22px">${b.lignes.map((l) => `<li style="margin:0 0 6px">${ligneHtml(l)}</li>`).join('')}</ul>`
    }
    return `<p style="${STYLE_P}">${b.lignes.map(ligneHtml).join('<br>')}</p>`
  }).join('\n')
}

/** Le corps en texte brut (partie text/plain de l'email). */
export function corpsTexte(texte: string): string {
  return blocs(texte).map((b) => {
    if (b.genre === 'titre') return ligneTexte(b.lignes[0]).toUpperCase()
    if (b.genre === 'liste') return b.lignes.map((l) => `- ${ligneTexte(l)}`).join('\n')
    return b.lignes.map(ligneTexte).join('\n')
  }).join('\n\n')
}

export type EmailPret = { sujet: string; html: string; texte: string }

/**
 * L'email complet. `lienDesinscription` est le lien personnel du destinataire (essai),
 * la variable {{{RESEND_UNSUBSCRIBE_URL}}} (Broadcast), ou null dans l'apercu (un lien
 * factice s'affiche). `essai` ajoute « [Essai] » et un bandeau. Les variables de Resend
 * ecrites dans l'objet ou le texte sont neutralisees (neutraliserVariables).
 */
export function construireEmail(o: {
  objet: string; texte: string; lien: string | null; lienDesinscription: string | null; essai: boolean
}): EmailPret {
  const objet = neutraliserVariables(o.objet.replace(/\s+/g, ' ').trim())
  const texteSur = neutraliserVariables(o.texte)
  const sujet = o.essai ? `[Essai] ${objet}` : objet
  const bouton = lienBouton(o.lien)
  const desinscription = o.lienDesinscription ?? '#desinscription'
  const bandeau = o.essai
    ? '<p style="margin:0 0 20px;padding:10px 12px;border:1px solid #f59e0b;background:#fffbeb;border-radius:6px;font-size:13px;color:#92400e">Email d\'essai : il n\'est parti qu\'à l\'équipe. Le lien de désinscription ne change rien.</p>'
    : ''
  const html = [
    '<!doctype html>',
    '<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${echapper(desamorcerLiens(sujet))}</title></head>`,
    '<body style="margin:0;padding:0;background:#f4f4f5">',
    '<div style="max-width:600px;margin:0 auto;padding:24px 16px">',
    '<div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;padding:28px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1f2937">',
    bandeau,
    '<p style="margin:0 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280">Annonce de l\'académie AO Knowledge</p>',
    `<h1 style="margin:0 0 20px;font-size:21px;line-height:1.3;color:#111827">${echapper(desamorcerLiens(objet))}</h1>`,
    corpsHtml(texteSur),
    `<p style="margin:24px 0 8px"><a href="${echapper(bouton)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:6px;font-weight:bold">Ouvrir l'académie</a></p>`,
    '</div>',
    '<p style="margin:16px 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6b7280">',
    'Tu reçois cet email parce que tu es membre de l\'académie AO Knowledge. ',
    `<a href="${echapper(desinscription)}" style="color:#6b7280">Ne plus recevoir les annonces par email</a>. `,
    `Une question : réponds à cet email ou écris à ${REPONSE_A}.`,
    '</p>',
    '</div></body></html>',
  ].join('\n')
  const texte = [
    o.essai ? 'EMAIL D\'ESSAI : il n\'est parti qu\'à l\'équipe.\n' : '',
    'Annonce de l\'académie AO Knowledge',
    '',
    desamorcerLiens(objet),
    '',
    corpsTexte(texteSur),
    '',
    `Ouvrir l'académie : ${bouton}`,
    '',
    '--',
    'Tu reçois cet email parce que tu es membre de l\'académie AO Knowledge.',
    `Ne plus recevoir les annonces par email : ${desinscription}`,
  ].join('\n').replace(/^\n+/, '')
  return { sujet, html, texte }
}

/** Les en-tetes de desinscription en un clic (RFC 8058) : Gmail et Yahoo les demandent aux envois en nombre. */
export function entetesDesinscription(lien: string): Record<string, string> {
  return { 'List-Unsubscribe': `<${lien}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
}

// ---------------------------------------------------------------------------
// Le jeton de desinscription : id de la ligne du destinataire + signature
// ---------------------------------------------------------------------------

const USAGE_SECRET = 'academie-emails-desinscription:v1'

/** Le secret des jetons, derive d'un secret du serveur (SUPABASE_SERVICE_ROLE_KEY) : aucune variable de plus. */
export function deriverSecret(secretServeur: string): Buffer {
  if (!secretServeur || secretServeur.length < 32) throw new Error('secret trop court')
  return createHmac('sha256', secretServeur).update(USAGE_SECRET, 'utf8').digest()
}

function signature(secret: Buffer, id: string): string {
  return createHmac('sha256', secret).update(id.toLowerCase(), 'utf8').digest('base64url').slice(0, 32)
}

/** « <id de la ligne>.<signature> » : opaque, aucune adresse dans le lien. */
export function jetonDesinscription(secret: Buffer, destinataireId: string): string {
  if (!UUID.test(destinataireId)) throw new Error('id de destinataire invalide')
  return `${destinataireId.toLowerCase()}.${signature(secret, destinataireId)}`
}

/** L'id de la ligne si le jeton est bien signe, sinon null (comparaison a temps constant). */
export function lireJetonDesinscription(secret: Buffer, jeton: unknown): string | null {
  if (typeof jeton !== 'string' || jeton.length > 120) return null
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32})$/.exec(jeton.trim())
  if (!m || !UUID.test(m[1])) return null
  const attendue = Buffer.from(signature(secret, m[1]), 'utf8')
  const recue = Buffer.from(m[2], 'utf8')
  return attendue.length === recue.length && timingSafeEqual(attendue, recue) ? m[1].toLowerCase() : null
}

export function lienDesinscription(base: string, jeton: string): string {
  return `${base.replace(/\/$/, '')}?j=${encodeURIComponent(jeton)}`
}

/** La base de la route : https seulement, sinon celle par defaut. */
export function baseDesinscription(v: string | undefined | null): string {
  return typeof v === 'string' && /^https:\/\/[a-z0-9.-]+(\/[A-Za-z0-9/_-]*)?$/.test(v.trim()) ? v.trim().replace(/\/$/, '') : ROUTE_DESINSCRIPTION_DEFAUT
}

// ---------------------------------------------------------------------------
// Les regles : garde de 72 h, droits, confirmation
// ---------------------------------------------------------------------------

export type EtatGarde = { bloque: boolean; dernier_reel: string | null; libre_le: string | null }

/** La garde : bloque si le dernier envoi reel a moins de DELAI_GARDE_H heures. */
export function etatGarde(dernierReel: Date | null, maintenant: Date, delaiH = DELAI_GARDE_H): EtatGarde {
  if (!dernierReel || !Number.isFinite(dernierReel.getTime())) return { bloque: false, dernier_reel: null, libre_le: null }
  const libre = new Date(dernierReel.getTime() + delaiH * 3600 * 1000)
  return { bloque: libre.getTime() > maintenant.getTime(), dernier_reel: dernierReel.toISOString(), libre_le: libre.toISOString() }
}

export type DroitsAppelant = { label: string | null; acces_perso: boolean; role: string | null }
export type Droits = { envoyer_reel: boolean; forcer: boolean }

/**
 * Qui fait quoi. Apercu et essai : toute l'allowlist du cockpit. Envoi reel : un
 * compte admin du site (Brice, Melanie, Adil le 13/11), jamais le compte de Tab
 * (role member). Forcer la garde de 72 h : Brice seul, c'est-a-dire admin ET acces
 * a l'espace Perso (Tab a l'espace Perso mais n'est pas admin).
 */
export function droitsDe(d: DroitsAppelant | null): Droits {
  if (!d) return { envoyer_reel: false, forcer: false }
  const admin = d.role === 'admin'
  return { envoyer_reel: admin, forcer: admin && d.acces_perso === true }
}

export type Destinataire = { email: string; user_id: string | null; raison: Raison; desinscrit: boolean }

/** Les compteurs de chaque groupe a partir des lignes du groupe « tous ». */
export function compterGroupes(lignes: Destinataire[]): Record<Groupe, { total: number; desinscrits: number; a_envoyer: number }> {
  const sortie = Object.fromEntries(GROUPES.map((g) => [g, { total: 0, desinscrits: 0, a_envoyer: 0 }])) as Record<Groupe, { total: number; desinscrits: number; a_envoyer: number }>
  for (const l of lignes) {
    for (const g of GROUPES) {
      if (!dansGroupe(l, g)) continue
      sortie[g].total++
      if (l.desinscrit) sortie[g].desinscrits++
      else sortie[g].a_envoyer++
    }
  }
  return sortie
}

/** La meme regle que SQL_DESTINATAIRES, pour les compteurs et le verificateur. */
export function dansGroupe(l: Pick<Destinataire, 'user_id' | 'raison'>, g: Groupe): boolean {
  switch (g) {
    case 'tous': return true
    case 'comptes': return l.user_id !== null
    case 'programmes': return l.raison === 'equipe' || l.raison === 'programme' || l.raison === 'programme_sans_compte'
    case 'gratuits': return l.raison === 'gratuit'
    case 'sans_compte': return l.user_id === null
  }
}

/** Decoupe en lots de `n`. */
export function lots<T>(liste: readonly T[], n = TAILLE_LOT): T[][] {
  const sortie: T[][] = []
  for (let i = 0; i < liste.length; i += n) sortie.push(liste.slice(i, i + n))
  return sortie
}

/** Cle d'idempotence d'un lot : les memes lignes donnent la meme cle (Resend la garde 24 h). */
export function cleLot(envoiId: string, ids: readonly string[]): string {
  const h = createHash('sha256').update([...ids].sort().join(','), 'utf8').digest('hex').slice(0, 24)
  return `annonce-${envoiId.slice(0, 8)}-${h}`
}

/** Un message d'erreur sans adresse email, 300 caracteres au plus. */
export function masquerEmails(v: unknown): string {
  return String(v instanceof Error ? v.message : v)
    .replace(/[^\s@;,()<>"']+@[^\s@;,()<>"']+/g, '[email]')
    .replace(/\s+/g, ' ')
    .slice(0, 300)
}

/** Le statut final d'un envoi d'apres ses lignes. */
export function statutFinal(c: { a_envoyer: number; envoyes: number; echecs: number }): 'en_cours' | 'fini' | 'partiel' | 'echec' {
  if (c.a_envoyer > 0) return 'en_cours'
  if (c.echecs === 0) return 'fini'
  return c.envoyes > 0 ? 'partiel' : 'echec'
}

// ---------------------------------------------------------------------------
// L'envoyeur : l'interface, et la SIMULATION (le transport Resend vit dans emails-annonces-serveur.ts)
// ---------------------------------------------------------------------------

export type EmailDuLot = { id: string; email: string; pret: EmailPret; lien: string }
export type ResultatEmail = { id: string; statut: 'envoye' | 'simule' | 'echec'; resend_id: string | null; erreur: string | null }
export type Envoyeur = (lot: EmailDuLot[], cle: string, envoiCourt: string) => Promise<ResultatEmail[]>

/**
 * SIMULATION : rien ne part. Le premier email de chaque lot est ecrit dans le
 * journal du serveur (sujet et texte, lien personnel remplace) ; aucune adresse.
 */
export function envoyeurSimulation(ecrire: (ligne: string) => void = (l) => console.info(l)): Envoyeur {
  return async (lot, _cle, envoiCourt) => {
    const premier = lot[0]
    if (premier) {
      const texte = premier.pret.texte.split(premier.lien).join('[lien personnel de desinscription]')
      ecrire(`[emails-annonces] SIMULATION envoi=${envoiCourt} : ${lot.length} email(s), rien ne part. Sujet : ${premier.pret.sujet}\n${texte}`)
    }
    return lot.map((e) => ({ id: e.id, statut: 'simule' as const, resend_id: null, erreur: null }))
  }
}

// ---------------------------------------------------------------------------
// Les requetes (ici pour que l'essai de la migration joue EXACTEMENT les memes)
// ---------------------------------------------------------------------------

/**
 * Les destinataires d'un groupe ($1), une ligne par adresse (minuscules),
 * avec `desinscrit`. Comptes : email de connexion confirme, compte ni supprime
 * ni anonyme ni banni. Adresses sans compte : acces actif pose par email
 * (module, pack, statut), puis invitation de Skool envoyee sans erreur ; une
 * adresse deja connue d'un compte (connexion ou adresse verifiee) n'y entre pas.
 */
export const SQL_DESTINATAIRES = `
with comptes as (
  select u.id as user_id, lower(btrim(u.email)) as email,
         coalesce(public.aok_annuaire_acces(u.id) ->> 'statut', 'communaute') as statut,
         public.aok_emails_verifies(u.id) as verifiees
    from auth.users u
   where u.email is not null and u.email_confirmed_at is not null and u.deleted_at is null
     and coalesce(u.is_anonymous, false) = false
     and (u.banned_until is null or u.banned_until < now())
), connues as (
  select email from comptes
  union
  select lower(btrim(e)) from comptes, unnest(comptes.verifiees) as e
), sans_compte as (
  select lower(btrim(a.email)) as email, 'programme_sans_compte' as raison
    from public.academie_acces a
    join public.academie_offres o on o.id = a.offre_id
   where a.email is not null and a.retire_le is null and a.debut <= now() and (a.fin is null or a.fin > now())
     and o.type in ('module', 'pack', 'statut')
  union
  select lower(btrim(i.email)), 'invite_sans_compte'
    from public.academie_invitations i
   where i.envoye_le is not null and i.erreur is null
), candidats as (
  select c.email, c.user_id,
         case c.statut when 'communaute' then 'gratuit' when 'equipe' then 'equipe' else 'programme' end as raison
    from comptes c
  union all
  select s.email, null::uuid, s.raison from sans_compte s where s.email not in (select email from connues)
), uniques as (
  select distinct on (email) email, user_id, raison
    from candidats
   order by email, case raison when 'equipe' then 0 when 'programme' then 1 when 'gratuit' then 2
                             when 'programme_sans_compte' then 3 else 4 end
)
select u.email, u.user_id::text as user_id, u.raison,
       exists (select 1 from public.academie_emails_desinscriptions d
                where d.email = u.email and d.reinscrit_le is null) as desinscrit
  from uniques u
 where u.email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
   and case $1::text
         when 'tous' then true
         when 'comptes' then u.user_id is not null
         when 'programmes' then u.raison in ('equipe', 'programme', 'programme_sans_compte')
         when 'gratuits' then u.raison = 'gratuit'
         when 'sans_compte' then u.user_id is null
         else false
       end
 order by u.email`

/** Les droits de l'appelant ($1 = user_id). */
export const SQL_DROITS = `
select a.label, coalesce(a.acces_perso, false) as acces_perso, p.role::text as role
  from public.cockpit_allowlist a
  left join public.profiles p on p.id = a.user_id
 where a.user_id = $1::uuid`

/** Les adresses de l'essai. $1 = user_id de l'appelant, $2 = 'moi' ou 'equipe' (admins de l'allowlist). */
export const SQL_ADRESSES_ESSAI = `
select distinct lower(btrim(coalesce(u.email, a.email))) as email, a.user_id::text as user_id
  from public.cockpit_allowlist a
  left join public.profiles p on p.id = a.user_id
  left join auth.users u on u.id = a.user_id
 where coalesce(u.email, a.email) is not null
   and (case when $2::text = 'equipe' then p.role::text = 'admin' or a.user_id = $1::uuid else a.user_id = $1::uuid end)
 order by 1`

/** Le dernier envoi reel qui compte pour la garde ($1 = transports, transportsGarde) : parti en tout ou partie, ou en cours. */
export const SQL_DERNIER_REEL = `
select max(cree_le) as dernier
  from public.academie_emails_envois
 where mode = 'reel' and transport = any($1::text[]) and (envoyes > 0 or statut = 'en_cours')`

/** Un seul envoi reel a la fois (verrou de transaction). */
export const SQL_VERROU_REEL = `select pg_advisory_xact_lock(hashtext('academie_emails_envoi_reel'))`

/** Le billet ($1) : lien de sa lecon et etat de publication. */
export const SQL_BILLET = `
select b.id::text as id, m.slug as module_slug, l.slug as lecon_slug, l.titre,
       b.publication_faite_le, b.retire_le
  from public.academie_billets b
  join public.academie_lecons l on l.id = b.lecon_id
  join public.academie_modules m on m.id = l.module_id
 where b.id = $1::uuid`

export const SQL_CREER_ENVOI = `
insert into public.academie_emails_envois
  (mode, transport, groupe, objet, texte, lien, billet_id, destinataires, exclus_desinscrits, force_72h, cree_par)
values ($1, $2, $3, $4, $5, $6, $7::uuid, $8, $9, $10, $11::uuid)
returning id::text as id`

/** Les lignes de destinataires, en une fois. $1 envoi, $2 emails, $3 user_id ('' = aucun), $4 raisons. */
export const SQL_INSERER_DESTINATAIRES = `
insert into public.academie_emails_destinataires (envoi_id, email, user_id, raison)
select $1::uuid, t.email, nullif(t.uid, '')::uuid, t.raison
  from unnest($2::text[], $3::text[], $4::text[]) as t(email, uid, raison)
on conflict (envoi_id, email) do nothing`

/** Les lignes encore a envoyer d'un envoi ($1), par lot ($2). */
export const SQL_A_ENVOYER = `
select id::text as id, email
  from public.academie_emails_destinataires
 where envoi_id = $1::uuid and statut = 'a_envoyer'
 order by email
 limit $2`

/** Le resultat d'un lot. $1 ids, $2 statuts, $3 ids Resend ('' = aucun), $4 erreurs ('' = aucune). */
export const SQL_NOTER_LOT = `
update public.academie_emails_destinataires d
   set statut = t.statut, resend_id = nullif(t.rid, ''), erreur = nullif(left(t.err, 300), ''), traite_le = now()
  from unnest($1::uuid[], $2::text[], $3::text[], $4::text[]) as t(id, statut, rid, err)
 where d.id = t.id and d.statut = 'a_envoyer'`

/** Recompte un envoi ($1) d'apres ses lignes. */
export const SQL_COMPTES_ENVOI = `
select count(*) filter (where statut = 'a_envoyer')::int as a_envoyer,
       count(*) filter (where statut in ('envoye', 'simule', 'confie'))::int as envoyes,
       count(*) filter (where statut = 'echec')::int as echecs
  from public.academie_emails_destinataires
 where envoi_id = $1::uuid`

/** $1 envoi, $2 envoyes, $3 echecs, $4 statut, $5 erreur. fini_le pose quand l'envoi n'est plus en cours. */
export const SQL_FINIR_ENVOI = `
update public.academie_emails_envois
   set envoyes = $2, echecs = $3, statut = $4, erreur = $5,
       fini_le = case when $4 = 'en_cours' then null else now() end
 where id = $1::uuid`

/** L'envoi reel inscrit dans « Annonces envoyees » (une seule fois). $1 envoi, $2 cible. */
export const SQL_INSCRIRE_ANNONCE = `
with e as (
  select id, objet, texte, lien, cree_par, cree_le from public.academie_emails_envois
   where id = $1::uuid and annonce_id is null and mode = 'reel'
), a as (
  insert into public.cockpit_annonces_envoyees (canal, titre, contenu, envoye_le, cible, lien, source, pose_par)
  select 'email', left(e.objet, 200), left(e.texte, 20000), e.cree_le, left($2, 200), e.lien,
         'email-academie:' || e.id::text, e.cree_par
    from e
  returning id
)
update public.academie_emails_envois set annonce_id = (select id from a)
 where id = $1::uuid and exists (select 1 from a)`

/** L'historique du cockpit : les 50 derniers envois, avec le nom de l'auteur (allowlist). */
export const SQL_HISTORIQUE = `
select e.id::text as id, e.mode, e.transport, e.groupe, e.objet, e.lien, e.billet_id::text as billet_id,
       e.destinataires, e.envoyes, e.echecs, e.exclus_desinscrits, e.force_72h, e.statut, e.erreur,
       e.resend_broadcast_id, e.cree_le, e.fini_le, a.label as par
  from public.academie_emails_envois e
  left join public.cockpit_allowlist a on a.user_id = e.cree_par
 order by e.cree_le desc
 limit 50`

/** Le detail d'un envoi ($1) : ses echecs et ses compteurs par raison. */
export const SQL_DETAIL_ECHECS = `
select email, raison, coalesce(erreur, '') as erreur
  from public.academie_emails_destinataires
 where envoi_id = $1::uuid and statut = 'echec'
 order by email
 limit 500`

export const SQL_DETAIL_RAISONS = `
select raison, count(*)::int as n
  from public.academie_emails_destinataires
 where envoi_id = $1::uuid
 group by raison
 order by raison`

export const SQL_NB_DESINSCRITS = `
select count(*)::int as n from public.academie_emails_desinscriptions where reinscrit_le is null`

/** La ligne d'un destinataire ($1) et le mode de son envoi, pour la page de desinscription. */
export const SQL_DESTINATAIRE = `
select d.id::text as id, d.email, e.mode
  from public.academie_emails_destinataires d
  join public.academie_emails_envois e on e.id = d.envoi_id
 where d.id = $1::uuid`

/** Desinscrire ($1 email, $2 source, $3 id de la ligne). Rejouable : une reinscription passee est effacee. */
export const SQL_DESINSCRIRE = `
insert into public.academie_emails_desinscriptions (email, source, destinataire_id)
values ($1, $2, $3::uuid)
on conflict (email) do update
   set desinscrit_le = case when public.academie_emails_desinscriptions.reinscrit_le is null
                            then public.academie_emails_desinscriptions.desinscrit_le else now() end,
       reinscrit_le = null,
       source = case when public.academie_emails_desinscriptions.reinscrit_le is null
                     then public.academie_emails_desinscriptions.source else excluded.source end,
       destinataire_id = coalesce(excluded.destinataire_id, public.academie_emails_desinscriptions.destinataire_id)`
