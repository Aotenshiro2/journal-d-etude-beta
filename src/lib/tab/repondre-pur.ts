// L'API DE TAB : PREPARER UNE REPONSE A UN MEMBRE (01/11/2026), partie PURE.
//
// Brice, 01/11 : « je suis ok pour la nouvelle route de réponse de tache et
// tab », puis, le meme jour, « ok pour la B » : Tab ou Tache PREPARENT la
// reponse, Brice ou Melanie l'ENVOIENT d'un clic dans Agent AOK (« ça évite
// les conversations que le bot ne pourrait pas gérer entièrement sans moi »).
//
// POST /support/<fil_id>/repondre { texte } n'envoie donc RIEN au membre :
// les controles ci-dessous passent, une proposition est enregistree
// (cockpit_tab_propositions) et une carte « Envoyer / Annuler » part a chaque
// compte de l'equipe dans Agent AOK. Le premier clic l'emporte. Envoyer =
// l'envoi de l'onglet Support du cockpit (repondreAuFil, support-reponse.ts).
// Le serveur : src/lib/tab/repondre.ts.
//
// Les controles (grille de securite des bots de Brice, 29/10) : le texte est
// un contenu SORTANT vers un membre, ecrit par une IA exterieure.
// - texte vide refuse, MAX_TEXTE_REPONSE caracteres au plus ;
// - analyserTexte au niveau 'tiers' : texte cache, Base64, commentaire HTML,
//   consigne ou adresse a une IA, faux message systeme, RIB ou IBAN = REFUS
//   (et Brice est alerte par le serveur) ;
// - liens : nos domaines (aoknowledge.com, melaniechart.com et leurs
//   sous-domaines), le bot des membres sans parametre (t.me/aok_liveclub_bot),
//   et les liens PUBLIES que les bots donnent deja, a l'adresse exacte (liens
//   utiles, liens partenaires, portail de carte Stripe, portes d'abonnement).
//   Tout autre lien est REFUSE. Une adresse email hors de nos domaines et une
//   mention @ autre que le bot ne sont pas refusees : la carte les signale ;
// - fil existant, du bot du Live Club (Telegram) seulement, avec un compte,
//   et un message du membre de moins de FENETRE_FIL_JOURS jours : pas de
//   prise de contact a froid ;
// - cadence : MAX_PROPOSITIONS_PAR_FIL_HEURE par fil et
//   MAX_PROPOSITIONS_PAR_CLE_HEURE par cle, sur l'heure glissante ;
// - une proposition non validee expire apres DUREE_PROPOSITION_HEURES heures.
//   Elle ne part jamais toute seule.
//
// Aucun reseau, aucune base : scripts/verifier-tab-repondre.mjs charge ce
// module tel quel.

import type { Analyse } from '@/lib/securite/injection-pur'
import { analyserTexte, resumeAnalyse } from '@/lib/securite/injection-pur'
import { LIENS_PARTENAIRES, LIENS_UTILES } from '@/lib/politique-information'
import { URLS_ABONNEMENT, URL_PORTAIL_CARTE } from '@/lib/liveclub/config'
import { texteReponseEquipe } from '@/lib/liveclub/support-pont-pur'

/** Longueur maximale du texte propose (caracteres, apres retrait des blancs autour). */
export const MAX_TEXTE_REPONSE = 2000
/** Le membre doit avoir ecrit dans son fil depuis moins de ce nombre de jours. */
export const FENETRE_FIL_JOURS = 30
/** Propositions par fil sur l'heure glissante (toutes cles et tous statuts confondus). */
export const MAX_PROPOSITIONS_PAR_FIL_HEURE = 3
/** Propositions par cle sur l'heure glissante. */
export const MAX_PROPOSITIONS_PAR_CLE_HEURE = 20
/** Une proposition sans clic expire apres ce delai. Elle ne part jamais seule. */
export const DUREE_PROPOSITION_HEURES = 48
/** Nos domaines : tout chemin y est permis, sous-domaines compris. */
export const DOMAINES_AOK = ['aoknowledge.com', 'melaniechart.com'] as const

const JOUR_MS = 86_400_000
const HEURE_MS = 3_600_000

