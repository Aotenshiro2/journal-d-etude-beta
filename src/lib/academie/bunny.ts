// Liens de lecture signes Bunny Stream (academie, essai du 15/10/2026).
//
// La bibliotheque Bunny a l'authentification par jeton ACTIVE : son lecteur
// (player.mediadelivery.net/embed/...) refuse une video sans jeton valable
// (403 mesure le 12/10, PLAN-ACADEMIE.md section 11). Le jeton vaut
// SHA256_HEX(cle_securite + video_id + expiration), expiration en secondes
// UNIX (doc Bunny, verifiee le 06/10, section 5 du plan). Le lien sert jusqu'a
// l'expiration, puis le lecteur le refuse : la page en redemande un.
//
// La cle (BUNNY_STREAM_TOKEN_KEY, « Token authentication key » de la
// bibliotheque, PAS la cle d'API) ne quitte jamais le serveur : ni dans une
// reponse, ni dans un log. Seuls le jeton derive et l'expiration partent.
//
// Ce module n'importe que node:crypto : scripts/verifier-academie-bunny.mjs
// l'importe tel quel (Node 22 supprime les types tout seul).

import { createHash } from 'node:crypto'

/** Duree d'un lien de lecture : 4 h, de quoi regarder une longue video avec des pauses. */
export const DUREE_LIEN_S = 4 * 3600

const LECTEUR = 'https://player.mediadelivery.net/embed'
const LIBRARY_RE = /^\d{1,12}$/

export type ConfigBunny = { libraryId: string; cle: string }

export type LienSigne = {
  url: string
  /** Expiration en secondes UNIX (celle qui est signee). */
  expiration: number
  /** La meme, en ISO, pour la page. */
  expireLe: string
}

/**
 * BUNNY_STREAM_LIBRARY_ID et BUNNY_STREAM_TOKEN_KEY, ou null si l'une manque
 * ou si l'identifiant n'est pas un nombre (la route repond alors 503). Ne dit
 * jamais laquelle dans une reponse ; le log de la route le dit, sans valeur.
 */
export function configBunny(env: Record<string, string | undefined> = process.env): ConfigBunny | null {
  const libraryId = (env.BUNNY_STREAM_LIBRARY_ID ?? '').trim()
  const cle = (env.BUNNY_STREAM_TOKEN_KEY ?? '').trim()
  if (!LIBRARY_RE.test(libraryId) || !cle) return null
  return { libraryId, cle }
}

/** Le jeton de Bunny : SHA256 en hexadecimal (minuscules) de cle + video + expiration. */
export function jetonLecture(cle: string, videoId: string, expiration: number): string {
  return createHash('sha256').update(`${cle}${videoId}${expiration}`, 'utf8').digest('hex')
}

/** Assemble l'adresse du lecteur pour une configuration donnee. Pure, testee. */
export function lienLecture(config: ConfigBunny, videoId: string, expiration: number): LienSigne {
  const token = jetonLecture(config.cle, videoId, expiration)
  const url = `${LECTEUR}/${encodeURIComponent(config.libraryId)}/${encodeURIComponent(videoId)}`
    + `?token=${token}&expires=${expiration}`
  return { url, expiration, expireLe: new Date(expiration * 1000).toISOString() }
}

/**
 * Le lien signe d'une video, valable dureeSecondes a partir de maintenant.
 * null si la configuration manque (la route en fait un 503). Ne verifie PAS
 * le droit de l'eleve : c'est le travail de la route, avant cet appel.
 */
export function signerLecture(
  videoId: string,
  dureeSecondes: number = DUREE_LIEN_S,
  opts: { config?: ConfigBunny | null; maintenantMs?: number } = {},
): LienSigne | null {
  const config = opts.config === undefined ? configBunny() : opts.config
  if (!config) return null
  const duree = Number.isFinite(dureeSecondes) && dureeSecondes > 0 ? Math.floor(dureeSecondes) : DUREE_LIEN_S
  const expiration = Math.floor((opts.maintenantMs ?? Date.now()) / 1000) + duree
  return lienLecture(config, videoId, expiration)
}
