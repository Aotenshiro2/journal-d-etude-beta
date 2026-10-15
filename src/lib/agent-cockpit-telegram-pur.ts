// Fonctions PURES du canal Telegram de l'agent du Cockpit (15/10) : aucune
// base, aucun reseau, aucun import. scripts/verifier-liveclub.mjs les charge
// telles quelles.
//
// LE BUG REEL (Brice, 15/10) : Agent AOK ne lisait que message.text. Une
// photo, sa legende, une capture envoyee en fichier, un message transfere qui
// porte une image : ignores EN SILENCE (pas meme l'accuse « Je verifie »). Brice
// avait transfere a l'agent une capture recue de Melanie (paiements Stripe),
// l'agent avait repondu au commentaire seul : « Je ne reçois aucune image ».
// Puis la photo seule, legendee « Voici l'image » : aucune reponse.
//
// Ce module lit un message Telegram (texte, legende, photo, document image,
// transfert, album) et prepare ce que voit le modele. Le telechargement de
// l'image et l'appel au modele vivent dans agent-cockpit-telegram.ts.

/** Les images que le modele lit, et qu'on accepte d'un document Telegram. */
export type TypeImage = 'image/jpeg' | 'image/png' | 'image/webp'
export const TYPES_IMAGE_LUS: readonly TypeImage[] = ['image/jpeg', 'image/png', 'image/webp']

/**
 * Poids maximal d'une image, en octets du FICHIER. L'API d'Anthropic refuse
 * une image de plus de 5 Mo une fois encodee en base64 (5 242 880 octets), et
 * le base64 pese les 4/3 du fichier : 3 750 000 octets donnent 5 000 000 de
 * caracteres, sous la limite. Au-dela, on le dit en clair, sans appeler le
 * modele.
 */
export const MAX_OCTETS_IMAGE = 3_750_000

/** Le texte (ou la legende) d'un message, comme avant pour le texte. */
export const MAX_TEXTE_MESSAGE = 4000

/** La trace d'une image dans l'historique : jamais le base64. */
export const TRACE_IMAGE = '[image envoyée]'
export const TRACE_IMAGE_ALBUM = "[image envoyée, une photo d'un album]"

// ---------------------------------------------------------------------------
// Formes minimales d'un message Telegram (Bot API 7 et plus : forward_origin ;
// les anciens champs forward_* sont lus aussi).
// ---------------------------------------------------------------------------

export type UtilisateurTgLu = { id?: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string }
export type ChatTgLu = { id?: number; type?: string; title?: string; username?: string; first_name?: string; last_name?: string }
export type TaillePhotoTg = { file_id?: string; width?: number; height?: number; file_size?: number }
export type DocumentTg = { file_id?: string; file_name?: string; mime_type?: string; file_size?: number }
/** MessageOrigin : 'user', 'hidden_user', 'chat' ou 'channel'. */
export type OrigineTg = {
  type?: string
  sender_user?: UtilisateurTgLu
  sender_user_name?: string
  sender_chat?: ChatTgLu
  chat?: ChatTgLu
  author_signature?: string
}

export type MessageTgLu = {
  text?: string
  caption?: string
  photo?: TaillePhotoTg[]
  document?: DocumentTg
  media_group_id?: string
  forward_origin?: OrigineTg
  forward_from?: UtilisateurTgLu
  forward_from_chat?: ChatTgLu
  forward_sender_name?: string
  forward_signature?: string
  forward_date?: number
  // Ce qu'on ne lit pas (seule la presence compte).
  voice?: unknown
  audio?: unknown
  video?: unknown
  video_note?: unknown
  animation?: unknown
  sticker?: unknown
  location?: unknown
  venue?: unknown
  contact?: unknown
  poll?: unknown
  story?: unknown
}

/** L'image a recuperer chez Telegram (getFile), avant tout telechargement. */
export type ImageALire = {
  fileId: string
  source: 'photo' | 'document'
  /** Le type annonce par Telegram ; celui qui part au modele vient des octets. */
  typeAnnonce: TypeImage | null
  /** Le poids annonce par Telegram, quand il le donne. */
  taille: number | null
}

