// Fonctions PURES de la verification par code email du bot Live Club (29/09).
// Aucune base, aucun reseau, aucun import relatif : le script de verification
// local peut importer ce fichier .ts directement (Node 22).
//
// Le code est un secret : jamais dans un log, jamais en base en clair (on n'y
// garde que sha256(sel:code)).

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto'

/** Un code vaut 15 minutes. */
export const CODE_VALIDITE_MINUTES = 15
/** Codes tapes au plus pour un meme code. */
export const CODE_ESSAIS_MAX = 5
/** Codes demandes au plus par heure et par compte Telegram. */
export const CODE_ENVOIS_HEURE = 3
/** Comptes Telegram differents qui peuvent demander un code pour la meme adresse en une heure. */
export const CODE_COMPTES_PAR_EMAIL_HEURE = 3
/**
 * Codes faux au plus par ADRESSE et par heure, tous comptes Telegram
 * confondus. Sans ce plafond, N comptes qui visent la meme adresse feraient
 * N x 15 essais par heure. Au-dela, plus aucun code n'est accepte pour cette
 * adresse jusqu'a la fin de la fenetre.
 */
export const CODE_RATES_PAR_EMAIL_HEURE = 10

/** Un code a 6 chiffres, zeros de tete compris, tire par le generateur cryptographique. */
export function genererCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Un sel neuf par code : 16 octets en hexadecimal. */
export function genererSel(): string {
  return randomBytes(16).toString('hex')
}

/** sha256(sel:code) en hexadecimal (64 caracteres). */
export function hacherCode(code: string, sel: string): string {
  return createHash('sha256').update(`${sel}:${code}`).digest('hex')
}

/**
 * Le code tape correspond-il au hache garde ? Comparaison a temps constant
 * (timingSafeEqual sur les 32 octets). Un hache mal forme = false.
 */
export function codeCorrespond(code: string, sel: string, hache: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(hache)) return false
  const attendu = Buffer.from(hache, 'hex')
  const calcule = Buffer.from(hacherCode(code, sel), 'hex')
  return attendu.length === calcule.length && timingSafeEqual(attendu, calcule)
}

/** Un message plus long n'est pas lu comme une reponse de code. */
const CODE_MESSAGE_MAX = 60

// Adresses email, a mettre de cote avant de chercher un code (« jean123456@x.fr »
// n'est pas un code).
const RE_EMAILS = /[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[A-Za-z]{2,}/g

// Un groupe de 6 chiffres, espace, point ou tiret tolere au milieu, qui n'est
// pas un morceau d'un nombre plus long (telephone, date, numero de facture) :
// ni chiffre ni lettre colle avant ou apres, ni « separateur + chiffre ».
const RE_CODE = /(?<![\dA-Za-z])(?<!\d[\s.-])\d{3}[\s.-]?\d{3}(?![\s.-]?\d)(?![A-Za-z])/g

/**
 * Le code a 6 chiffres d'un message court, ou null. « 123 456 », « 123-456 »
 * et « mon code c'est 482913 » marchent ; un message long, ou qui contient
 * deux groupes de 6 chiffres, n'est pas un code.
 */
export function lireCode(texte: string): string | null {
  const court = texte.trim()
  if (!court || court.length > CODE_MESSAGE_MAX) return null
  const trouves = court.replace(RE_EMAILS, ' ').match(RE_CODE) ?? []
  if (trouves.length !== 1) return null
  return trouves[0].replace(/[\s.-]/g, '')
}

/**
 * Le texte, avec chaque groupe de 6 chiffres remplace par « [code masque] »
 * (les adresses email restent entieres). Pour le fil Support d'un compte non
 * rattache : un code encore valide ne doit pas y etre lisible.
 */
export function masquerCodes(texte: string): string {
  const re = new RegExp(`(${RE_EMAILS.source})|${RE_CODE.source}`, 'g')
  return texte.replace(re, (m: string, email: string | undefined) => (email ? m : '[code masqué]'))
}

/**
 * Le premier morceau du message qui ressemble a une adresse email (brut, a
 * normaliser ensuite), ou null. « mon email c'est jean@exemple.fr » marche
 * aussi.
 */
export function extraireEmail(texte: string): string | null {
  const m = /[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[A-Za-z]{2,}/.exec(texte)
  return m ? m[0].replace(/[.]+$/, '') : null
}

export type IntentionNonRattache =
  | { type: 'code'; code: string }
  | { type: 'email'; brut: string }
  | { type: 'autre' }

/** Ce que veut dire le message d'un compte pas encore rattache. Le code passe avant l'email. */
export function intentionNonRattache(texte: string): IntentionNonRattache {
  const code = lireCode(texte)
  if (code) return { type: 'code', code }
  const brut = extraireEmail(texte)
  if (brut) return { type: 'email', brut }
  return { type: 'autre' }
}
