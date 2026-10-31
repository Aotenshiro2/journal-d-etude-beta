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
// LES MESSAGES VOCAUX (31/10/2026, Brice : Agent AOK doit comprendre les
// vocaux). Un message vocal (voice), ou un fichier audio (audio), est
// telecharge chez Telegram puis transcrit (transcription-pur.ts), et traite
// comme un message ECRIT de la meme personne : meme analyse de securite que
// ses mots (partsDuTour, niveau 'cache'), memes cartes a un clic, rien de
// plus. Un vocal TRANSFERE garde son origine en tete (« Message transféré de
// X : ») : la voix d'un tiers, une DONNEE, jamais un ordre (niveau 'tiers'),
// comme un texte transfere.
// lireMessageTelegram n'est pas touchee : le bot des membres (bot-membre.ts)
// garde son parcours d'avant pour un vocal ; seule la route d'Agent AOK lit
// les vocaux, par lireVocalTelegram, avant le reste.
// ---------------------------------------------------------------------------

/** 5 minutes au plus (Brice, 31/10), d'apres la duree donnee par Telegram : au-dela, dit en clair, rien n'est telecharge. */
export const DUREE_MAX_VOCAL_S = 300
/** 20 Mo : ce que l'API des bots sert (getFile), sous les 25 Mo acceptes par le service de transcription. */
export const MAX_OCTETS_VOCAL = 20_000_000
/** Une transcription plus longue est coupee (5 minutes de parole font environ 4 500 caracteres). */
export const MAX_TRANSCRIPTION = 6000
/** Le texte d'un tour vocal : en-tete de transfert, trace, transcription, legende. */
export const MAX_TEXTE_TOUR_VOCAL = 7500
/** La trace d'un vocal dans le texte du tour ET dans l'historique : la transcription suit, sur la ligne d'apres. */
export const TRACE_VOCAL = '[message vocal, transcrit ci-dessous]'
/** L'extrait de la transcription dans la ligne « J'ai entendu » (coupe au mot au-dela). */
export const MAX_LIGNE_ENTENDU = 400

/** Un vocal ou un fichier audio Telegram (Voice, Audio). */
export type FichierAudioTg = { file_id?: string; duration?: number; mime_type?: string; file_size?: number; file_name?: string }