/**
 * Ce qu'un message apporte a l'agent :
 * - 'contenu' : du texte (ou une legende) et/ou une image a lire ;
 * - 'trop_gros' : une image au-dela de MAX_OCTETS_IMAGE (reponse en clair) ;
 * - 'non_lu' : un contenu que l'agent ne lit pas (vocal, video, PDF...) ;
 * - 'vide' : rien d'utile (message de service, texte vide).
 */
export type LectureMessageTg =
  | {
      genre: 'contenu'
      texte: string
      /** null = pas un transfert ; '' = transfert d'un expediteur inconnu. */
      transfert: string | null
      image: ImageALire | null
      /** Une photo d'un album (plusieurs photos, meme media_group_id). */
      album: boolean
    }
  | { genre: 'trop_gros'; taille: number }
  | { genre: 'non_lu'; quoi: string }
  | { genre: 'vide' }

// Caracteres de controle et invisibles (dont les inversions de sens d'ecriture),
// construits par leur code pour qu'aucun ne figure en clair dans ce fichier.
const INVISIBLES = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
  .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`, 'g')

/** Un nom tape par un tiers : une ligne, sans caractere de controle, 80 caracteres au plus. */
export function nomPropre(brut: unknown): string {
  if (typeof brut !== 'string') return ''
  return brut.replace(INVISIBLES, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 80).trim()
}

function nomUtilisateur(u: UtilisateurTgLu | undefined): string {
  if (!u || typeof u !== 'object') return ''
  const nom = nomPropre([u.first_name, u.last_name].filter(Boolean).join(' '))
  const pseudo = nomPropre(u.username)
  if (nom && pseudo) return `${nom} (@${pseudo})`
  return nom || (pseudo ? `@${pseudo}` : '')
}

function nomChat(c: ChatTgLu | undefined, signature: unknown): string {
  if (!c || typeof c !== 'object') return nomPropre(signature)
  const titre = nomPropre(c.title) || nomPropre([c.first_name, c.last_name].filter(Boolean).join(' '))
  const pseudo = nomPropre(c.username)
  const base = titre && pseudo ? `${titre} (@${pseudo})` : titre || (pseudo ? `@${pseudo}` : '')
  const sig = nomPropre(signature)
  return sig && base ? `${base}, signé ${sig}` : base || sig
}

/**
 * Qui a ecrit le message transfere : null si ce n'est pas un transfert, ''
 * si l'expediteur n'est pas connu. forward_origin d'abord (Bot API 7), les
 * anciens champs forward_* ensuite.
 */
export function nomTransfert(m: MessageTgLu): string | null {
  const o = m.forward_origin
  if (o && typeof o === 'object') {
    if (o.type === 'user') return nomUtilisateur(o.sender_user)
    if (o.type === 'hidden_user') return nomPropre(o.sender_user_name)
    if (o.type === 'chat') return nomChat(o.sender_chat, o.author_signature)
    if (o.type === 'channel') return nomChat(o.chat, o.author_signature)
    return ''
  }
  if (m.forward_from) return nomUtilisateur(m.forward_from)
  if (m.forward_from_chat) return nomChat(m.forward_from_chat, m.forward_signature)
  if (typeof m.forward_sender_name === 'string') return nomPropre(m.forward_sender_name)
  if (m.forward_date) return ''
  return null
}

function tailleConnue(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * La plus grande taille d'une photo qui tient sous `max` (Telegram en donne
 * plusieurs, de la vignette a l'original compresse). Une taille au poids
 * inconnu est acceptee (le telechargement revérifie). null = aucune taille
 * lisible ; { tropGros } = toutes depassent `max` (le plus petit poids).
 */
export function choisirPhoto(
  tailles: TaillePhotoTg[], max: number = MAX_OCTETS_IMAGE,
): { photo: TaillePhotoTg & { file_id: string } } | { tropGros: number } | null {
  const lisibles = tailles.filter((t): t is TaillePhotoTg & { file_id: string } =>
    !!t && typeof t === 'object' && typeof t.file_id === 'string' && t.file_id !== '')
  if (lisibles.length === 0) return null
  const aire = (t: TaillePhotoTg) => (Number(t.width) || 0) * (Number(t.height) || 0)
  const sous = lisibles.filter(t => { const p = tailleConnue(t.file_size); return p === null || p <= max })
  if (sous.length === 0) {
    return { tropGros: Math.min(...lisibles.map(t => tailleConnue(t.file_size) ?? Infinity)) }
  }
  const photo = sous.reduce((a, b) => (aire(b) > aire(a)
    || (aire(b) === aire(a) && (tailleConnue(b.file_size) ?? 0) > (tailleConnue(a.file_size) ?? 0)) ? b : a))
  return { photo }
}

/** Le type d'un document image (mime_type, puis l'extension du nom), ou null. */
export function typeDocumentImage(d: DocumentTg): TypeImage | null {
  const mime = typeof d.mime_type === 'string' ? d.mime_type.toLowerCase().trim() : ''
  if (mime === 'image/jpg') return 'image/jpeg'
  if ((TYPES_IMAGE_LUS as readonly string[]).includes(mime)) return mime as TypeImage
  if (mime && mime !== 'application/octet-stream') return null
  const ext = typeof d.file_name === 'string' ? d.file_name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] : undefined
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  return null
}

/**
 * Le type REEL d'une image, lu dans ses premiers octets (l'API refuse une
 * image dont le type annonce ne correspond pas au contenu). null = ni JPEG,
 * ni PNG, ni WEBP.
 */
export function typeImageDepuisOctets(o: Uint8Array): TypeImage | null {
  if (o.length >= 8 && o[0] === 0x89 && o[1] === 0x50 && o[2] === 0x4e && o[3] === 0x47
    && o[4] === 0x0d && o[5] === 0x0a && o[6] === 0x1a && o[7] === 0x0a) return 'image/png'
  if (o.length >= 3 && o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff) return 'image/jpeg'
  if (o.length >= 12 && o[0] === 0x52 && o[1] === 0x49 && o[2] === 0x46 && o[3] === 0x46
    && o[8] === 0x57 && o[9] === 0x45 && o[10] === 0x42 && o[11] === 0x50) return 'image/webp'
  return null
}

// Ce qu'on ne lit pas, dans l'ordre ou on le cherche (une animation porte
// AUSSI un champ document : elle passe avant).
const AUTRES_CONTENUS: [keyof MessageTgLu, string][] = [
  ['voice', 'ce message vocal'],
  ['video_note', 'cette vidéo ronde'],
  ['video', 'cette vidéo'],
  ['animation', 'cette animation'],
  ['audio', 'ce fichier audio'],
  ['sticker', 'cet autocollant'],
  ['venue', 'ce lieu'],
  ['location', 'cette position'],
  ['contact', 'ce contact'],
  ['poll', 'ce sondage'],
  ['story', 'cette story'],
]

function decrireDocument(d: DocumentTg): string {
  const nom = nomPropre(d.file_name)
  return nom ? `ce fichier « ${nom} »` : 'ce fichier'
}

/**
 * Ce qu'apporte un message Telegram (voir LectureMessageTg). Le texte est
 * message.text, sinon la legende (caption). Une photo : sa plus grande taille
 * sous `max`. Un document : seulement JPEG, PNG ou WEBP.
 */
export function lireMessageTelegram(brut: unknown, max: number = MAX_OCTETS_IMAGE): LectureMessageTg {
  if (!brut || typeof brut !== 'object') return { genre: 'vide' }
  const m = brut as MessageTgLu
  const source = typeof m.text === 'string' ? m.text : typeof m.caption === 'string' ? m.caption : ''
  const texte = source.slice(0, MAX_TEXTE_MESSAGE).trim()
  const transfert = nomTransfert(m)
  const album = typeof m.media_group_id === 'string' && m.media_group_id !== ''

  if (Array.isArray(m.photo) && m.photo.length > 0) {
    const choix = choisirPhoto(m.photo, max)
    if (choix === null) return { genre: 'non_lu', quoi: 'cette photo' }
    if ('tropGros' in choix) return { genre: 'trop_gros', taille: choix.tropGros }
    return {
      genre: 'contenu', texte, transfert, album,
      image: { fileId: choix.photo.file_id, source: 'photo', typeAnnonce: 'image/jpeg', taille: tailleConnue(choix.photo.file_size) },
    }
  }

  for (const [cle, quoi] of AUTRES_CONTENUS) {
    if (m[cle] !== undefined && m[cle] !== null) return { genre: 'non_lu', quoi }
  }

  if (m.document && typeof m.document === 'object') {
    const d = m.document
    const type = typeDocumentImage(d)
    if (!type || typeof d.file_id !== 'string' || !d.file_id) return { genre: 'non_lu', quoi: decrireDocument(d) }
    const taille = tailleConnue(d.file_size)
    if (taille !== null && taille > max) return { genre: 'trop_gros', taille }
    return { genre: 'contenu', texte, transfert, album, image: { fileId: d.file_id, source: 'document', typeAnnonce: type, taille } }
  }

  if (!texte) return { genre: 'vide' }
  return { genre: 'contenu', texte, transfert, album: false, image: null }
}

/**
 * Le texte du tour, tel qu'il part au modele ET tel qu'il est garde dans
 * l'historique (jamais le base64) : l'origine d'un transfert en tete, la
 * trace de l'image, puis le texte ou la legende.
 */
export function texteDuTour(l: Extract<LectureMessageTg, { genre: 'contenu' }>): string {
  const lignes: string[] = []
  if (l.transfert !== null) {
    lignes.push(l.transfert ? `Message transféré de ${l.transfert} :` : 'Message transféré (expéditeur inconnu) :')
  }
  if (l.image) lignes.push(l.album ? TRACE_IMAGE_ALBUM : TRACE_IMAGE)
  if (l.texte) lignes.push(l.texte)
  return lignes.join('\n')
}

/** Un poids en Mo, a la francaise (« 6,2 Mo »). */
export function formaterMo(octets: number): string {
  return `${(Math.round(octets / 100_000) / 10).toFixed(1).replace('.', ',')} Mo`
}

export function texteImageTropGrosse(taille: number, max: number = MAX_OCTETS_IMAGE): string {
  const poids = Number.isFinite(taille) && taille > 0 ? `Cette image pèse ${formaterMo(taille)}` : 'Cette image est trop lourde'
  return `${poids} : je ne lis que les images de ${formaterMo(max)} au plus. `
    + "Envoie-la en photo (Telegram la compresse) plutôt qu'en fichier, ou recadre-la."
}

export function texteNonLu(quoi: string): string {
  return `Je ne lis ici que le texte et les images (photo, ou fichier JPEG, PNG ou WEBP) : ${quoi} n'est pas lu. `
    + "Envoie une capture d'écran, ou dépose le document dans la fenêtre de l'agent du cockpit."
}