export type AuteurProposition = 'tab' | 'tache'

export const STATUTS_PROPOSITION = ['proposee', 'envoi', 'envoyee', 'annulee', 'expiree', 'remplacee', 'refusee', 'echec'] as const
export type StatutProposition = (typeof STATUTS_PROPOSITION)[number]

/** « Tab » ou « Tache », pour les textes. */
export function nomAuteur(a: AuteurProposition): string {
  return a === 'tache' ? 'Tache' : 'Tab'
}

/** Le nom d'un compte de l'equipe (cockpit_telegram_comptes.libelle) : « Brice », « Mélanie ». */
export function nomEquipe(libelle: string | null | undefined): string {
  const s = typeof libelle === 'string' ? libelle.replace(/\s+/g, ' ').trim().slice(0, 40) : ''
  if (!s) return "quelqu'un de l'équipe"
  const bas = s.toLowerCase()
  if (bas === 'brice') return 'Brice'
  if (bas === 'melanie' || bas === 'mélanie' || bas === 'mel') return 'Mélanie'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ---------------------------------------------------------------------------
// 1. La demande
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** L'identifiant d'un fil (fil_id de GET /support), en minuscules, ou null. */
export function lireIdFil(brut: unknown): string | null {
  const s = typeof brut === 'string' ? brut.trim().toLowerCase() : ''
  return UUID.test(s) ? s : null
}

/** Le corps de POST /support/<fil_id>/repondre : { texte } et rien d'autre. Rend le texte ou l'erreur. */
export function lireDemandeReponse(corps: unknown): { texte: string } | string {
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) {
    return 'Corps JSON attendu : { "texte": "..." }.'
  }
  const autres = Object.keys(corps).filter((k) => k !== 'texte')
  if (autres.length) return `Champ inattendu : ${autres.slice(0, 5).join(', ')}. Corps attendu : { "texte": "..." }, rien d'autre.`
  const brut = (corps as { texte?: unknown }).texte
  if (typeof brut !== 'string') return 'texte manquant : le message à proposer, en texte brut.'
  const texte = brut.replace(/\r\n?/g, '\n').trim()
  if (!texte) return 'texte vide : rien à proposer.'
  if (texte.length > MAX_TEXTE_REPONSE) {
    return `texte trop long : ${texte.length} caractères, ${MAX_TEXTE_REPONSE} au plus. Raccourcis-le (rien n'est coupé).`
  }
  return { texte }
}

// ---------------------------------------------------------------------------
// 2. Les liens
// ---------------------------------------------------------------------------

/** Domaines nus reconnus comme des liens (Telegram rend cliquables ceux-la, et d'autres). */
const TLD = [
  'com', 'fr', 'net', 'org', 'io', 'ai', 'co', 'me', 'app', 'dev', 'xyz', 'info', 'biz', 'us', 'uk', 'de', 'es', 'it', 'eu',
  'be', 'ch', 'ca', 'ly', 'gg', 'tv', 'to', 'cc', 'link', 'site', 'online', 'store', 'shop', 'live', 'club', 'pro', 'ru', 'cn',
  'top', 'vip', 'click', 'money', 'finance', 'trade', 'bot', 'so', 'sh', 'ws', 'gl', 'li', 'lu', 'nl', 'pl', 'pt', 'in', 'br',
  'au', 'jp', 'im', 'is', 're', 'ma', 'tn', 'sn', 'ci', 'cm', 'cash', 'bet', 'win', 'page', 'ink', 'one', 'world', 'global',
  'tech', 'digital', 'email', 'today', 'news', 'blog', 'cloud', 'space', 'website', 'fun', 'icu', 'cyou', 'buzz', 'sbs', 'lol',
  'rest', 'bar', 'monster', 'zip', 'mov', 'gle', 'gd', 'ms', 'tk', 'ml', 'ga', 'cf', 'gq',
].join('|')
const FIN_URL = '[^\\s<>«»"\'`]'
const RE_EMAIL = /[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}/gi
const RE_SCHEMA = new RegExp(`\\b[a-z][a-z0-9+.-]{1,15}:\\/\\/${FIN_URL}+`, 'gi')
const RE_WWW = new RegExp(`\\bwww\\.${FIN_URL}+`, 'gi')
const RE_NU = new RegExp(`(?<![@\\w.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLD})\\b(?:[/?#]${FIN_URL}*)?`, 'gi')
const RE_MENTION = /(?<![\w@.])@([a-z][a-z0-9_]{3,31})\b/gi

