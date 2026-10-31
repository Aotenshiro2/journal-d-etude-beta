// (31/10) LES EMAILS DU LIVE CLUB QUI N'ARRIVENT PAS : refus de la boite du
// destinataire (rebond), marque comme spam (plainte), bloque par Resend
// (adresse dans ses « Suppressions »). Webhook Resend, route
// src/app/api/liveclub/resend/route.ts ; serveur : rebonds.ts.
//
// Cas reel du 31/10 : l'invitation d'acces broker de Fabien (@libertysurf.fr)
// acceptee par Resend (email_envoye vrai, le bot a dit « email parti »), puis
// refusee a la meme minute par le serveur du destinataire : « Bounced »,
// Transient / ContentRejected, « 550 spam detected ». Resend a mis l'adresse
// dans ses Suppressions. Personne ne l'a su avant que le membre se plaigne.
//
// Ce module est PUR (node:crypto seulement, aucune base, aucun reseau,
// aucun autre import) : scripts/verifier-rebonds-email.mjs le charge tel quel.
// - la signature Svix des webhooks Resend (HMAC SHA-256, sans dependance) ;
// - la decision de la route (secret, signature, evenement traite ou ignore) ;
// - la lecture de l'evenement et la NATURE du refus (type et sous-type) ;
// - le deroule du traitement (traiterRebond), avec ses outils en parametre :
//   le serveur (rebonds.ts) les branche sur la base, Telegram et Agent AOK,
//   le verificateur sur une fausse base en memoire ;
// - les textes : alerte a Brice et Melanie, message prive au membre, journal
//   et resume du matin.
//
// Regles (Brice et la session principale, 31/10) :
// - une alerte par adresse et par jour au plus, une fois par svix-id ;
// - un message prive au membre seulement si un compte Telegram est relie a
//   l'adresse, une fois par adresse, et pas si l'equipe a la main dans son fil ;
// - une invitation d'acces broker repasse « pas envoyee » (invite_envoyee_le a
//   null) seulement pour un refus DEFINITIF (Permanent : adresse inexistante)
//   et si son jeton n'a pas servi. Un refus de CONTENU (Transient /
//   ContentRejected, le cas du 31/10) n'est pas une adresse morte : le meme
//   email renvoye serait refuse pareil, rien n'est remis a renvoyer, l'alerte
//   propose le lien personnel ou une autre adresse ;
// - jamais l'adresse dans un log ; dans le journal, son empreinte (sha256) et
//   les identifiants (acces, client Stripe, compte Telegram), pas l'adresse.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

// ---------------------------------------------------------------------------
// La signature Svix (Resend signe ses webhooks avec Svix)
// ---------------------------------------------------------------------------

/** Ecart tolere entre svix-timestamp et l'horloge du serveur (rejeu d'une vieille requete). */
export const TOLERANCE_SVIX_S = 5 * 60

/** Les trois en-tetes d'un webhook Svix, tels que recus (null = absent). */
export type EntetesSvix = { id: string | null; horodatage: string | null; signature: string | null }

const ID_SVIX = /^[A-Za-z0-9_-]{1,128}$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** La cle HMAC d'un secret « whsec_<base64> » (le prefixe est facultatif, comme chez Svix). null = illisible. */
function cleSvix(secret: string): Buffer | null {
  const s = secret.trim()
  const brut = s.startsWith('whsec_') ? s.slice('whsec_'.length) : s
  if (!BASE64.test(brut)) return null
  const cle = Buffer.from(brut, 'base64')
  return cle.length >= 16 ? cle : null
}

/**
 * La signature d'un webhook Svix (doc Svix, « verifying payloads manually ») :
 * HMAC SHA-256 de « <svix-id>.<svix-timestamp>.<corps brut> » avec la cle
 * (secret sans « whsec_ », decode du base64), en base64. svix-signature porte
 * une ou plusieurs signatures « v1,<base64> » separees par des espaces (une
 * rotation de secret en donne deux) : une seule qui correspond suffit.
 * Comparaison a temps constant ; horodatage a TOLERANCE_SVIX_S pres.
 */