export const TEXTE_IMAGE_ILLISIBLE = "Je n'ai pas pu récupérer cette image chez Telegram : renvoie-la dans un instant."
export const TEXTE_PAS_UNE_IMAGE = "Ce fichier n'est pas une image lisible (JPEG, PNG ou WEBP) : envoie une capture d'écran."
export const TEXTE_IMAGE_REFUSEE = "Le modèle n'a pas pu lire cette image (format ou dimensions refusés, 8000 pixels de côté au plus). "
  + "Renvoie-la en photo plutôt qu'en fichier, ou recadre-la."

/** La reponse en clair quand l'image n'a pas pu etre recuperee chez Telegram. */
export function texteEchecImage(
  e: { raison: 'trop_gros'; taille: number } | { raison: 'pas_une_image' | 'illisible' },
): string {
  if (e.raison === 'trop_gros') return texteImageTropGrosse(e.taille)
  return e.raison === 'pas_une_image' ? TEXTE_PAS_UNE_IMAGE : TEXTE_IMAGE_ILLISIBLE
}

/**
 * Une erreur de l'API due a l'image (requete refusee, 400, qui parle de
 * l'image) : on le dit en clair au lieu du message de panne generique.
 */
export function erreurDImage(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { status?: unknown; message?: unknown }
  return e.status === 400 && typeof e.message === 'string' && /image/i.test(e.message)
}