function sansPonctuationFinale(s: string): string {
  return s.replace(/[.,;:!?)\]»'"]+$/u, '')
}

function hoteSansWww(u: URL): string {
  return u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
}

/** La forme comparee d'une adresse publiee : hote sans www, chemin sans barre finale, parametres exacts. */
function cleLien(u: URL): string {
  return `${hoteSansWww(u)}${u.pathname.replace(/\/+$/, '')}${u.search}`
}

function lireUrl(brut: string): URL | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(brut) ? brut : `https://${brut}`)
  } catch {
    return null
  }
}

/** Les adresses exactes que les bots donnent deja (liens utiles, partenaires, portail de carte, abonnement). */
export function liensPublies(): string[] {
  return [...LIENS_UTILES.map((l) => l.url), ...LIENS_PARTENAIRES.map((l) => l.url), URL_PORTAIL_CARTE, ...URLS_ABONNEMENT]
}

let publiesMemo: Set<string> | null = null
function clesPubliees(): Set<string> {
  if (!publiesMemo) {
    publiesMemo = new Set(liensPublies().map((s) => lireUrl(s)).filter((u): u is URL => u !== null).map(cleLien))
  }
  return publiesMemo
}

/**
 * Un lien est-il permis dans une reponse a un membre ? Nos domaines (et
 * sous-domaines), le bot des membres sans parametre (un ?start= est un jeton
 * de rattachement : jamais), ou une adresse publiee, a l'identique.
 * Identifiants dans l'adresse (« aoknowledge.com@autre.site »), port,
 * protocole autre que http(s) : refuse.
 */
export function lienAutorise(brut: string, bot: string): boolean {
  const u = lireUrl(brut)
  if (!u) return false
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  if (u.username || u.password || u.port) return false
  const hote = hoteSansWww(u)
  if (DOMAINES_AOK.some((d) => hote === d || hote.endsWith(`.${d}`))) return true
  if (hote === 't.me' || hote === 'telegram.me') {
    const chemin = u.pathname.replace(/\/+$/, '').toLowerCase()
    return chemin === `/${bot.replace(/^@+/, '').toLowerCase()}` && !u.search && !u.hash
  }
  return clesPubliees().has(cleLien(u))
}

export type ControleLiens = {
  /** Les liens refuses, tels qu'ecrits. */
  refuses: string[]
  /** Ce que la carte signale sans refuser : adresses email hors de nos domaines, mentions @ autres que le bot. */
  aVerifier: string[]
}

/** Les liens, adresses email et mentions d'un texte sortant. */
export function controlerLiens(texte: string, bot: string): ControleLiens {
  const refuses: string[] = []
  const aVerifier: string[] = []
  let reste = texte
  for (const m of texte.match(RE_EMAIL) ?? []) {
    const domaine = m.split('@').pop()!.toLowerCase()
    if (!DOMAINES_AOK.some((d) => domaine === d || domaine.endsWith(`.${d}`))) aVerifier.push(`adresse email hors de nos domaines (${m})`)
    reste = reste.replace(m, ' ')
  }
  for (const re of [RE_SCHEMA, RE_WWW, RE_NU]) {
    for (const brut of reste.match(re) ?? []) {
      const lien = sansPonctuationFinale(brut)
      if (!lien) continue
      if (!lienAutorise(lien, bot) && !refuses.includes(lien)) refuses.push(lien)
      reste = reste.replace(brut, ' ')
    }
  }
  const botBas = bot.replace(/^@+/, '').toLowerCase()
  for (const m of reste.matchAll(RE_MENTION)) {
    if (m[1].toLowerCase() !== botBas) {
      const l = `mention @${m[1]} (un compte Telegram autre que le bot)`
      if (!aVerifier.includes(l)) aVerifier.push(l)
    }
  }
  return { refuses, aVerifier }
}