export function verifierSignatureSvix(
  corps: string, e: EntetesSvix, secret: string, maintenantS = Math.floor(Date.now() / 1000),
): boolean {
  if (typeof corps !== 'string' || !secret) return false
  const id = (e.id ?? '').trim()
  const t = (e.horodatage ?? '').trim()
  if (!ID_SVIX.test(id) || !/^\d{1,12}$/.test(t)) return false
  if (Math.abs(maintenantS - Number(t)) > TOLERANCE_SVIX_S) return false
  const cle = cleSvix(secret)
  if (!cle) return false
  const attendu = createHmac('sha256', cle).update(`${id}.${t}.${corps}`, 'utf8').digest()
  for (const bout of (e.signature ?? '').split(' ')) {
    const virgule = bout.indexOf(',')
    if (virgule < 0 || bout.slice(0, virgule) !== 'v1') continue
    const sig = bout.slice(virgule + 1)
    if (!BASE64.test(sig)) continue
    const recu = Buffer.from(sig, 'base64')
    if (recu.length === attendu.length && timingSafeEqual(recu, attendu)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// L'evenement Resend
// ---------------------------------------------------------------------------

/**
 * L'expediteur des emails du Live Club quand LIVECLUB_FROM_EMAIL n'est pas
 * pose (le meme litteral dans emails.ts et emails-verification.ts, verifie par
 * scripts/verifier-rebonds-email.mjs). Le webhook Resend est celui du COMPTE :
 * il recoit aussi les emails des autres produits (achats de l'academie, notes
 * de Tab, 10% Club), qui ont chacun leur expediteur et sont ignores ici.
 */
export const EXPEDITEUR_LIVECLUB_DEFAUT = 'Live Club AOKnowledge <support@aoknowledge.com>'

/** Le sujet de l'invitation d'un acces broker (modeleAccesBroker, emails.ts ; verifie par le verificateur). */
export const SUJET_INVITATION_BROKER = 'Votre accès au Live Club est ouvert'

export type GenreEvenement = 'rebond' | 'plainte' | 'bloque'

/**
 * Les evenements traites. email.suppressed (Resend n'a rien envoye : adresse
 * deja dans ses Suppressions) est traite comme un rebond : c'est ce qui
 * arrive a tout email suivant vers l'adresse du 31/10. email.delivery_delayed
 * ne l'est pas : un retard finit en « delivered » ou en « bounced », et c'est
 * le rebond qui previent (une alerte par retard ferait doublon).
 */
export const EVENEMENTS_TRAITES: Readonly<Record<string, GenreEvenement>> = {
  'email.bounced': 'rebond',
  'email.complained': 'plainte',
  'email.suppressed': 'bloque',
}

/** La regle du geste 'adresse' au journal du bot, par genre d'evenement. */
export const REGLE_EVENEMENT: Readonly<Record<GenreEvenement, string>> = {
  rebond: 'email_rebond',
  plainte: 'email_plainte',
  bloque: 'email_bloque',
}
export const REGLES_REBOND: readonly string[] = Object.values(REGLE_EVENEMENT)

/** Une regle du journal qui vient de ce module (geste 'adresse'). */
export function estRegleRebond(regle: unknown): boolean {
  return typeof regle === 'string' && REGLES_REBOND.includes(regle)
}

/**
 * Ce que le refus veut dire, lu dans le type et le sous-type de Resend (doc
 * « email bounces » : Permanent General|NoEmail ; Transient General|
 * MailboxFull|MessageTooLarge|ContentRejected|AttachmentRejected ;
 * Undetermined ; Suppressed et OnAccountSuppressionList pour une adresse deja
 * bloquee).
 * - 'contenu'     : refuse pour son contenu (spam), l'adresse vit (cas du 31/10) ;
 * - 'definitif'   : adresse inexistante ou fermee ;
 * - 'passager'    : boite pleine, serveur indisponible, message trop gros ;
 * - 'bloque'      : rien n'est parti, l'adresse est dans les Suppressions ;
 * - 'plainte'     : livre, puis marque comme spam ;
 * - 'indetermine' : le serveur n'a pas dit pourquoi.
 */
export type NatureRefus = 'contenu' | 'definitif' | 'passager' | 'bloque' | 'plainte' | 'indetermine'

export type EvenementRebond = {
  genre: GenreEvenement
  /** L'adresse touchee, normalisee (minuscules). La premiere de data.to : nos emails n'en ont qu'une. */
  email: string
  /** Le sujet, nettoye (un code de verification masque). */
  sujet: string | null
  /** data.created_at : quand l'email a ete cree chez Resend (ISO), ou null. */
  envoyeLe: string | null
  /** bounce.type (ou suppressed.type), tel quel et court. */
  type: string | null
  sousType: string | null
  /** La reponse du serveur du destinataire (code SMTP d'abord, sinon le message), nettoyee. Un texte de TIERS. */
  motif: string | null
  nature: NatureRefus
  emailId: string | null
}

const cleCode = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z]/g, '')

export function natureRefus(genre: GenreEvenement, type: string | null, sousType: string | null, motif: string | null): NatureRefus {
  if (genre === 'plainte') return 'plainte'
  if (genre === 'bloque') return 'bloque'
  const t = cleCode(type)
  const s = cleCode(sousType)
  if (s === 'suppressed' || s === 'onaccountsuppressionlist') return 'bloque'
  if (t === 'permanent') return 'definitif'
  if (['contentrejected', 'attachmentrejected', 'messagerejected'].includes(s)) return 'contenu'
  if (/\bspam\b/i.test(motif ?? '')) return 'contenu'
  if (t === 'transient' || t === 'temporary') return 'passager'
  return 'indetermine'
}

/**
 * L'invitation d'un acces broker repasse-t-elle « pas envoyee » ? Seulement
 * pour une adresse morte (consigne du 31/10) : un refus de contenu, un
 * blocage ou une plainte ne se regle pas en renvoyant le meme email.
 */
export function invitationARemettre(nature: NatureRefus): boolean {
  return nature === 'definitif'
}

// Caracteres de controle et invisibles, construits par leur code (meme liste
// que resume-pur.ts) pour qu'aucun ne figure en clair dans ce fichier.
const INVISIBLES = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
  .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`, 'g')

/** Un texte venu d'ailleurs : une ligne, sans controle ni invisible, `max` caracteres au plus. */
function propre(brut: unknown, max: number): string | null {
  if (typeof brut !== 'string') return null
  const s = brut.replace(INVISIBLES, ' ').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max).trim() : null
}

/** Le sujet d'un email, nettoye. Un code (6 a 8 chiffres, email du code de verification) est retire. */
export function sujetSur(brut: unknown): string | null {
  const s = propre(brut, 160)
  if (!s) return null
  return s.replace(/\s*:?\s*\b\d{6,8}\b/g, '').trim() || null
}

/** Une adresse email normalisee, ou null (meme regle que normaliserEmail, pur.ts). */
export function emailPropre(brut: unknown): string | null {
  const s = String(brut ?? '').trim().toLowerCase()
  if (s.length < 5 || s.length > 254) return null
  return /^[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[a-z]{2,}$/.test(s) ? s : null
}

/** « Nom <adresse> » compare sans casse ni espaces en trop. */
const expediteurNormalise = (v: unknown) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

/** L'email vient-il du Live Club ? Son expediteur est celui du Live Club (variable, ou valeur par defaut). */
export function estEmailLiveClub(from: unknown, expediteurs: readonly (string | null | undefined)[]): boolean {
  const f = expediteurNormalise(from)
  if (!f) return false
  return [...expediteurs, EXPEDITEUR_LIVECLUB_DEFAUT].some(e => e && expediteurNormalise(e) === f)
}

export type LectureEvenement =
  | { ok: true; evenement: EvenementRebond }
  | { ok: false; raison: 'type' | 'hors_live_club' | 'sans_destinataire' | 'illisible' }

/** L'evenement d'un webhook Resend (corps deja verifie), ou pourquoi il est ignore. */
export function lireEvenementResend(brut: unknown, expediteurs: readonly (string | null | undefined)[]): LectureEvenement {
  if (!brut || typeof brut !== 'object') return { ok: false, raison: 'illisible' }
  const e = brut as { type?: unknown; data?: unknown }
  const genre = typeof e.type === 'string' ? EVENEMENTS_TRAITES[e.type] : undefined
  if (!genre) return { ok: false, raison: 'type' }
  if (!e.data || typeof e.data !== 'object') return { ok: false, raison: 'illisible' }
  const d = e.data as Record<string, unknown>
  if (!estEmailLiveClub(d.from, expediteurs)) return { ok: false, raison: 'hors_live_club' }
  const a = Array.isArray(d.to) ? d.to : typeof d.to === 'string' ? [d.to] : []
  const email = a.map(emailPropre).find((x): x is string => x !== null)
  if (!email) return { ok: false, raison: 'sans_destinataire' }
  const refus = (genre === 'bloque' ? d.suppressed : d.bounce) as Record<string, unknown> | undefined
  const r = refus && typeof refus === 'object' ? refus : {}
  const type = propre(r.type, 40)
  const sousType = propre(r.subType ?? r.sub_type, 40)
  const diagnostic = Array.isArray(r.diagnosticCode) ? r.diagnosticCode.find(x => typeof x === 'string') : r.diagnosticCode
  const smtp = propre(diagnostic, 200)?.replace(/^smtp;\s*/i, '') ?? null
  const motif = smtp || propre(r.message, 200)
  // Le message long sert aussi a reperer un refus pour spam quand le code SMTP est seul.
  const pourNature = [smtp, propre(r.message, 300)].filter(Boolean).join(' ')
  const envoye = typeof d.created_at === 'string' && Number.isFinite(Date.parse(d.created_at)) ? d.created_at : null
  return {
    ok: true,
    evenement: {
      genre, email, sujet: sujetSur(d.subject), envoyeLe: envoye, type, sousType, motif,
      nature: natureRefus(genre, type, sousType, pourNature),
      emailId: typeof d.email_id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(d.email_id) ? d.email_id : null,
    },
  }
}

// ---------------------------------------------------------------------------
// La decision de la route (avant toute base)
// ---------------------------------------------------------------------------

/** Au-dela, le corps est refuse avant la signature (un evenement Resend fait quelques Ko). */
export const MAX_CORPS_WEBHOOK = 256 * 1024

export type DecisionWebhook =
  | { statut: 503; erreur: 'config' }
  | { statut: 400; erreur: 'signature' | 'corps' }
  | { statut: 200; ignore: string }
  | { statut: 'traiter'; svixId: string; evenement: EvenementRebond }

/**
 * Sans secret : 503, rien n'est lu. Signature absente, fausse ou trop vieille :
 * 400, rien n'est traite. Corps illisible : 400. Coupe (LIVECLUB_REBONDS=0),
 * evenement non traite, email d'un autre produit, sans destinataire : 200 et
 * rien. Sinon : a traiter.
 */
export function decisionWebhook(o: {
  secret: string | null | undefined
  corps: string
  entetes: EntetesSvix
  maintenantS: number
  expediteurs: readonly (string | null | undefined)[]
  coupe?: boolean
}): DecisionWebhook {
  const secret = o.secret?.trim()
  if (!secret) return { statut: 503, erreur: 'config' }
  if (o.corps.length > MAX_CORPS_WEBHOOK) return { statut: 400, erreur: 'corps' }
  if (!verifierSignatureSvix(o.corps, o.entetes, secret, o.maintenantS)) return { statut: 400, erreur: 'signature' }
  let brut: unknown
  try { brut = JSON.parse(o.corps) } catch { return { statut: 400, erreur: 'corps' } }
  if (o.coupe) return { statut: 200, ignore: 'coupe' }
  const lu = lireEvenementResend(brut, o.expediteurs)
  if (!lu.ok) return { statut: 200, ignore: lu.raison }
  return { statut: 'traiter', svixId: (o.entetes.id ?? '').trim(), evenement: lu.evenement }
}

// ---------------------------------------------------------------------------
// Petits formats
// ---------------------------------------------------------------------------

/** L'empreinte d'une adresse (sha256, 32 caracteres) : la cle du journal, jamais l'adresse en clair. */
export function empreinteEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex').slice(0, 32)
}

/** Le jour de Paris d'un instant, 'YYYY-MM-DD'. */
export function jourParisDe(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const v = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${v('year')}-${v('month')}-${v('day')}`
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** Un instant ISO -> « 31 octobre à 12 h 35 », a l'heure de Paris. null si illisible. */
export function heureParis(iso: string | null): string | null {
  const t = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(t)) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(t))
  const v = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  const jour = Number(v('day'))
  return `${jour === 1 ? '1er' : jour} ${MOIS[Number(v('month')) - 1] ?? v('month')} à ${Number(v('hour'))} h ${v('minute')}`
}

