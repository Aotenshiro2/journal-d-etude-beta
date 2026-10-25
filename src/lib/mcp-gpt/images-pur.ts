// LES IMAGES DE BELRIVE DEPOSEES PAR CHATGPT (25/10/2026) : les regles PURES.
//
// ChatGPT prepare des visuels pour Belrive (un decor, des leurres) et les
// depose par l'outil deposer_image du connecteur MCP (src/lib/mcp-gpt/pur.ts).
// Trois facons de passer l'image, dans cet ordre :
// 1. le champ image, declare dans _meta["openai/fileParams"] : ChatGPT y met
//    un fichier de la conversation sous la forme { download_url, file_id,
//    mime_type?, file_name? } (doc OpenAI Apps SDK, reference, « File params ») ;
// 2. url : une adresse https publique de l'image ;
// 3. donnees_base64 : l'image en base64 (petite image seulement : le corps
//    HTTP d'un appel tient en 1 Mo).
// Le serveur telecharge lui-meme (src/lib/mcp-gpt/telechargement.ts) : https
// seulement, aucune adresse privee ou locale (verifiee sur l'adresse
// REELLEMENT jointe, a chaque redirection), 8 Mo au plus, type verifie sur les
// premiers octets (png, jpeg, webp, gif), jamais sur ce que l'appel annonce.
//
// Stockage : bucket Supabase PRIVE belrive-images, chemin derive de
// l'empreinte sha256 des octets (belrive/<2 premiers>/<empreinte>.<ext>) :
// deux depots du meme fichier n'en font qu'un, et rien n'est jamais ecrase.
// Table de suivi : cockpit_perso_images (migration 20261025120000).
//
// Ce fichier n'importe que node:crypto et node:net : scripts/verifier-images-belrive.mjs
// le charge tel quel.

import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

export const BUCKET_IMAGES = 'belrive-images'
/** 8 Mo, la meme borne que le bucket (file_size_limit) et la table. */
export const IMAGE_MAX_OCTETS = 8 * 1024 * 1024
/** donnees_base64 : 600 000 octets decodes au plus (environ 800 000 caracteres, sous le 1 Mo du corps). */
export const BASE64_MAX_OCTETS = 600_000
export const TITRE_IMAGE_MAX = 200
export const ROLE_MAX = 300
export const NOM_FICHIER_MAX = 80
export const URL_MAX = 4000
export const DELAI_TELECHARGEMENT_MS = 15_000
export const REDIRECTIONS_MAX = 3
/** Une URL signee donnee a Tab : 5 minutes. */
export const DUREE_URL_IMAGE_S = 300

export type TypeImage = { mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; ext: 'png' | 'jpg' | 'webp' | 'gif' }

export type SourceImage =
  | { genre: 'fichier'; url: string; fileId: string; nom: string | null }
  | { genre: 'url'; url: string; nom: string | null }
  | { genre: 'base64'; octets: Buffer; nom: null }

// ---------------------------------------------------------------------------
// Les octets magiques
// ---------------------------------------------------------------------------

