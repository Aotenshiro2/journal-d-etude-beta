// Ajouter une AUTRE adresse email a son compte AO Knowledge, sur preuve
// (GO de Brice du 31/10/2026) : la partie PURE, sans base ni reseau. Testable
// seule (scripts/verifier-emails-confirmation.mjs) : aucun import relatif.
//
// Le parcours (routes /api/compte/emails/ajouter et /api/compte/emails/confirmer,
// serveur : src/lib/emails-confirmation.ts, migration
// 20261031190000_profile_emails_confirmation.sql) :
// 1. le membre tape une adresse dans Mon espace (Comptes lies, carte
//    « Adresses email ») ; le serveur la normalise (normaliserEmail) et refuse
//    (decisionAjout) son email de connexion, une adresse deja verifiee chez
//    lui, une adresse verifiee ou de connexion d'un AUTRE compte, et les
//    envois au-dela des plafonds (ENVOIS_*) ;
// 2. sinon un code a 6 chiffres part a CETTE adresse ; seul son HMAC est garde
//    (hmacCode, cle derivee d'un secret du serveur), 15 minutes, 5 essais ;
// 3. le membre tape le code : comparaison a temps constant (codeCorrespond) ;
//    juste, l'adresse passe verified = true et ouvre ce qui a ete paye avec
//    elle (academie, Live Club).
//
// Une adresse ajoutee sans preuve n'ouvre rien : sans ca, n'importe qui
// prendrait les achats d'un autre.
//
// Jamais le code ni l'adresse complete dans un log : refAdresse (8 caracteres
// du HMAC de l'adresse) suffit a recouper.

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Longueur maximale d'une adresse (RFC 5321). */
export const EMAIL_MAX = 254
/** Partie locale (avant @) : 64 caracteres au plus. */
export const LOCAL_MAX = 64
/** Au-dela, l'entree n'est meme pas lue. */
export const ENTREE_MAX = 320
/** Corps JSON d'une requete : 2 000 caracteres au plus. */
export const CORPS_MAX = 2000

/** Un code vaut 15 minutes. */
export const CODE_VALIDITE_MINUTES = 15
/** Codes tapes au plus pour un meme code. */
export const CODE_ESSAIS_MAX = 5

/** Envois de code au plus par compte : 5 par heure, 10 par 24 heures. */
export const ENVOIS_COMPTE_HEURE = 5
export const ENVOIS_COMPTE_JOUR = 10
/** Envois au plus vers une meme adresse, tous comptes confondus : 3 par heure, 5 par 24 heures. */
export const ENVOIS_ADRESSE_HEURE = 3
export const ENVOIS_ADRESSE_JOUR = 5
/** Plafond global (tous comptes, toutes adresses) : 100 envois par heure. */
export const ENVOIS_TOTAL_HEURE = 100

export const SUPPORT = 'support@aoknowledge.com'
export const EXPEDITEUR = 'AO Knowledge <support@aoknowledge.com>'
/** (30/10, brief F1) Un email vouvoie et se signe « Brice et Mélanie ». */
export const SIGNATURE = ['À bientôt,', 'Brice et Mélanie'] as const

// ---------------------------------------------------------------------------
// Entrees
// ---------------------------------------------------------------------------

// Partie locale : lettres, chiffres, . _ + ' - (pas de point en tete, en fin
// ni double). Domaine : etiquettes de lettres, chiffres et tirets (pas en tete
// ni en fin), au moins deux, la derniere alphabetique ou en punycode.
const RE_LOCAL = /^[a-z0-9_+'-]+(?:\.[a-z0-9_+'-]+)*$/
const RE_ETIQUETTE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const RE_TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

/**
 * L'adresse normalisee (trim + minuscules), ou null. Stricte : ASCII
 * imprimable seulement (aucun espace, retour a la ligne, caractere de
 * controle ou invisible a l'interieur), une seule @, 254 caracteres au plus.
 * Le test ASCII passe AVANT la mise en minuscules : certains caracteres
 * Unicode deviennent des lettres ASCII une fois en minuscules (le signe
 * Kelvin devient « k »).
 */