// ---------------------------------------------------------------------------
// Les textes
// ---------------------------------------------------------------------------

/** Pourquoi, en clair, pour l'alerte (consigne du 31/10 : type et sous-type dits en clair). */
export const LIBELLE_NATURE: Readonly<Record<NatureRefus, string>> = {
  contenu: "refusé comme spam par le serveur du destinataire (contenu), pas une adresse morte. Le même email renvoyé serait sans doute refusé pareil",
  definitif: "adresse refusée pour de bon par le serveur du destinataire (inexistante ou fermée) : nos emails ne lui arriveront pas",
  passager: "refus passager chez le destinataire (boîte pleine, serveur indisponible ou message trop gros) : un prochain email peut passer",
  bloque: "pas envoyé : l'adresse est dans les Suppressions de Resend après un refus précédent, Resend ne lui envoie plus rien",
  plainte: "il l'a marqué comme spam dans sa boîte (ou sa boîte l'a fait pour lui) : nos prochains emails risquent de ne plus lui arriver",
  indetermine: 'refusé par le serveur du destinataire, sans raison claire',
}

/** La meme chose en court, pour le resume du matin (minuscule, sans point final). */
const COURT_NATURE: Readonly<Record<NatureRefus, string>> = {
  contenu: 'refusé comme spam par son serveur (contenu)',
  definitif: 'refusé : adresse inexistante ou fermée',
  passager: 'refusé pour un souci passager (boîte pleine, serveur indisponible)',
  bloque: 'bloqué par Resend (adresse dans les Suppressions)',
  plainte: 'marqué comme spam dans sa boîte',
  indetermine: 'refusé par son serveur',
}

