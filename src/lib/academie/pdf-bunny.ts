// Liens signes des PDF payants de l'academie sur Bunny CDN (23/10/2026).
//
// Les PDF des modules payants quittent Supabase Storage (quota de trafic) pour
// la Storage Zone Bunny « aok-academie-pdfs », servie par la Pull Zone
// aok-academie-pdfs.b-cdn.net, authentification par jeton ACTIVE : un lien
// sans jeton valable, expire, ou signe pour un autre fichier repond 403.
// Les chemins sont ceux du bucket Supabase (academie_lecons.ressources ne
// change pas) : scripts/migrer-ressources-vers-bunny.mjs les a recopies tels
// quels.
//
// Jeton (doc Bunny « Token Authentication - Advanced », lue le 23/10/2026, et
// depot officiel BunnyWay/BunnyCDN.TokenAuthentication, dont le vecteur
// « plain » est teste dans scripts/verifier-academie.mjs) :
//   "HS256-" + base64url(HMAC-SHA256(cle, chemin + expiration)), sans « = »
// chemin = celui de l'URL (« /formation-complete/ep-01.pdf »), expiration en
// secondes UNIX ; ni IP, ni pays, ni token_path. Lien :
//   https://<hote>/<chemin>?token=<jeton>&expires=<expiration>
//
// La cle (BUNNY_PDF_CLE_JETON, « Token Authentication Key » de la Pull Zone,
// PAS le mot de passe de la Storage Zone) ne quitte jamais le serveur : ni
// dans une reponse, ni dans un log. Seuls le jeton derive et l'expiration
// partent.
//
// Ce module n'importe que node:crypto : les scripts Node l'importent tel quel
// (Node 22 supprime les types tout seul).

import { createHmac } from 'node:crypto'

/** Duree d'un lien de PDF : 5 minutes, de quoi ouvrir le document (le telechargement commence avant). */
export const DUREE_URL_PDF_S = 5 * 60

const HOTE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
// Meme forme que cheminFichierPropre (pur.ts) : segments propres, ni « .. »,
// ni chemin absolu. Repetee ici pour garder ce module sans import.
const FICHIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/

export type ConfigPdfBunny = { hote: string; cle: string }

export type LienPdf = {
  url: string
  /** Expiration en secondes UNIX (celle qui est signee). */
  expiration: number
  /** La meme, en ISO, pour la page. */
  expireLe: string
}

/**
 * BUNNY_PDF_HOTE (nom de la Pull Zone, ex. aok-academie-pdfs.b-cdn.net) et
 * BUNNY_PDF_CLE_JETON :
 * - 'absente' : aucune des deux, la route se replie sur Supabase Storage
 *   (pendant la bascule, a retirer ensuite) ;
 * - 'mal_posee' : l'une sans l'autre, ou un hote illisible : la route repond
 *   503 'config' plutot que de servir l'ancienne voie en silence ;
 * - sinon la configuration (hote sans https:// ni « / » final, en minuscules).
 */
export function configPdfBunny(env: Record<string, string | undefined> = process.env): ConfigPdfBunny | 'absente' | 'mal_posee' {
  const hoteBrut = (env.BUNNY_PDF_HOTE ?? '').trim()
  const cle = (env.BUNNY_PDF_CLE_JETON ?? '').trim()
  if (!hoteBrut && !cle) return 'absente'
  const hote = hoteBrut.replace(/^https:\/\//i, '').replace(/\/+$/, '').toLowerCase()
  if (!HOTE_RE.test(hote) || hote.length > 253 || cle.length < 8) return 'mal_posee'
  return { hote, cle }
}

/** Le jeton de Bunny CDN (HMAC-SHA256, base64url sans « = », prefixe HS256-). cheminUrl commence par « / ». */
export function jetonPdf(cle: string, cheminUrl: string, expiration: number): string {
  const mac = createHmac('sha256', cle).update(`${cheminUrl}${expiration}`, 'utf8').digest('base64')
  return 'HS256-' + mac.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Le lien signe d'un fichier de la Storage Zone (chemin du bucket, sans « / »
 * au debut), ou null si le chemin n'est pas propre. Pure, testee.
 */
export function lienPdf(config: ConfigPdfBunny, fichier: string, expiration: number): LienPdf | null {
  if (typeof fichier !== 'string' || fichier.length > 300 || !FICHIER_RE.test(fichier)) return null
  const chemin = `/${fichier}`
  const url = `https://${config.hote}${chemin}?token=${jetonPdf(config.cle, chemin, expiration)}&expires=${expiration}`
  return { url, expiration, expireLe: new Date(expiration * 1000).toISOString() }
}

/**
 * Le lien signe d'un PDF, valable dureeSecondes (5 min par defaut) a partir de
 * maintenant. Ne verifie PAS le droit de l'eleve (travail de la route), ni que
 * le fichier est bien sur Bunny (un absent repond 404 chez Bunny).
 */
export function signerPdf(
  fichier: string,
  config: ConfigPdfBunny,
  opts: { dureeSecondes?: number; maintenantMs?: number } = {},
): LienPdf | null {
  const d = opts.dureeSecondes
  const duree = d !== undefined && Number.isFinite(d) && d > 0 ? Math.floor(d) : DUREE_URL_PDF_S
  const expiration = Math.floor((opts.maintenantMs ?? Date.now()) / 1000) + duree
  return lienPdf(config, fichier, expiration)
}