/** Le type d'une image d'apres ses premiers octets. null = ni png, ni jpeg, ni webp, ni gif. */
export function detecterImage(o: Uint8Array): TypeImage | null {
  const a = (i: number) => o[i]
  const ascii = (debut: number, texte: string) => [...texte].every((c, i) => o[debut + i] === c.charCodeAt(0))
  if (o.length >= 8 && a(0) === 0x89 && ascii(1, 'PNG') && a(4) === 0x0d && a(5) === 0x0a && a(6) === 0x1a && a(7) === 0x0a) {
    return { mime: 'image/png', ext: 'png' }
  }
  if (o.length >= 4 && a(0) === 0xff && a(1) === 0xd8 && a(2) === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (o.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { mime: 'image/webp', ext: 'webp' }
  if (o.length >= 6 && (ascii(0, 'GIF87a') || ascii(0, 'GIF89a'))) return { mime: 'image/gif', ext: 'gif' }
  return null
}

/** Des octets recus : une image acceptable, ou la raison du refus (en clair pour ChatGPT). */
export function validerOctets(o: Uint8Array): { ok: true; type: TypeImage } | { ok: false; raison: string } {
  if (o.length === 0) return { ok: false, raison: 'image vide (0 octet).' }
  if (o.length > IMAGE_MAX_OCTETS) return { ok: false, raison: `image trop lourde : 8 Mo au plus (reçu ${o.length} octets).` }
  const type = detecterImage(o)
  if (!type) return { ok: false, raison: 'ce fichier n\'est pas une image png, jpeg, webp ou gif (vérifié sur ses premiers octets).' }
  return { ok: true, type }
}

export function empreinteOctets(o: Uint8Array): string {
  return createHash('sha256').update(o).digest('hex')
}

/** Le chemin dans le bucket : derive de l'empreinte, donc jamais deux fichiers au meme endroit. */
export function cheminStockage(empreinte: string, ext: TypeImage['ext']): string {
  if (!/^[0-9a-f]{64}$/.test(empreinte)) throw new Error('empreinte invalide')
  return `belrive/${empreinte.slice(0, 2)}/${empreinte}.${ext}`
}

// ---------------------------------------------------------------------------
// Les noms
// ---------------------------------------------------------------------------

function nu(s: string): string {
  return s.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Le nom de fichier rangé sur le PC : le nom souhaite (ou celui du fichier, ou
 * le titre), sans dossier, sans accents, en minuscules, lettres, chiffres,
 * points, tirets et soulignes, 80 caracteres au plus, avec l'extension du
 * VRAI type (celle annoncee est retiree).
 */
export function assainirNomFichier(souhaits: (string | null | undefined)[], ext: TypeImage['ext']): string {
  for (const s of souhaits) {
    if (typeof s !== 'string') continue
    let n = s.trim().replace(/\\/g, '/').split('/').pop() ?? ''
    n = nu(n).replace(/\.(png|jpe?g|webp|gif|bmp|tiff?|heic|avif|svg)$/i, '')
    n = n.replace(/[^a-z0-9._-]+/g, '-').replace(/[-.]{2,}/g, '-').replace(/^[-._]+|[-._]+$/g, '')
    n = n.slice(0, NOM_FICHIER_MAX - ext.length - 1).replace(/[-._]+$/g, '')
    if (n) return `${n}.${ext}`
  }
  return `image.${ext}`
}

// ---------------------------------------------------------------------------
// Les adresses : anti-SSRF
// ---------------------------------------------------------------------------

function v4EnNombre(ip: string): number {
  return ip.split('.').reduce((acc, p) => acc * 256 + Number(p), 0)
}

const PLAGES_V4: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]

function v4Interdite(ip: string): boolean {
  const n = v4EnNombre(ip)
  return PLAGES_V4.some(([base, bits]) => {
    const taille = 2 ** (32 - bits)
    const b = v4EnNombre(base)
    return n >= b && n < b + taille
  })
}

/** Les 8 groupes de 16 bits d'une IPv6 (avec un eventuel suffixe IPv4). null si illisible. */
function groupesV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (v4) {
    if (isIP(v4[1]) !== 4) return null
    const n = v4EnNombre(v4[1])
    s = s.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const moities = s.split('::')
  if (moities.length > 2) return null
  const lire = (x: string) => (x ? x.split(':').map((g) => parseInt(g, 16)) : [])
  const gauche = lire(moities[0])
  const droite = moities.length === 2 ? lire(moities[1]) : []
  const manque = 8 - gauche.length - droite.length
  if (moities.length === 1 ? manque !== 0 : manque < 1) return null
  const g = [...gauche, ...Array(moities.length === 2 ? manque : 0).fill(0), ...droite]
  return g.length === 8 && g.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? g : null
}

/**
 * Une adresse IP qu'on ne joint jamais : privee, locale, lien local,
 * reservee, documentation, multidiffusion, partagee (CGNAT), et en IPv6 tout
 * ce qui n'est pas unicast global (2000::/3), plus les formes qui cachent une
 * IPv4 (::ffff:, NAT64, 6to4, Teredo) quand l'IPv4 cachee est interdite (Teredo : toujours).
 * Une chaine qui n'est pas une IP : interdite aussi (prudence).
 */
export function adresseInterdite(ip: string): boolean {
  const famille = isIP(ip.split('%')[0])
  if (famille === 4) return v4Interdite(ip)
  if (famille !== 6) return true
  const g = groupesV6(ip)
  if (!g) return true
  const v4De = (hi: number, lo: number) => `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`
  // ::ffff:a.b.c.d (IPv4 mappee) et ::a.b.c.d (compatible, obsolete).
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return true // :: et ::1
    return v4Interdite(v4De(g[6], g[7]))
  }
  // NAT64 64:ff9b::/96 et 64:ff9b:1::/48.
  if (g[0] === 0x64 && g[1] === 0xff9b) return v4Interdite(v4De(g[6], g[7]))
  // 6to4 2002::/16 : l'IPv4 est dans les groupes 1 et 2.
  if (g[0] === 0x2002) return v4Interdite(v4De(g[1], g[2]))
  // Teredo 2001::/32 et documentation 2001:db8::/32 : refuses.
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true
  // Unicast global seulement (2000::/3) : exclut fc00::/7, fe80::/10, ff00::/8, etc.
  return (g[0] & 0xe000) !== 0x2000
}

const HOTES_INTERDITS = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|arpa)$/i