/** Ce que devient l'invitation d'un acces broker pas encore utilise. null = l'email n'etait pas une invitation. */
export type IssueInvitation = 'remise' | 'gardee' | 'inchangee'

/** Ce qui s'est passe pour le membre. */
export type IssueMembre = 'prive' | 'deja' | 'equipe' | 'echec' | 'sans_compte'

export type AlerteRebond = {
  email: string
  /** Nom, @pseudo : ce qu'on sait de la personne (deja rendu sur par l'appelant). */
  qui: string | null
  /** Ce qu'est l'adresse pour le Live Club (QUOI_ADRESSE), ou null = inconnue. */
  quoi: string | null
  evenement: Pick<EvenementRebond, 'genre' | 'sujet' | 'envoyeLe' | 'type' | 'sousType' | 'motif' | 'nature'>
  invitation: IssueInvitation | null
  /** Le lien personnel vers le bot (acces broker, jeton pas utilise). Dans l'alerte Telegram, jamais dans l'historique. */
  lien: string | null
  /** L'acces broker existe (le lien personnel a du sens, meme s'il n'est plus valable). */
  accesBroker: boolean
  membre: IssueMembre
  /** Une ligne de securite (motif du serveur suspect), ou null. */
  securite: string | null
}

const PHRASE_MEMBRE: Readonly<Record<IssueMembre, string>> = {
  prive: "Je l'ai prévenu en privé (bot du Live Club) et lui ai proposé de donner une autre adresse.",
  deja: 'Il a déjà été prévenu en privé pour cette adresse.',
  equipe: "Je ne lui ai rien écrit : l'équipe a la main dans son fil.",
  echec: "Mon message privé n'est pas passé (bot bloqué ou jamais ouvert).",
  sans_compte: 'Je ne peux pas le prévenir : aucun compte Telegram relié au bot.',
}