export function normaliserEmail(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > ENTREE_MAX) return null
  const brut = v.trim()
  if (!/^[\x21-\x7e]+$/.test(brut)) return null
  const e = brut.toLowerCase()
  if (e.length < 6 || e.length > EMAIL_MAX) return null
  const at = e.indexOf('@')
  if (at < 1 || at !== e.lastIndexOf('@')) return null
  const local = e.slice(0, at)
  const domaine = e.slice(at + 1)
  if (local.length > LOCAL_MAX || !RE_LOCAL.test(local)) return null
  if (domaine.length > 253) return null
  const etiquettes = domaine.split('.')
  if (etiquettes.length < 2 || !etiquettes.every(x => RE_ETIQUETTE.test(x))) return null
  if (!RE_TLD.test(etiquettes[etiquettes.length - 1])) return null
  return e
}

/** Le code tape : 6 chiffres, « 123 456 » et « 123-456 » acceptes. Sinon null. */
export function lireCode(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 20) return null
  const c = v.trim()
  if (!/^[0-9]{3}[ -]?[0-9]{3}$/.test(c)) return null
  return c.replace(/[ -]/g, '')
}

/** Le corps JSON d'une requete (objet), ou null : trop long, illisible, pas un objet. */
export function lireCorps(brut: string): Record<string, unknown> | null {
  if (brut.length > CORPS_MAX) return null
  try {
    const o: unknown = JSON.parse(brut || '{}')
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Code et HMAC
// ---------------------------------------------------------------------------

/** Un code a 6 chiffres, zeros de tete compris, tire par le generateur cryptographique. */
export function genererCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

// Une cle par usage, derivee du secret du serveur : le HMAC d'un code ne sert
// jamais a autre chose, et le secret lui-meme n'est jamais la cle directe.
const USAGE_CODE = 'aok/profile_emails/code/v1'
const USAGE_ADRESSE = 'aok/profile_emails/adresse/v1'

function cleDerivee(secret: string, usage: string): Buffer {
  return createHmac('sha256', secret).update(usage, 'utf8').digest()
}

/** HMAC-SHA256 du code, lie au compte ET a l'adresse (64 caracteres hexadecimaux). */
export function hmacCode(secret: string, profileId: string, email: string, code: string): string {
  return createHmac('sha256', cleDerivee(secret, USAGE_CODE))
    .update(`${profileId.toLowerCase()}|${email}|${code}`, 'utf8')
    .digest('hex')
}

/** HMAC-SHA256 de l'adresse : la cle du compteur d'envois par adresse (jamais l'adresse en clair). */
export function hmacAdresse(secret: string, email: string): string {
  return createHmac('sha256', cleDerivee(secret, USAGE_ADRESSE)).update(email, 'utf8').digest('hex')
}

/** 8 caracteres du HMAC de l'adresse : de quoi recouper deux lignes de log, rien de plus. */
export const refAdresse = (hmac: string) => hmac.slice(0, 8)

/**
 * Le code tape correspond-il au HMAC garde ? Comparaison a temps constant
 * (timingSafeEqual sur les 32 octets). Un HMAC absent ou mal forme = false.
 */
export function codeCorrespond(secret: string, profileId: string, email: string, code: string, attendu: string | null): boolean {
  if (!attendu || !/^[0-9a-f]{64}$/.test(attendu)) return false
  const a = Buffer.from(attendu, 'hex')
  const c = Buffer.from(hmacCode(secret, profileId, email, code), 'hex')
  return a.length === c.length && timingSafeEqual(a, c)
}

// ---------------------------------------------------------------------------
// Regles
// ---------------------------------------------------------------------------

/** Les envois deja faits (compteur serveur profile_emails_envois). */
export type Envois = {
  compteHeure: number
  compteJour: number
  adresseHeure: number
  adresseJour: number
  totalHeure: number
}

/** Un envoi de plus depasserait-il un plafond ? */
export function limiteAtteinte(e: Envois): boolean {
  return e.compteHeure >= ENVOIS_COMPTE_HEURE
    || e.compteJour >= ENVOIS_COMPTE_JOUR
    || e.adresseHeure >= ENVOIS_ADRESSE_HEURE
    || e.adresseJour >= ENVOIS_ADRESSE_JOUR
    || e.totalHeure >= ENVOIS_TOTAL_HEURE
}

/** Ce que la base dit de l'adresse demandee, lu sous verrou. */
export type EtatAjout = {
  /** L'adresse demandee, normalisee. */
  email: string
  /** L'email de connexion du compte (auth.users), en minuscules, ou null. */
  emailConnexion: string | null
  /** Ligne verified = true sur CE compte. */
  verifieeIci: boolean
  /** Ligne verified = true sur un AUTRE compte. */
  verifieeAilleurs: boolean
  /** Email de connexion d'un AUTRE compte. */
  connexionAilleurs: boolean
  envois: Envois
}

export type DecisionAjout = 'ok' | 'connexion' | 'deja_verifiee' | 'rattachee' | 'limite'

/**
 * Faut-il envoyer un code ? Dans l'ordre : l'email de connexion du compte,
 * une adresse deja verifiee chez lui, une adresse prise par un autre compte
 * (verifiee ou de connexion : le meme refus qu'avant, sans dire laquelle des
 * deux), puis les plafonds d'envoi. Une ligne NON verifiee d'un autre compte
 * n'empeche rien : le vrai titulaire doit pouvoir prouver son adresse.
 */
export function decisionAjout(s: EtatAjout): DecisionAjout {
  if (s.emailConnexion && s.emailConnexion.trim().toLowerCase() === s.email) return 'connexion'
  if (s.verifieeIci) return 'deja_verifiee'
  if (s.verifieeAilleurs || s.connexionAilleurs) return 'rattachee'
  if (limiteAtteinte(s.envois)) return 'limite'
  return 'ok'
}

/** La ligne en attente du compte pour cette adresse, lue sous verrou (expire selon l'horloge de la base). */
export type LigneAttente = { codeHmac: string | null; expire: boolean; essais: number }

export type EtatEssai = 'essai' | 'aucun' | 'epuise' | 'expire'

/** Peut-on compter un essai ? 'aucun' = pas de code en cours (jamais envoye, efface, envoi rate). */
export function etatEssai(l: LigneAttente | null): EtatEssai {
  if (!l || !l.codeHmac) return 'aucun'
  if (l.essais >= CODE_ESSAIS_MAX) return 'epuise'
  if (l.expire) return 'expire'
  return 'essai'
}

/** Essais restants une fois l'essai courant compte. */
export const essaisRestants = (essaisApres: number) => Math.max(0, CODE_ESSAIS_MAX - essaisApres)

/**
 * Code juste : l'adresse peut-elle passer verifiee sur ce compte ? Relu sous
 * le verrou de l'adresse au moment de confirmer : une adresse verifiee ou de
 * connexion d'un autre compte n'est JAMAIS deplacee.
 */
export function decisionConfirmation(s: { verifieeAilleurs: boolean; connexionAilleurs: boolean }): 'ok' | 'rattachee' {
  return s.verifieeAilleurs || s.connexionAilleurs ? 'rattachee' : 'ok'
}

// ---------------------------------------------------------------------------
// L'email du code
// ---------------------------------------------------------------------------

/**
 * Le seul texte venu du membre est l'adresse elle-meme (deja normalisee,
 * echappee au rendu). Aucun lien : le membre tape le code dans Mon espace.
 */
export type ModeleEmailCode = { sujet: string; avant: string[]; code: string; apres: string[] }

export function modeleEmailCode(email: string, code: string): ModeleEmailCode {
  return {
    sujet: `Votre code AO Knowledge : ${code}`,
    avant: [
      'Bonjour,',
      `Une demande a été faite pour ajouter l'adresse ${email} à un compte AO Knowledge. Si elle vient de vous, voici votre code :`,
    ],
    code,
    apres: [
      `Tapez-le dans Mon espace, carte « Adresses email ». Il marche ${CODE_VALIDITE_MINUTES} minutes.`,
      "Vous n'avez rien demandé ? Ne faites rien : sans ce code, l'adresse n'est pas ajoutée. Et ne donnez ce code à personne, même à quelqu'un qui se présente comme l'équipe.",
      `Une question ? Écrivez à ${SUPPORT}.`,
    ],
  }
}

export function echapper(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Meme gabarit sobre que les emails d'achat (club-paypal-pur.ts), sans bouton ni lien. */
export function htmlEmailCode(m: ModeleEmailCode): string {
  const p = (t: string) => `<p style="margin:0 0 16px;line-height:1.5">${echapper(t)}</p>`
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#ffffff;color:#111827;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px">
<div style="max-width:560px;margin:0 auto">
${m.avant.map(p).join('\n')}
<p style="margin:8px 0 24px;font-size:28px;font-weight:700;letter-spacing:6px;font-family:Menlo,Consolas,monospace">${echapper(m.code)}</p>
${m.apres.map(p).join('\n')}
<p style="margin:32px 0 0;line-height:1.5">${SIGNATURE.map(echapper).join('<br>')}</p>
</div></body></html>`
}

export function texteEmailCode(m: ModeleEmailCode): string {
  return [...m.avant, m.code, ...m.apres, SIGNATURE.join('\n')].join('\n\n')
}