/** Les formats acceptes par le service de transcription (API compatible OpenAI), par leur extension. */
export const EXTENSIONS_AUDIO = ['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'opus', 'wav', 'webm'] as const

const EXTENSION_PAR_MIME: Record<string, string> = {
  'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mpga': 'mpga',
  'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/wave': 'wav', 'audio/vnd.wave': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/webm': 'webm',
}

/** Le vocal a recuperer chez Telegram (getFile), puis a transcrire. */
export type VocalALire = {
  fileId: string
  source: 'voice' | 'audio'
  /** La duree donnee par Telegram (secondes) : limite et cout. */
  duree: number | null
  taille: number | null
  /** Le nom envoye au service : son extension dit le format (« vocal.ogg »). */
  nomFichier: string
  mime: string
}

/** Ce qui se refuse a la lecture, sans rien telecharger. */
export type RaisonRefusVocal = 'trop_long' | 'trop_gros' | 'format' | 'illisible'
/** Toutes les raisons d'un vocal non transcrit, dites en clair par texteEchecVocal. */
export type RaisonEchecVocal = RaisonRefusVocal | 'sans_cle' | 'cle_refusee' | 'delai' | 'echec' | 'vide'

/**
 * Ce qu'apporte un vocal : 'vocal' (a telecharger et transcrire) ou 'refus'
 * (dit en clair, sans rien telecharger). null : le message n'est ni un vocal
 * ni un fichier audio.
 */
export type LectureVocal =
  | { genre: 'vocal'; vocal: VocalALire; transfert: string | null; legende: string }
  | { genre: 'refus'; raison: RaisonRefusVocal; texte: string }

/** Une duree en clair : « 45 s », « 5 min », « 6 min 12 s ». */
export function formaterDuree(secondes: number | null | undefined): string {
  if (typeof secondes !== 'number' || !Number.isFinite(secondes) || secondes < 0) return 'une durée inconnue'
  const s = Math.round(secondes)
  if (s < 60) return `${s} s`
  const min = Math.floor(s / 60)
  const reste = s % 60
  return reste ? `${min} min ${reste} s` : `${min} min`
}

/**
 * Un vocal non transcrit, en clair : jamais le silence. `source` choisit « ce
 * vocal » ou « ce fichier audio ». Sans cle : l'esprit du message d'avant
 * (« je ne sais pas encore écouter les vocaux, écris-le-moi »).
 */
export function texteEchecVocal(
  raison: RaisonEchecVocal,
  o: { source?: 'voice' | 'audio'; duree?: number | null; taille?: number | null; dureeMax?: number; max?: number } = {},
): string {
  const ce = o.source === 'audio' ? 'ce fichier audio' : 'ce vocal'
  const Ce = o.source === 'audio' ? 'Ce fichier audio' : 'Ce vocal'
  switch (raison) {
    case 'trop_long':
      return `${Ce} dure ${formaterDuree(o.duree)} : j'écoute ${formaterDuree(o.dureeMax ?? DUREE_MAX_VOCAL_S)} au plus. `
        + 'Coupe-le en plusieurs vocaux plus courts, ou écris-le-moi.'
    case 'trop_gros':
      return `${typeof o.taille === 'number' && o.taille > 0 ? `${Ce} pèse ${formaterMo(o.taille)}` : `${Ce} est trop lourd`} : `
        + `j'écoute les fichiers de ${formaterMo(o.max ?? MAX_OCTETS_VOCAL)} au plus. Envoie un vocal plus court, ou écris-le-moi.`
    case 'format':
      return `${Ce} n'est pas dans un format que je sais écouter (MP3, M4A, OGG, OPUS, WAV, FLAC ou WEBM) : `
        + 'envoie-le plutôt en message vocal, ou écris-le-moi.'
    case 'illisible':
      return `Je n'ai pas pu récupérer ${ce} chez Telegram : renvoie-le dans un instant, ou écris-le-moi.`
    case 'sans_cle':
      return "Je ne sais pas encore écouter les vocaux ici (la transcription n'est pas branchée) : écris-le-moi."
    case 'cle_refusee':
      return `Je n'ai pas pu écouter ${ce} : le service de transcription refuse sa clé (à vérifier par Brice). En attendant, écris-le-moi.`
    case 'delai':
      return `La transcription de ${ce} a pris trop de temps : renvoie-le dans un instant, ou écris-le-moi.`
    case 'echec':
      return `La transcription de ${ce} a échoué (service indisponible) : renvoie-le dans un instant, ou écris-le-moi.`
    case 'vide':
      return `Je n'ai entendu aucune parole dans ${ce} : renvoie-le en parlant plus près du micro, ou écris-le-moi.`
  }
}

function extensionAudio(source: 'voice' | 'audio', f: FichierAudioTg): string | null {
  const mime = typeof f.mime_type === 'string' ? f.mime_type.toLowerCase().split(';')[0].trim() : ''
  if (EXTENSION_PAR_MIME[mime]) return EXTENSION_PAR_MIME[mime]
  const ext = typeof f.file_name === 'string' ? f.file_name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] : undefined
  if (ext && (EXTENSIONS_AUDIO as readonly string[]).includes(ext)) return ext
  // Un message vocal Telegram est un OGG/Opus, meme sans type annonce.
  return source === 'voice' ? 'ogg' : null
}

/**
 * Le vocal (voice) ou le fichier audio (audio) d'un message, avec ses limites :
 * plus de `dureeMax` secondes ou plus de `max` octets annonces = refus, sans
 * rien telecharger. La legende est le texte du message (caption) ; un
 * transfert garde son origine (nomTransfert). null = ni vocal ni audio.
 */