/** La ligne du lien personnel, et ce qui la remplace dans l'historique d'Agent AOK. */
export const PREFIXE_LIEN = 'Son lien personnel : '
export const LIEN_HORS_HISTORIQUE = "Son lien personnel : donné dans l'alerte Telegram, pas gardé ici."

/** « À faire », selon le cas. */
function aFaire(a: AlerteRebond): string {
  const n = a.evenement.nature
  if (a.lien) return 'À faire : donne-lui toi-même son lien personnel (ci-dessous), il le fait entrer tout seul ; ou demande-lui une autre adresse.'
  if (n === 'plainte') return "À faire : s'il veut recevoir nos emails, demande-lui une autre adresse."
  if (n === 'bloque') return "À faire : demande-lui une autre adresse ; si celle-ci est bonne, elle se débloque dans Resend (Suppressions)."
  if (n === 'passager') return 'À faire : rien de plus si le prochain email passe ; sinon, demande-lui une autre adresse.'
  if (a.accesBroker) return "À faire : demande-lui une autre adresse (son lien personnel n'est plus valable, ou il a déjà servi)."
  return "À faire : demande-lui une autre adresse, l'équipe la relie à son compte après vérification."
}

/**
 * L'alerte a Brice et Melanie (Agent AOK), courte (Melanie) : quel email, a
 * qui, pourquoi en clair (avec le type et le sous-type de Resend et la
 * reponse du serveur), quoi faire, et ce qui a ete fait pour le membre.
 */