// ---------------------------------------------------------------------------
// 3. Le controle du texte (a la proposition, et de nouveau au clic)
// ---------------------------------------------------------------------------

export type ControleTexte =
  | { ok: true; texte: string; aVerifier: string[] }
  | { ok: false; raison: 'vide' | 'trop_long' | 'suspect' | 'lien'; erreur: string; analyse?: Analyse }

/** Vide, longueur, texte suspect (niveau 'tiers'), liens. Le premier refus l'emporte. */
export function controlerTexteReponse(brut: unknown, bot: string): ControleTexte {
  const texte = typeof brut === 'string' ? brut.replace(/\r\n?/g, '\n').trim() : ''
  if (!texte) return { ok: false, raison: 'vide', erreur: 'texte vide : rien à proposer.' }
  if (texte.length > MAX_TEXTE_REPONSE) {
    return { ok: false, raison: 'trop_long', erreur: `texte trop long : ${texte.length} caractères, ${MAX_TEXTE_REPONSE} au plus.` }
  }
  const analyse = analyserTexte(texte, { niveau: 'tiers' })
  if (analyse.suspect) {
    return {
      ok: false,
      raison: 'suspect',
      analyse,
      erreur: `Texte refusé (sécurité) : il contient ${resumeAnalyse(analyse) || 'du texte suspect'}. `
        + "Rien n'est proposé et Brice est prévenu. Un message pour un membre s'écrit en clair : sans caractère caché, "
        + 'sans Base64 ni commentaire HTML, sans consigne adressée à une IA, sans coordonnées bancaires.',
    }
  }
  const liens = controlerLiens(texte, bot)
  if (liens.refuses.length) {
    return {
      ok: false,
      raison: 'lien',
      erreur: `Lien refusé : ${liens.refuses.slice(0, 5).join(', ')}. Seuls passent nos domaines (${DOMAINES_AOK.join(', ')}), `
        + `le bot des membres (t.me/${bot.replace(/^@+/, '')}, sans paramètre) et les liens déjà publiés par Brice et Mélanie `
        + "(liens utiles et partenaires du bot, à l'adresse exacte). Rien n'est proposé.",
    }
  }
  return { ok: true, texte, aVerifier: liens.aVerifier }
}

// ---------------------------------------------------------------------------
// 4. Le fil
// ---------------------------------------------------------------------------

/** Le fil Support tel que le serveur le lit pour une proposition. */
export type FilLu = {
  id: string
  app: string
  telegramId: number | null
  nom: string | null
  pseudo: string | null
  email: string | null
  messages: unknown
  /** escalatedAt en millisecondes, null = n'attend pas d'humain. */
  attendT: number | null
}

type MessageBrut = { role?: unknown; at?: unknown }

function instant(m: MessageBrut): number | null {
  const t = typeof m.at === 'string' ? Date.parse(m.at) : NaN
  return Number.isFinite(t) ? t : null
}

function dernier(messages: unknown, role: string): number | null {
  if (!Array.isArray(messages)) return null
  let t: number | null = null
  for (const m of messages as MessageBrut[]) {
    if (m && typeof m === 'object' && m.role === role) {
      const x = instant(m)
      if (x !== null && (t === null || x > t)) t = x
    }
  }
  return t
}

/** Le dernier message DATE du membre (role user), en millisecondes, ou null. */
export function dernierMessageMembre(messages: unknown): number | null {
  return dernier(messages, 'user')
}

/** La derniere reponse DATEE de l'equipe (role human), ou null. */
export function dernierMessageEquipe(messages: unknown): number | null {
  return dernier(messages, 'human')
}

export type VerdictFil =
  | { ok: true; dernierMembreT: number }
  | { ok: false; status: 404 | 409; raison: 'introuvable' | 'pas_telegram' | 'sans_compte' | 'trop_ancien'; erreur: string }

/**
 * Le fil peut-il recevoir une reponse preparee ? Existant, du bot du Live
 * Club, avec un compte, et un membre qui a ecrit recemment. Sert a la
 * proposition et de nouveau au clic Envoyer : l'appelant ajoute « Rien n'est
 * proposé. » ou « Rien n'est parti. ».
 */