export function lireVocalTelegram(brut: unknown, o: { dureeMax?: number; max?: number } = {}): LectureVocal | null {
  if (!brut || typeof brut !== 'object') return null
  const m = brut as MessageTgLu
  const source: 'voice' | 'audio' | null = m.voice !== undefined && m.voice !== null ? 'voice'
    : m.audio !== undefined && m.audio !== null ? 'audio' : null
  if (!source) return null
  const dureeMax = o.dureeMax ?? DUREE_MAX_VOCAL_S
  const max = o.max ?? MAX_OCTETS_VOCAL
  const champ = source === 'voice' ? m.voice : m.audio
  const f = (champ && typeof champ === 'object' ? champ : {}) as FichierAudioTg
  const refus = (raison: RaisonRefusVocal, x: { duree?: number; taille?: number } = {}): LectureVocal =>
    ({ genre: 'refus', raison, texte: texteEchecVocal(raison, { source, dureeMax, max, ...x }) })

  const duree = tailleConnue(f.duration)
  if (duree !== null && duree > dureeMax) return refus('trop_long', { duree })
  const taille = tailleConnue(f.file_size)
  if (taille !== null && taille > max) return refus('trop_gros', { taille })
  if (typeof f.file_id !== 'string' || !f.file_id) return refus('illisible')
  const ext = extensionAudio(source, f)
  if (!ext) return refus('format')
  const mime = typeof f.mime_type === 'string' && /^audio\/[\w.+-]+$/i.test(f.mime_type.trim()) ? f.mime_type.trim().toLowerCase() : 'application/octet-stream'

  const legende = (typeof m.caption === 'string' ? m.caption : '').slice(0, MAX_TEXTE_MESSAGE).trim()
  return {
    genre: 'vocal',
    vocal: { fileId: f.file_id, source, duree, taille, nomFichier: `${source === 'voice' ? 'vocal' : 'audio'}.${ext}`, mime },
    transfert: nomTransfert(m),
    legende,
  }
}

/** Un texte coupe au dernier mot qui tient dans `max` caracteres, trois points a la fin s'il est coupe. */
export function couperAuMot(texte: string, max: number): string {
  const t = texte.trim()
  if (t.length <= max) return t
  const coupe = t.slice(0, Math.max(1, max - 3))
  const espace = coupe.lastIndexOf(' ')
  const net = (espace >= coupe.length * 0.6 ? coupe.slice(0, espace) : coupe).replace(/[\s,;:.!?-]+$/, '')
  return `${net}...`
}

/**
 * Le texte d'un tour vocal, tel qu'il part au modele ET tel qu'il est garde
 * dans l'historique : l'origine d'un transfert en tete, la trace du vocal,
 * la transcription, puis la legende s'il y en a une. Les tours suivants
 * savent ainsi ce qui a ete dit, et que c'etait un vocal.
 */
export function texteDuTourVocal(l: Extract<LectureVocal, { genre: 'vocal' }>, transcription: string): string {
  const lignes: string[] = []
  if (l.transfert !== null) {
    lignes.push(l.transfert ? `Message transféré de ${l.transfert} :` : 'Message transféré (expéditeur inconnu) :')
  }
  lignes.push(TRACE_VOCAL)
  lignes.push(transcription.trim())
  if (l.legende) lignes.push(`Légende du vocal : ${l.legende}`)
  return lignes.join('\n')
}

/**
 * La ligne que le SERVEUR met en tete de la reponse a un vocal (jamais le
 * modele) : ce qu'il a entendu, coupe au mot si c'est long. La personne voit
 * ainsi tout de suite si la transcription a rate.
 */