export function texteAlerteRebond(a: AlerteRebond): string {
  const ev = a.evenement
  const titre = ev.genre === 'plainte' ? 'Email du Live Club marqué comme spam'
    : ev.nature === 'bloque' ? 'Email du Live Club bloqué par Resend'
      : 'Email du Live Club refusé'
  const heure = heureParis(ev.envoyeLe)
  const qui = [a.qui, a.quoi ?? 'adresse inconnue du Live Club'].filter(Boolean).join(', ')
  const resend = [ev.type, ev.sousType].filter(Boolean).join(' / ')
  const brut = [resend, ev.motif ? `« ${ev.motif} »` : null].filter(Boolean).join(', ')
  const invitation = a.invitation === 'remise'
    ? "Son invitation d'accès broker repasse « pas envoyée »."
    : a.invitation === 'gardee' && ev.nature === 'contenu'
      ? "Son invitation reste notée « envoyée » : rien n'est renvoyé tout seul."
      : null
  return [
    `${titre} : « ${ev.sujet ?? 'sans sujet'} »${heure ? `, parti le ${heure}` : ''}, à ${a.email} (${qui}).`,
    `Pourquoi : ${LIBELLE_NATURE[ev.nature]}.${brut ? ` (Resend : ${brut}.)` : ''}`,
    ...(a.securite ? [a.securite] : []),
    ...(invitation ? [invitation] : []),
    aFaire(a),
    ...(a.lien ? [`${PREFIXE_LIEN}${a.lien}`] : []),
    PHRASE_MEMBRE[a.membre],
  ].join('\n')
}

/** L'alerte telle qu'elle entre a l'historique d'Agent AOK : sans le lien personnel (une cle d'entree ne se garde pas en base). */
export function sansLienPersonnel(texte: string): string {
  return texte.split('\n').map(l => (l.startsWith(PREFIXE_LIEN) ? LIEN_HORS_HISTORIQUE : l)).join('\n')
}

/** Le marqueur de l'historique d'Agent AOK : l'alerte n'est pas une question de l'equipe. */
export const MARQUEUR_ALERTE_REBOND = "[système] Alerte « email du Live Club refusé », envoyée automatiquement à la réception du refus chez Resend (ce n'est pas une question de l'équipe)."

/**
 * Le message prive au membre (bot du Live Club, tutoiement). Il ne parle pas
 * de spam pour un refus (consigne du 31/10) : l'email n'a pas pu arriver, et
 * il peut donner une autre adresse. Une adresse ne se relie que sur preuve :
 * l'equipe s'en occupe (regle des adresses multiples du 31/10).
 */
export function texteMembreRebond(email: string, sujet: string | null, genre: GenreEvenement): string {
  const quel = sujet ? `notre email « ${sujet} »` : 'notre dernier email'
  if (genre === 'plainte') {
    return [
      `Petit point sur tes emails : ta boîte ${email} a rangé ${quel} parmi les indésirables, et les prochains risquent de ne plus t'y arriver.`,
      "Tu préfères les recevoir sur une autre adresse ? Écris-la-moi ici, l'équipe s'en occupe.",
    ].join('\n\n')
  }
  return [
    `Petit souci avec ton adresse email : ${quel} n'a pas pu t'arriver à ${email}.`,
    "Tu as une autre adresse ? Écris-la-moi ici, l'équipe s'en occupe.",
  ].join('\n\n')
}