// ---------------------------------------------------------------------------
// L'historique pour le modele.
//
// Chaque tour ecrit SA question des son arrivee (avec un identifiant de
// tour), avant de reflechir, et sa reponse a la fin. Pourquoi : un message
// transfere avec un commentaire arrive en DEUX updates quasi simultanes (le
// commentaire, puis le message transfere). Ecrite seulement en fin de tour,
// la demande « Tu peux lire cette image » restait invisible au tour de
// l'image, qui arrivait pendant que le premier reflechissait. Ecrite des
// l'arrivee, elle precede l'image dans l'historique.
// ---------------------------------------------------------------------------

export type MessageHistorique = { role: 'user' | 'assistant'; content: string }

/**
 * Remet l'historique dans une forme que l'API accepte sans discussion : des
 * roles qui alternent (deux messages de suite du meme role sont fusionnes,
 * ce qui arrive quand deux questions se croisent ou apres la ligne de
 * resultat d'un clic Confirmer), et un premier message de l'utilisateur.
 */
export function normaliserHistorique(entrees: unknown[]): MessageHistorique[] {
  const sortie: MessageHistorique[] = []
  for (const e of entrees) {
    if (!e || typeof e !== 'object') continue
    const { role, content } = e as { role?: unknown; content?: unknown }
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) continue
    const dernier = sortie[sortie.length - 1]
    if (dernier && dernier.role === role) dernier.content = `${dernier.content}\n\n${content}`
    else if (sortie.length > 0 || role === 'user') sortie.push({ role, content })
  }
  return sortie
}