export function ligneEntendu(transcription: string, transfert: string | null = null, max: number = MAX_LIGNE_ENTENDU): string {
  const extrait = couperAuMot(transcription.replace(/\s+/g, ' '), max)
  const qui = transfert === null ? '' : transfert ? ` (vocal transféré de ${transfert})` : ' (vocal transféré)'
  return `J'ai entendu${qui} : « ${extrait} »`
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

// ---------------------------------------------------------------------------
// LE TEMPS D'UN TOUR (29/10/2026)
//
// LE BUG REEL (Melanie, 28/10, 12:53, 14:21 et 22:03) : « Je vérifie... » puis
// plus rien, trois fois. Preuves (AiUsage, cockpit_generations, historique) :
// a chaque tour, l'agent lancait les 6 brouillons demandes par generer_post,
// UN PAR UN (25 a 37 s chacun) ; la fonction du webhook (maxDuration 120 s)
// etait tuee par Vercel au 3e ou au 4e brouillon, avant toute reponse et sans
// que le catch tourne. La question restait sans reponse dans l'historique,
// donc chaque message suivant de Melanie relancait les memes 6 brouillons, et
// mourait de la meme facon. Le fil de Brice, sans brouillon en attente,
// repondait normalement.
//
// D'ou : une LIMITE par tour, connue de la boucle (elle s'arrete avant et
// rend ce qui est fait), et un FILET dans le canal (au-dela, un message
// d'echec clair part quand meme). Un « Je vérifie... » est toujours suivi
// d'une reponse ou d'un echec dit en clair.
// ---------------------------------------------------------------------------

/** Ce qu'on garde avant la mort de la fonction : dire l'echec et l'ecrire en base. */
export const MARGE_FIN_FONCTION_MS = 25_000
/** Le filet du canal part a la limite + ce delai, si la boucle n'a pas rendu la main. */
export const GRACE_FILET_MS = 6_000
/**
 * Sans limite donnee par l'appelant (message transmis par le bot des membres,
 * dont la route a maxDuration 120 s) : depuis le debut du tour.
 */
export const DUREE_TOUR_DEFAUT_MS = 85_000

/** L'instant (ms) ou un tour doit avoir rendu sa reponse, pour une route de `maxDurationS` secondes. */
export function limiteDuTour(debutMs: number, maxDurationS: number): number {
  return debutMs + Math.max(10_000, maxDurationS * 1000 - MARGE_FIN_FONCTION_MS)
}

/** Le message du filet : le tour n'a pas rendu la main a temps. */
export const TEXTE_TEMPS_DEPASSE = "Je n'ai pas pu finir à temps : la demande était trop longue pour un seul message. "
  + "Ce qui a déjà été fait est gardé (un brouillon de post est aussi rangé dans le Cockpit, onglet Création). "
  + "Dis « continue » et je reprends là où je me suis arrêté, ou découpe la demande."

/** Une reponse que Telegram a refusee (trop longue, format) : dit en clair, jamais le silence. */
export const TEXTE_REPONSE_NON_PARTIE = "Ma réponse n'a pas pu partir (Telegram l'a refusée). "
  + "Dis « renvoie » et je la redonne en plus court."

// ---------------------------------------------------------------------------
// Les messages longs (29/10) : 6 brouillons recopies font plus de 4 096
// caracteres, la limite d'un message Telegram. Avant, sendMessage etait
// refuse et rien ne partait. Le texte est coupe entre deux paragraphes, puis
// entre deux lignes, et en dernier recours au caractere.
// ---------------------------------------------------------------------------

export const MAX_MESSAGE_TG = 4096

function couperAuCaractere(t: string, max: number): string[] {
  const morceaux: string[] = []
  for (let i = 0; i < t.length; i += max) morceaux.push(t.slice(i, i + max))
  return morceaux
}

/** Un texte en messages Telegram de `max` caracteres au plus, dans l'ordre, sans morceau vide. */
export function decouperMessage(texte: string, max: number = MAX_MESSAGE_TG): string[] {
  const t = texte.trim()
  if (!t) return []
  if (t.length <= max) return [t]
  const sortie: string[] = []
  let courant = ''
  const pousser = () => { if (courant.trim()) sortie.push(courant.trim()); courant = '' }
  const ajouter = (morceau: string, sep: string) => {
    if (!courant) { courant = morceau; return }
    if (courant.length + sep.length + morceau.length <= max) { courant = `${courant}${sep}${morceau}`; return }
    pousser()
    courant = morceau
  }
  for (const paragraphe of t.split('\n\n')) {
    if (paragraphe.length <= max) { ajouter(paragraphe, '\n\n'); continue }
    // Un paragraphe trop long : ligne par ligne, et une ligne trop longue au caractere.
    pousser()
    for (const ligne of paragraphe.split('\n')) {
      if (ligne.length <= max) { ajouter(ligne, '\n'); continue }
      pousser()
      const bouts = couperAuCaractere(ligne, max)
      for (const b of bouts.slice(0, -1)) sortie.push(b)
      courant = bouts[bouts.length - 1] ?? ''
    }
    pousser()
  }
  pousser()
  return sortie
}

/**
 * La reponse du modele suivie de la carte : la reponse coupee comme
 * decouperMessage, la carte dans le DERNIER message (celui qui porte les
 * boutons), jamais coupee (elle porte le texte exact de l'action). Si le
 * dernier morceau et la carte ne tiennent pas ensemble, la carte part seule.
 */
export function messagesAvecCarte(reply: string, carte: string, max: number = MAX_MESSAGE_TG): string[] {
  const morceaux = decouperMessage(reply, max)
  const dernier = morceaux.pop()
  if (dernier === undefined) return [carte]
  const ensemble = `${dernier}\n\n${carte}`
  return ensemble.length <= max ? [...morceaux, ensemble] : [...morceaux, dernier, carte]
}

// ---------------------------------------------------------------------------
// LES DEMANDES RESTEES SANS REPONSE (29/10, Brice : « chaque conversation est
// isolee » = une demande de Mel restee sans reponse est perdue).
//
// Chaque fil d'Agent AOK est garde en base (cockpit_agent_conversations). Une
// demande est EN SUSPENS quand les derniers messages de l'interlocuteur n'ont
// recu aucune reponse de l'agent, ou seulement une reponse d'echec (marquee
// `echec: true` depuis le 29/10). Les lignes du resume du matin (id resume-...)
// et les lignes « [système] » ne comptent ni comme question ni comme reponse.
// Une question de moins de AGE_MIN_SUSPENS_MS est un tour peut-etre en cours :
// pas en suspens.
// ---------------------------------------------------------------------------

/** Plus long qu'un tour (maxDuration 300 s) : une question plus jeune est peut-etre en cours de traitement. */
export const AGE_MIN_SUSPENS_MS = 6 * 60_000

export type MessageEnSuspens = { id: string | null; texte: string; le: string | null }
export type DemandesEnSuspens = {
  messages: MessageEnSuspens[]
  /** Vrai : le tour a repondu par un echec (temps depasse, erreur, reponse partielle). */
  inachevee: boolean
  /** La derniere vraie reponse de l'agent avant la demande (souvent la question qu'il avait posee). */
  contexte: string | null
  /** Le moment de la premiere question en suspens, quand il est connu. */
  depuis: string | null
}

function ligneSysteme(id: unknown, content: string): boolean {
  return (typeof id === 'string' && id.startsWith('resume-')) || content.startsWith('[système]')
}

/**
 * Les demandes en suspens a la fin d'un fil (ou juste avant la question
 * `avantId`, celle du tour en cours), ou null.
 */
export function demandesEnSuspens(
  stockes: unknown,
  o: { maintenant: number; avantId?: string | null; ageMinMs?: number },
): DemandesEnSuspens | null {
  const liste = Array.isArray(stockes) ? stockes : []
  let fin = liste.length
  if (o.avantId) {
    for (let i = liste.length - 1; i >= 0; i--) {
      const e = liste[i] as { id?: unknown } | null
      if (e && typeof e === 'object' && e.id === o.avantId) { fin = i; break }
    }
  }
  const messages: MessageEnSuspens[] = []
  let inachevee = false
  let contexte: string | null = null
  for (let i = fin - 1; i >= 0; i--) {
    const e = liste[i] as { role?: unknown; content?: unknown; id?: unknown; le?: unknown; echec?: unknown } | null
    if (!e || typeof e !== 'object' || typeof e.content !== 'string' || !e.content.trim()) continue
    if (ligneSysteme(e.id, e.content)) continue
    if (e.role === 'user') {
      messages.unshift({
        id: typeof e.id === 'string' ? e.id : null,
        texte: e.content.trim(),
        le: typeof e.le === 'string' && Number.isFinite(Date.parse(e.le)) ? e.le : null,
      })
      continue
    }
    if (e.role === 'assistant') {
      if (e.echec === true) { inachevee = true; continue }
      contexte = e.content.trim()
      break
    }
  }
  const ageMin = o.ageMinMs ?? AGE_MIN_SUSPENS_MS
  const anciens = messages.filter(m => m.le === null || o.maintenant - Date.parse(m.le) >= ageMin)
  if (anciens.length === 0) return null
  return { messages: anciens, inachevee, contexte, depuis: anciens[0].le }
}

/** « le 28/10 à 12:53 », heure de Paris, ou '' si l'instant est illisible. */
export function quandParis(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).map(x => [x.type, x.value]))
  return `le ${p.day}/${p.month} à ${p.hour}:${p.minute}`
}