/** Ce qu'est l'adresse pour le Live Club, dans l'alerte. */
export function quoiAdresse(p: { acces: { telegramId: number | null } | null; clientStripe: string | null; telegramIds: readonly number[] }): string | null {
  if (p.acces) return p.acces.telegramId === null ? 'accès broker, pas encore entré dans le groupe' : 'accès broker'
  if (p.clientStripe) return 'client Stripe du Live Club'
  if (p.telegramIds.length) return 'membre relié au bot'
  return null
}

/**
 * La ligne du resume du matin pour un geste rebond (details du journal), en
 * minuscule et sans point final : elle suit le nom de la personne.
 */
export function phraseRebondResume(details: Record<string, unknown> | null | undefined): string {
  const d = details ?? {}
  const nature = (typeof d.nature === 'string' && d.nature in COURT_NATURE ? d.nature : 'indetermine') as NatureRefus
  const sujet = typeof d.sujet === 'string' && d.sujet ? `email « ${d.sujet} »` : 'email du Live Club'
  const suites: string[] = []
  if (d.invitation === 'remise') suites.push('invitation repassée « pas envoyée »')
  if (d.lien_donne === true) suites.push("lien personnel donné à l'équipe")
  if (d.message === 'prive') suites.push('prévenu en privé')
  if (d.connue === false) suites.push('adresse inconnue du Live Club, voir l\'alerte')
  return `${sujet} ${COURT_NATURE[nature]}${suites.length ? `, ${suites.join(', ')}` : ''}`
}

// ---------------------------------------------------------------------------
// Le deroule (outils en parametre : serveur ou fausse base du verificateur)
// ---------------------------------------------------------------------------

/** Ce qu'on retrouve d'une adresse : acces broker, abonne (client Stripe), comptes Telegram relies. */
export type PersonneRebond = {
  /** Comptes Telegram relies a l'adresse (preuve : jeton utilise, rattachement), 3 au plus, dans l'ordre. */
  telegramIds: number[]
  membreId: string | null
  /** Nom et @pseudo du premier compte, ou null. Choisi par la personne : rendu sur par l'appelant. */
  nom: string | null
  /** L'acces broker de l'adresse (une ligne au plus par adresse). */
  acces: { accesId: string; telegramId: number | null; actif: boolean } | null
  /** Un client Stripe du Live Club qui porte l'adresse, ou null. */
  clientStripe: string | null
}

export type ReservationRebond = {
  svixId: string
  empreinte: string
  jour: string
  regle: string
  telegramId: number | null
  membreId: string | null
  details: Record<string, unknown>
  /** Un compte Telegram est relie : le message prive est-il encore a envoyer (une fois par adresse) ? */
  membreAPrevenir: boolean
}

export type OutilsRebond = {
  retrouverPersonne(email: string): Promise<PersonneRebond>
  /**
   * Inscrit l'evenement au journal, sous verrou de l'adresse. null = ce
   * svix-id est deja traite (rejeu). alerte : aucune alerte envoyee pour
   * cette adresse aujourd'hui ; message : membre pas encore prevenu pour
   * cette adresse. Jette si la base ne repond pas (la route repond 500, Resend
   * rejoue plus tard).
   */
  reserver(r: ReservationRebond): Promise<{ id: string; alerte: boolean; message: boolean } | null>
  /** invite_envoyee_le a null si l'invitation n'a pas servi et n'a pas ete renvoyee depuis. true = remise. */
  remettreInvitation(accesId: string, envoyeLe: string | null): Promise<boolean>
  /** Le lien personnel d'un acces broker dont le jeton n'a pas servi, ou null. */
  lienPersonnel(accesId: string): Promise<string | null>
  /** L'equipe attend ou repond dans le fil de ce compte : le bot se tait. */
  equipeALaMain(telegramId: number): Promise<boolean>
  /** Le message prive (et sa trace au fil Support). true = delivre. */
  envoyerPrive(telegramId: number, texte: string): Promise<boolean>
  /** Le motif du serveur (texte de tiers) : rendu visible s'il est suspect, et la ligne de securite. */
  analyserMotif(motif: string): { texte: string; securite: string | null }
  /** L'alerte a l'equipe (Telegram, puis l'historique d'Agent AOK sans le lien). Nombre de destinataires livres. */
  alerterEquipe(texte: string, texteHistorique: string, id: string): Promise<number>
  /** Ferme la ligne du journal (resultat, details en plus) et la trace au fil Support. */
  clore(id: string, n: { resultat: 'fait' | 'echec'; details: Record<string, unknown>; telegramId: number | null; regle: string }): Promise<void>
  maintenant(): Date
}