/** Une adresse de telechargement acceptable : https, port 443, sans identifiants, hote public. */
export function verifierUrl(brute: string): { ok: true; url: URL } | { ok: false; raison: string } {
  const s = brute.trim()
  if (!s) return { ok: false, raison: 'adresse vide.' }
  if (s.length > URL_MAX) return { ok: false, raison: `adresse trop longue (${URL_MAX} caractères au plus).` }
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return { ok: false, raison: 'adresse illisible.' }
  }
  if (u.protocol !== 'https:') return { ok: false, raison: 'seules les adresses https sont acceptées.' }
  if (u.username || u.password) return { ok: false, raison: 'adresse avec identifiants refusée.' }
  if (u.port && u.port !== '443') return { ok: false, raison: 'seul le port 443 est accepté.' }
  const hote = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!hote) return { ok: false, raison: 'adresse sans hôte.' }
  if (isIP(hote)) {
    if (adresseInterdite(hote)) return { ok: false, raison: 'adresse privée ou locale refusée.' }
  } else if (HOTES_INTERDITS.test(hote) || !hote.includes('.')) {
    return { ok: false, raison: 'hôte local refusé.' }
  }
  return { ok: true, url: u }
}

// ---------------------------------------------------------------------------
// Les arguments de deposer_image
// ---------------------------------------------------------------------------

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const CHEMIN_CONTENEUR = /^(sandbox:)?\/?mnt\/data\//i

/** donnees_base64 (avec ou sans prefixe data:image/...;base64,) en octets, ou la raison du refus. */
export function decoderBase64(brut: string): { ok: true; octets: Buffer } | { ok: false; raison: string } {
  const s = brut.trim().replace(/^data:[a-z0-9.+/-]*;base64,/i, '').replace(/\s+/g, '')
  if (!s) return { ok: false, raison: 'donnees_base64 vide.' }
  if (s.length > Math.ceil(BASE64_MAX_OCTETS / 3) * 4 + 4) {
    return { ok: false, raison: `donnees_base64 trop long : ${BASE64_MAX_OCTETS} octets décodés au plus. Pour une image plus lourde, passe-la dans le champ image ou par une url https.` }
  }
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return { ok: false, raison: 'donnees_base64 : ce n\'est pas du base64.' }
  const octets = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (octets.length > BASE64_MAX_OCTETS) return { ok: false, raison: `donnees_base64 trop long : ${BASE64_MAX_OCTETS} octets décodés au plus.` }
  return { ok: true, octets }
}

/**
 * La source de l'image : le champ image (fichier de la conversation, par
 * fileParams), sinon url, sinon donnees_base64. Un chemin /mnt/data/... recu
 * tel quel veut dire que ChatGPT n'a pas transforme le fichier : on le dit.
 */
export function lireSourceImage(a: Record<string, unknown>): { ok: true; source: SourceImage } | { ok: false; raison: string } {
  const img = a.image ?? a.fichier ?? a.file
  if (img !== undefined && img !== null && img !== '') {
    if (estObjet(img)) {
      const url = typeof img.download_url === 'string' ? img.download_url : ''
      const fileId = typeof img.file_id === 'string' ? img.file_id : ''
      if (!url) return { ok: false, raison: 'image : download_url manquant. Passe le fichier de la conversation dans le champ image, ou donne une url https.' }
      const nom = typeof img.file_name === 'string' ? img.file_name : null
      return { ok: true, source: { genre: 'fichier', url, fileId: fileId.slice(0, 200), nom } }
    }
    if (typeof img === 'string') {
      const s = img.trim()
      if (/^https:\/\//i.test(s)) return { ok: true, source: { genre: 'url', url: s, nom: null } }
      if (CHEMIN_CONTENEUR.test(s)) {
        return { ok: false, raison: 'image : un chemin /mnt/data/... ne se télécharge pas depuis le serveur Belrive. Rappelle deposer_image en joignant le fichier lui-même dans le champ image (ChatGPT le transmet alors avec un lien de téléchargement), ou passe une url https publique, ou donnees_base64 pour une petite image.' }
      }
      return { ok: false, raison: 'image : un fichier de la conversation est attendu (objet { download_url, file_id }).' }
    }
    return { ok: false, raison: 'image : un fichier de la conversation est attendu (objet { download_url, file_id }).' }
  }
  if (typeof a.url === 'string' && a.url.trim()) {
    const s = a.url.trim()
    if (CHEMIN_CONTENEUR.test(s)) return lireSourceImage({ image: s })
    return { ok: true, source: { genre: 'url', url: s, nom: null } }
  }
  if (typeof a.donnees_base64 === 'string' && a.donnees_base64.trim()) {
    const d = decoderBase64(a.donnees_base64)
    if (!d.ok) return d
    return { ok: true, source: { genre: 'base64', octets: d.octets, nom: null } }
  }
  return { ok: false, raison: 'aucune image : passe le fichier dans le champ image, ou une url https, ou donnees_base64 (petite image).' }
}

/** Le nom de l'image dans une adresse (le dernier segment du chemin), pour proposer un nom de fichier. */
export function nomDansUrl(u: string): string | null {
  try {
    const dernier = new URL(u).pathname.split('/').filter(Boolean).pop()
    return dernier ? decodeURIComponent(dernier) : null
  } catch {
    return null
  }
}