/** Un message en une ligne, coupe a `max` caracteres (trois points si coupe). */
export function extraitCourt(texte: string, max: number): string {
  const t = texte.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 3)).trimEnd()}...`
}

/**
 * La note donnee au modele avec le message du tour (jamais gardee en base).
 * 'tour' : un nouveau message arrive alors qu'une demande est en suspens ;
 * 'reprise' : un membre de l'equipe a demande de la reprendre (reprendre_demande).
 */
export function noteSuspens(s: DemandesEnSuspens, o: { mode: 'tour' } | { mode: 'reprise'; par: string }): string {
  const quand = quandParis(s.depuis)
  const liste = s.messages.map(m => `« ${extraitCourt(m.texte, 300)} »`).join(' ; ')
  const etat = s.inachevee ? "n'ont pas eu de réponse complète (le tour s'est arrêté avant la fin)" : 'sont restés sans réponse'
  const contexte = s.contexte ? ` Ta dernière réponse avant eux : « ${extraitCourt(s.contexte, 300)} ».` : ''
  if (o.mode === 'reprise') {
    return `[système] ${o.par} t'a demandé de reprendre ici la demande restée sans réponse${quand ? ` (${quand})` : ''} : ${liste}.${contexte} `
      + "Traite-la maintenant, pour ton interlocuteur, dans ce fil : dis en une ligne que tu la reprends. "
      + "Ce qui manque, tu le lui demandes à lui ou à elle, dans ce fil."
  }
  return `[système] Avant ce message, ces messages de ton interlocuteur ${etat}${quand ? ` (depuis ${quand})` : ''} : ${liste}.${contexte} `
    + "Si son nouveau message les relance (« du coup ? », « alors ? », « continue », « reprends »), reprends-les maintenant. "
    + "Sinon, traite d'abord son nouveau message, puis propose en une ligne de reprendre la demande restée sans réponse."
}