/**
 * L'historique vu par le tour `idTour` : tout ce qui PRECEDE sa propre
 * question (qu'il vient d'ecrire), normalise. Ce qu'un tour concurrent a
 * ecrit apres lui n'est pas a lui. Identifiant introuvable = tout.
 */
export function historiquePourTour(stockes: unknown, idTour: string): MessageHistorique[] {
  const liste = Array.isArray(stockes) ? stockes : []
  let fin = liste.length
  for (let i = liste.length - 1; i >= 0; i--) {
    const e = liste[i] as { id?: unknown } | null
    if (e && typeof e === 'object' && e.id === idTour) { fin = i; break }
  }
  return normaliserHistorique(liste.slice(0, fin))
}

export type ImageDuTour = { base64: string; mediaType: TypeImage }

type BlocTexte = { type: 'text'; text: string }
type BlocImage = {
  type: 'image'
  source: { type: 'base64'; media_type: TypeImage; data: string }
  cache_control?: { type: 'ephemeral' }
}
export type MessageModele = { role: 'user' | 'assistant'; content: string | (BlocTexte | BlocImage)[] }

/**
 * Les messages du modele : l'historique, puis la question du tour. Avec une
 * image : l'image d'abord, le texte ensuite (le modele lit mieux la piece
 * avant la demande), et UN point de cache sur l'image, que la boucle d'outils
 * ne refacture pas a chaque aller-retour (meme regle qu'au web). Si
 * l'historique finit deja par une question (deux messages croises), la
 * question du tour la complete au lieu de la suivre.
 */
export function messagesPourModele(
  historique: MessageHistorique[], tour: { texte: string; image: ImageDuTour | null },
): MessageModele[] {
  const messages: MessageModele[] = historique.map(m => ({ role: m.role, content: m.content }))
  const precedent = messages[messages.length - 1]
  const enAttente = precedent?.role === 'user' ? (messages.pop() as MessageModele).content as string : null

  if (!tour.image) {
    const texte = enAttente ? `${enAttente}\n\n${tour.texte}` : tour.texte
    messages.push({ role: 'user', content: texte })
    return messages
  }
  const blocs: (BlocTexte | BlocImage)[] = []
  if (enAttente) blocs.push({ type: 'text', text: enAttente })
  blocs.push({
    type: 'image',
    source: { type: 'base64', media_type: tour.image.mediaType, data: tour.image.base64 },
    cache_control: { type: 'ephemeral' },
  })
  blocs.push({ type: 'text', text: tour.texte || TRACE_IMAGE })
  messages.push({ role: 'user', content: blocs })
  return messages
}