export type BilanRebond =
  | { etat: 'deja' }
  | {
    etat: 'traite'
    alerte: 'envoyee' | 'deja' | 'echec'
    membre: IssueMembre
    invitation: IssueInvitation | null
    lien: boolean
    /** L'alerte n'est pas partie : la route repond 500, Resend rejoue (rien d'autre n'est refait). */
    aRejouer: boolean
  }

/**
 * Traite un evenement deja verifie et lu. L'ordre : la personne (lectures),
 * la reservation (une fois par svix-id), l'invitation, le membre, puis
 * l'alerte qui dit tout ce qui a ete fait, et la cloture du journal.
 */
export async function traiterRebond(ev: EvenementRebond, svixId: string, o: OutilsRebond): Promise<BilanRebond> {
  const p = await o.retrouverPersonne(ev.email)
  const acces = p.acces
  // L'invitation d'un acces broker pas encore utilise : seul email qui, refuse, laisse la personne dehors.
  const invitationVisee = !!acces && acces.actif && acces.telegramId === null && ev.sujet === SUJET_INVITATION_BROKER
  const regle = REGLE_EVENEMENT[ev.genre]
  const telegramId = p.telegramIds[0] ?? null
  const r = await o.reserver({
    svixId, empreinte: empreinteEmail(ev.email), jour: jourParisDe(o.maintenant()), regle, telegramId, membreId: p.membreId,
    membreAPrevenir: p.telegramIds.length > 0,
    details: {
      svix_id: svixId, evenement: ev.genre, nature: ev.nature, type: ev.type, sous_type: ev.sousType, sujet: ev.sujet,
      email_id: ev.emailId, acces_id: acces?.accesId ?? null, client_stripe: p.clientStripe,
      connue: !!(acces || p.clientStripe || p.telegramIds.length || p.membreId),
    },
  })
  if (!r) return { etat: 'deja' }

  // 1. L'invitation (definitif seulement), puis le lien personnel a donner.
  let invitation: IssueInvitation | null = null
  if (invitationVisee && acces) {
    invitation = invitationARemettre(ev.nature)
      ? (await o.remettreInvitation(acces.accesId, ev.envoyeLe) ? 'remise' : 'inchangee')
      : 'gardee'
  }
  const lien = acces && acces.actif && acces.telegramId === null ? await o.lienPersonnel(acces.accesId) : null

  // 2. Le membre, une fois par adresse, l'etat de son fil relu juste avant.
  let membre: IssueMembre = 'sans_compte'
  if (p.telegramIds.length) {
    membre = r.message ? 'echec' : 'deja'
    if (r.message) {
      const texte = texteMembreRebond(ev.email, ev.sujet, ev.genre)
      for (const tid of p.telegramIds) {
        if (await o.equipeALaMain(tid)) { membre = 'equipe'; break }
        if (await o.envoyerPrive(tid, texte)) { membre = 'prive'; break }
      }
    }
  }

  // 3. L'alerte, une fois par adresse et par jour.
  let alerte: 'envoyee' | 'deja' | 'echec' = 'deja'
  let livres = 0
  if (r.alerte) {
    const motif = ev.motif ? o.analyserMotif(ev.motif) : null
    const texte = texteAlerteRebond({
      email: ev.email, qui: p.nom, quoi: quoiAdresse(p),
      evenement: { ...ev, motif: motif?.texte ?? null },
      invitation, lien, accesBroker: !!acces, membre, securite: motif?.securite ?? null,
    })
    livres = await o.alerterEquipe(texte, sansLienPersonnel(texte), `rebond-${r.id}`)
    alerte = livres > 0 ? 'envoyee' : 'echec'
  }

  await o.clore(r.id, {
    resultat: alerte === 'echec' ? 'echec' : 'fait',
    telegramId, regle,
    details: { alerte, livres, message: membre, invitation, lien_donne: !!lien && alerte === 'envoyee' },
  })
  return { etat: 'traite', alerte, membre, invitation, lien: !!lien, aRejouer: alerte === 'echec' }
}