/** Un compte de l'equipe sur Agent AOK (cockpit_telegram_comptes, libelle du cockpit). */
export type CompteEquipe = { telegram_id: number; user_id: string; libelle: string | null; label: string | null }

function cleNom(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Le membre de l'equipe designe par `qui` (« Mel », « Mélanie », « melanie »,
 * « Brice ») : egalite du nom, ou l'un commence par l'autre (3 lettres au
 * moins). null = personne, 'plusieurs' = ambigu.
 */
export function resoudreMembreEquipe(qui: unknown, comptes: readonly CompteEquipe[]): CompteEquipe | null | 'plusieurs' {
  const q = cleNom(qui)
  if (q.length < 3) return null
  const noms = (c: CompteEquipe) => [cleNom(c.libelle), cleNom(c.label)].filter(n => n.length >= 3)
  const exacts = comptes.filter(c => noms(c).includes(q))
  if (exacts.length === 1) return exacts[0]
  if (exacts.length > 1) return 'plusieurs'
  const proches = comptes.filter(c => noms(c).some(n => n.startsWith(q) || q.startsWith(n)))
  if (proches.length === 1) return proches[0]
  return proches.length > 1 ? 'plusieurs' : null
}

// ---------------------------------------------------------------------------
// QUI PARLE DANS UN TOUR (29/10, securite des bots, grille de Brice) : les mots
// du TITULAIRE du fil (Brice ou Mel qui ecrivent, ou la legende de leur
// photo) et ce qu'il TRANSMET (un message transfere : ecrit par un autre).
// Seuls les premiers sont des ordres ; le reste est une donnee.
// ---------------------------------------------------------------------------

const ENTETE_TRANSFERT = /^Message transféré( de .*| \(expéditeur inconnu\)) :$/