export function verdictFil(f: FilLu | null, maintenant: number): VerdictFil {
  if (!f) {
    return { ok: false, status: 404, raison: 'introuvable', erreur: "Fil introuvable : prends son fil_id dans GET /support (l'identifiant complet)." }
  }
  if (f.app !== 'telegram') {
    return {
      ok: false, status: 409, raison: 'pas_telegram',
      erreur: `Ce fil vient du support du site (app ${f.app}), pas du bot du Live Club : cette route ne sert qu'aux fils du bot. `
        + "Brice ou Mélanie lui répondent depuis l'onglet Support du cockpit.",
    }
  }
  if (!f.telegramId) {
    return { ok: false, status: 409, raison: 'sans_compte', erreur: 'Ce fil du bot ne porte aucun compte Telegram : rien ne pourrait lui être livré.' }
  }
  const t = dernierMessageMembre(f.messages)
  if (t === null || maintenant - t > FENETRE_FIL_JOURS * JOUR_MS) {
    return {
      ok: false, status: 409, raison: 'trop_ancien',
      erreur: `Le membre n'a pas écrit dans ce fil depuis plus de ${FENETRE_FIL_JOURS} jours : pas de prise de contact à froid par cette route `
        + '(si Brice ou Mélanie veulent lui écrire, ils le font eux-mêmes).',
    }
  }
  return { ok: true, dernierMembreT: t }
}

/** Le nom court du membre pour la carte : son nom, sinon son @, son email, ou son compte Telegram. */
export function nomCourt(f: Pick<FilLu, 'nom' | 'pseudo' | 'email' | 'telegramId'>): string {
  const nom = f.nom?.replace(/\s+/g, ' ').trim()
  if (nom) return nom.length > 60 ? `${nom.slice(0, 57)}...` : nom
  if (f.pseudo?.trim()) return `@${f.pseudo.trim().replace(/^@+/, '')}`
  if (f.email?.trim()) return f.email.trim()
  return f.telegramId ? `compte Telegram u${f.telegramId}` : 'un membre'
}

// ---------------------------------------------------------------------------
// 5. Le statut d'un fil (GET /support)
// ---------------------------------------------------------------------------

export type StatutFil = 'attend_un_humain' | 'non_ouverte' | 'repondu' | 'avec_le_bot'

export const STATUTS_FIL_EN_CLAIR: Record<StatutFil, string> = {
  attend_un_humain: "Le membre a demandé un humain et personne de l'équipe n'a répondu depuis.",
  non_ouverte: "Un message du membre de moins de 30 jours que personne de l'équipe n'a ouvert ni répondu.",
  repondu: "L'équipe a répondu après le dernier message du membre.",
  avec_le_bot: "Pas de demande d'humain en cours : le bot (ou l'IA) mène la conversation.",
}

/** Le statut d'un fil, dans cet ordre : attend un humain, non ouverte, repondu, avec le bot. */
export function statutFil(o: { attendHumain: boolean; nonOuverte: boolean; tMembre: number | null; tHumain: number | null }): StatutFil {
  if (o.attendHumain) return 'attend_un_humain'
  if (o.nonOuverte) return 'non_ouverte'
  if (o.tHumain !== null && (o.tMembre === null || o.tHumain >= o.tMembre)) return 'repondu'
  return 'avec_le_bot'
}

// ---------------------------------------------------------------------------
// 6. La cadence
// ---------------------------------------------------------------------------

/** Le refus de cadence, ou null. Compte les propositions de l'heure glissante (avant celle-ci). */
export function refusCadence(o: { parFilHeure: number; parCleHeure: number }): string | null {
  if (o.parFilHeure >= MAX_PROPOSITIONS_PAR_FIL_HEURE) {
    return `Trop de réponses préparées pour ce fil : ${MAX_PROPOSITIONS_PAR_FIL_HEURE} par heure au plus. Rien n'est proposé, réessaie plus tard.`
  }
  if (o.parCleHeure >= MAX_PROPOSITIONS_PAR_CLE_HEURE) {
    return `Trop de réponses préparées par ta clé : ${MAX_PROPOSITIONS_PAR_CLE_HEURE} par heure au plus. Rien n'est proposé, réessaie plus tard.`
  }
  return null
}