/**
 * Le texte du tour (texteDuTour) coupe en deux : les mots du titulaire, et le
 * contenu transmis. Un message transfere arrive seul (son commentaire vient
 * dans le message d'avant) : tout son texte est transmis. Les traces d'image
 * ne sont ni l'un ni l'autre. (31/10) La trace d'un vocal non plus : sa
 * transcription compte comme les mots de celui qui a parle (le titulaire, ou
 * le tiers d'un vocal transfere).
 */
export function partsDuTour(texte: string): { titulaire: string; transmis: string } {
  const lignes = (texte ?? '').split('\n')
  const transfert = lignes.length > 0 && ENTETE_TRANSFERT.test(lignes[0].trim())
  const traces = new Set([TRACE_IMAGE, TRACE_IMAGE_ALBUM, TRACE_VOCAL])
  const corps = lignes.slice(transfert ? 1 : 0).filter(l => !traces.has(l.trim())).join('\n').trim()
  return transfert ? { titulaire: '', transmis: corps } : { titulaire: corps, transmis: '' }
}

// ---------------------------------------------------------------------------
// UNE QUESTION A UN MEMBRE DE L'EQUIPE (Brice, 29/10 : « demande a Mel ses
// accords avec Pulse »). L'outil poser_question_equipe ne part que sur l'ordre
// EXPLICITE du titulaire, dans ses propres mots (jamais sur une image, un
// document, une note ou un resultat d'outil) : un verbe de demande et le nom
// de la personne, dans son message ; ou un « oui » a la proposition que
// l'agent vient de lui faire, qui la nommait.
// La question entre dans le fil de l'autre (deux lignes, comme une alerte),
// sa reponse est rapportee dans le fil de celui qui l'a posee
// (rapporter_reponse_equipe), et la question se ferme.
// ---------------------------------------------------------------------------

// Bornes de mot qui connaissent les accents (\b s'arrete a l'ASCII : « dis à » n'y finirait pas).
const VERBE_QUESTION = /(?<![\p{L}\p{N}])(demande[rsz]?|demandes|pose[rsz]?|questionne[rsz]?|vois\s+avec|voir\s+avec|check(e|er)?\s+avec|renseigne[- ]toi|ask|dis[- ]lui|dis\s+[àa]|[ée]cri[rs]\s+[àa]|pr[ée]viens|transmets|fais[- ]lui\s+savoir|rappelle\s+[àa])(?![\p{L}\p{N}])/iu
const ACCORD = /^\s*(oui|ouais|ok|okay|d'accord|vas[- ]y|go|fais[- ]le|envoie|c'est bon|parfait|yes)(?![\p{L}\p{N}])/iu

/** Les noms par lesquels on designe un compte de l'equipe (Mélanie : aussi « Mel »). */
export function nomsDuCompte(c: Pick<CompteEquipe, 'libelle' | 'label'>): string[] {
  const noms = new Set<string>()
  for (const n of [c.label, c.libelle]) {
    const k = cleNom(n)
    if (k.length >= 3) noms.add(k)
    const premier = cleNom(String(n ?? '').split(/\s+/)[0])
    if (premier.length >= 3) noms.add(premier)
  }
  for (const k of [...noms]) if (k.startsWith('mel')) noms.add('mel')
  return [...noms]
}

function nommeDans(texte: string, noms: string[]): boolean {
  const mots = (texte ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  return noms.some(n => mots.includes(n))
}

/**
 * L'ordre explicite du titulaire de poser une question a `cible` : un verbe
 * de demande et le nom dans son message ; ou un accord (« oui », « vas-y ») a
 * la derniere reponse de l'agent, qui nommait la personne.
 */
export function ordreQuestionExplicite(titulaire: string, cible: Pick<CompteEquipe, 'libelle' | 'label'>, derniereReponse: string | null = null): boolean {
  const t = (titulaire ?? '').trim()
  if (!t) return false
  const noms = nomsDuCompte(cible)
  if (VERBE_QUESTION.test(t) && nommeDans(t, noms)) return true
  return ACCORD.test(t) && !!derniereReponse && nommeDans(derniereReponse, noms)
}

export const QUESTION_EQUIPE_MAX = 1000
/** Une question sans reponse depuis plus longtemps n'est plus rapportee. */
export const DUREE_QUESTION_OUVERTE_MS = 7 * 24 * 3600_000

export type QuestionEquipe = { id: string; par: string; parChat: number; texte: string; le: string }

/**
 * Le texte de la question tel que le modele le donne, sans « Brice demande : »
 * devant (le serveur l'ajoute, texteQuestionEquipe : sinon il serait double,
 * eval S2 du 29/10). '' si ce n'est pas un texte.
 */
export function nettoyerQuestionEquipe(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.replace(/\s+\n/g, '\n').trim().replace(/^[\p{L} .'-]{2,40}\s+demande\s*:\s*/iu, '').trim()
}

/** Le message qui arrive dans le fil de la personne interrogee. */
export function texteQuestionEquipe(q: Pick<QuestionEquipe, 'par' | 'texte'>): string {
  return `${q.par} demande : ${q.texte}\n\nRéponds-moi ici : je lui transmets ta réponse.`
}

export function marqueurQuestionEquipe(par: string): string {
  return `[système] Question de ${par}, posée par Agent AOK à sa demande dans ce fil (ce n'est pas une demande de ton interlocuteur). Quand il ou elle y répond, traite la réponse ici et rapporte-la à ${par} avec rapporter_reponse_equipe.`
}

/** Les deux lignes ajoutees au fil de la personne interrogee. */
export function entreesQuestionEquipe(q: QuestionEquipe): { role: 'user' | 'assistant'; content: string; id: string; questionEquipe?: QuestionEquipe }[] {
  return [
    { role: 'user', content: marqueurQuestionEquipe(q.par), id: `q-${q.id}` },
    { role: 'assistant', content: texteQuestionEquipe(q), id: `q-${q.id}-texte`, questionEquipe: q },
  ]
}

/** La phrase a citer a celui qui demande (la question telle qu'envoyee). */
export function phraseQuestionEnvoyee(qui: string, texte: string): string {
  return `Question envoyée à ${qui} : « ${texte} »`
}

/**
 * La question d'equipe encore ouverte dans un fil (la plus recente, posee par
 * `par` si on le precise), ou null. Fermee = une ligne rapportQuestion
 * portant son id apres elle.
 */
export function questionEquipeOuverte(stockes: unknown, o: { maintenant: number; par?: string | null }): QuestionEquipe | null {
  const liste = Array.isArray(stockes) ? stockes : []
  const fermees = new Set<string>()
  for (let i = liste.length - 1; i >= 0; i--) {
    const e = liste[i] as { rapportQuestion?: unknown; questionEquipe?: unknown } | null
    if (!e || typeof e !== 'object') continue
    if (typeof e.rapportQuestion === 'string') { fermees.add(e.rapportQuestion); continue }
    const q = e.questionEquipe as Partial<QuestionEquipe> | undefined
    if (!q || typeof q !== 'object' || typeof q.id !== 'string' || typeof q.par !== 'string' || typeof q.texte !== 'string') continue
    if (fermees.has(q.id)) continue
    if (typeof q.le !== 'string' || !(o.maintenant - Date.parse(q.le) < DUREE_QUESTION_OUVERTE_MS)) continue
    if (o.par && cleNom(q.par) !== cleNom(o.par) && !cleNom(q.par).startsWith(cleNom(o.par)) && !cleNom(o.par).startsWith(cleNom(q.par))) continue
    if (!Number.isSafeInteger(q.parChat)) continue
    return q as QuestionEquipe
  }
  return null
}

/** Le message qui rapporte la reponse dans le fil de celui qui a pose la question. */
export function texteRapportEquipe(o: { de: string; question: string; reponse: string }): string {
  return `${o.de} a répondu à ta question (« ${extraitCourt(o.question, 300)} ») :\n« ${o.reponse.trim()} »`
}

export function marqueurRapportEquipe(de: string): string {
  return `[système] Réponse de ${de} à ta question, rapportée par Agent AOK (ce n'est pas une question de ton interlocuteur).`
}