// ---------------------------------------------------------------------------
// 7. La carte et ses boutons (Agent AOK)
// ---------------------------------------------------------------------------

const PARIS = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** « 01/11/2026 à 14:02 », heure de Paris. */
export function heureParis(ms: number): string {
  const p = Object.fromEntries(PARIS.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return `${p.day}/${p.month}/${p.year} à ${p.hour}:${p.minute}`
}

export type EntreeCarte = {
  auteur: AuteurProposition
  fil: FilLu
  /** La reference courte du fil (« fil 1a2b3c4d »). */
  reference: string
  /** Le destinataire en entier (libelleDestinataire). */
  destinataire: string
  dernierMembreT: number
  texte: string
  bot: string
  aVerifier: string[]
  expireT: number
}

/**
 * Le texte de la carte. Premiere ligne voulue par Brice : « Réponse préparée
 * par Tab pour Arthur (fil Support, dernier message du membre le ...) : »,
 * puis le texte tel quel, puis ce que fait Envoyer et l'expiration.
 */
export function texteCarte(e: EntreeCarte): string {
  return [
    `Réponse préparée par ${nomAuteur(e.auteur)} pour ${nomCourt(e.fil)} (fil Support, dernier message du membre le ${heureParis(e.dernierMembreT)}) :`,
    '',
    e.texte,
    '',
    `Pour : ${e.destinataire}, ${e.reference}.`,
    e.fil.attendT !== null
      ? `Il attend un humain depuis le ${heureParis(e.fil.attendT)} : après l'envoi, le fil sort de l'attente.`
      : "Le fil n'attend pas d'humain : la réponse s'ajoute à la conversation.",
    `Envoyer : le bot des membres (@${e.bot.replace(/^@+/, '')}) lui écrit en privé « ${texteReponseEquipe('').trim()} » suivi de ce texte, `
      + "exactement comme depuis l'onglet Support. L'équipe garde la main sur ce fil 24 h.",
    // Borne : 5 signalements de 120 caracteres au plus, la carte reste sous les 4 096 caracteres de Telegram.
    e.aVerifier.length
      ? `À vérifier avant d'envoyer : ${e.aVerifier.slice(0, 5).map((s) => (s.length > 120 ? `${s.slice(0, 117)}...` : s)).join(' ; ')}`
        + `${e.aVerifier.length > 5 ? ` ; et ${e.aVerifier.length - 5} autre(s)` : ''}.`
      : null,
    `Rien ne part sans un clic. Sans clic, la proposition expire le ${heureParis(e.expireT)}.`,
  ].filter((l): l is string => l !== null).join('\n')
}

/** Les donnees des boutons : « tr:e:<uuid> » (Envoyer), « tr:a:<uuid> » (Annuler), 41 octets. */
export function clavierProposition(id: string): { text: string; callback_data: string }[][] {
  return [[
    { text: 'Envoyer', callback_data: `tr:e:${id}` },
    { text: 'Annuler', callback_data: `tr:a:${id}` },
  ]]
}

export type VerbeProposition = 'envoyer' | 'annuler'

/** Un clic sur une carte de proposition, ou null. */
export function lireBoutonProposition(data: unknown): { id: string; verbe: VerbeProposition } | null {
  const m = typeof data === 'string' ? /^tr:([ea]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(data) : null
  return m ? { id: m[2], verbe: m[1] === 'e' ? 'envoyer' : 'annuler' } : null
}

export type DecisionClic = 'introuvable' | 'deja' | 'expiree' | VerbeProposition

/** L'instant ou une proposition faite a `maintenant` expire (millisecondes). */
export function expirationProposition(maintenant: number): number {
  return maintenant + DUREE_PROPOSITION_HEURES * HEURE_MS
}

/** Seule une proposition en attente et pas expiree se decide ; une expiree passe a 'expiree' au clic. */
export function decisionClic(statut: string | null | undefined, expireT: number | null, maintenant: number, verbe: VerbeProposition): DecisionClic {
  if (!statut) return 'introuvable'
  if (statut !== 'proposee') return 'deja'
  if (expireT === null || maintenant >= expireT) return 'expiree'
  return verbe
}

/** Le statut qu'on lit : une proposition en attente dont le delai est passe est expiree. */
export function statutEffectif(statut: string, expireT: number | null, maintenant: number): string {
  return statut === 'proposee' && expireT !== null && maintenant >= expireT ? 'expiree' : statut
}

const STATUT_EN_CLAIR: Record<StatutProposition, string> = {
  proposee: 'en attente de validation par Brice ou Mélanie',
  envoi: "validée, envoi en cours (ou interrompu : rien n'est rejoué seul)",
  envoyee: 'envoyée au membre',
  annulee: "annulée : rien n'est parti",
  expiree: `expirée sans clic (${DUREE_PROPOSITION_HEURES} h) : rien n'est parti`,
  remplacee: "remplacée par une proposition plus récente pour le même fil : rien n'est parti",
  refusee: "refusée au moment de l'envoi : rien n'est parti",
  echec: "envoi impossible : rien n'est parti",
}

export function statutPropositionEnClair(s: string): string {
  return (STATUT_EN_CLAIR as Record<string, string>)[s] ?? s
}

/** La reponse au second clic (ou a un clic tardif). */
export function texteDejaTraite(statut: string | null | undefined, par: string | null | undefined): string {
  if (!statut) return 'Cette proposition est introuvable.'
  const qui = par?.trim() ? ` par ${par.trim()}` : ''
  switch (statut) {
    case 'envoi': return `Déjà traité${qui} : envoi en cours.`
    case 'envoyee': return `Déjà traité${qui} : réponse envoyée.`
    case 'annulee': return `Déjà traité${qui} : proposition annulée, rien n'est parti.`
    case 'refusee': return `Déjà traité${qui} : refusée à l'envoi, rien n'est parti.`
    case 'echec': return `Déjà traité${qui} : l'envoi a échoué, rien n'est parti.`
    case 'expiree': return "Proposition expirée : rien n'est parti."
    case 'remplacee': return "Proposition remplacée par une plus récente : rien n'est parti. Regarde la dernière carte."
    default: return 'Déjà traité.'
  }
}

/** La ligne ajoutee en bas de chaque carte une fois decidee (boutons retires). */
export function finDeCarte(statut: string, par: string | null, issue: string | null = null): string {
  const qui = par ? ` par ${par}` : ''
  switch (statut) {
    case 'envoyee': return `>> Envoyée${qui}.${issue ? ` ${issue}` : ''}`
    case 'annulee': return `>> Annulée${qui} : rien n'est parti.`
    case 'expiree': return `>> Expirée sans clic : rien n'est parti.`
    case 'remplacee': return '>> Remplacée par une proposition plus récente : rien n\'est parti.'
    case 'refusee': return `>> Validée${qui}, mais refusée à l'envoi : rien n'est parti.${issue ? ` ${issue}` : ''}`
    case 'echec': return `>> Validée${qui}, mais l'envoi a échoué : rien n'est parti.${issue ? ` ${issue}` : ''}`
    default: return `>> ${statutPropositionEnClair(statut)}`
  }
}

/** La carte d'origine avec sa ligne de fin, sous la limite de Telegram (4 096 caracteres). */
export function carteDecidee(carte: string, fin: string): string {
  const t = `${carte}\n\n${fin}`
  return t.length <= 4096 ? t : `${carte.slice(0, 4096 - fin.length - 6)}...\n\n${fin}`
}

/** La ligne « [système] » du fil Support, apres l'envoi : la mention interne « via Tab » et qui a valide. */
export function ligneFilEnvoi(auteur: AuteurProposition, par: string): string {
  return `Réponse ci-dessus préparée par ${nomAuteur(auteur)} (via ${nomAuteur(auteur)}, API du cockpit), envoyée sur validation de ${par} dans Agent AOK.`
}

/** Refus au clic Envoyer : l'equipe a repondu au membre depuis la proposition. */
export function refusEquipePlusRapide(qui: string, tEquipe: number): string {
  return `L'équipe a déjà répondu à ${qui} depuis cette proposition (le ${heureParis(tEquipe)}) : rien n'est parti, pour ne pas lui répondre deux fois. `
    + 'Si cette réponse doit quand même partir, demande-la de nouveau.'
}
