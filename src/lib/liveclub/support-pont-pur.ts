// Regles PURES du fil Support du bot des membres (Brice, 16/10/2026). Aucun
// import : teste par scripts/verifier-pieces-support.mjs.
//
// 1. Les PIECES JOINTES d'un message du fil (photo ou document) : on ne garde
//    que la reference Telegram (file_id du bot des MEMBRES, file_unique_id,
//    type, taille), jamais le fichier. Regle « pas de media lourd sur le
//    stockage » : on relit chez Telegram a la demande (route
//    /api/cockpit/support/piece, alerte Agent AOK).
//    - Dans un sens, l'image d'un membre (photo, ou capture en fichier) ;
//    - dans l'autre, le fichier que l'equipe lui envoie (Agent AOK ou onglet
//      Support) : le fil garde le file_id rendu par le bot des membres.
// 2. L'EQUIPE A LA MAIN (cas reel de Lea, 16/10, regle de Brice) : des que
//    l'equipe repond dans un fil, ce qu'ecrit le membre va a l'equipe, sans
//    l'IA, jusqu'a « Rendre la main au bot » ou 24 h sans message de
//    l'equipe (voir plus bas).
// 3. Au plus une alerte par tranche de INTERVALLE_ALERTES_MS et par fil.

/** Le prefixe des lignes « [système] » du fil (support-pont.ts). */
export const PREFIXE_SYSTEME = '[système] '

/** Ce que lit le membre quand l'equipe lui repond du cockpit ou d'Agent AOK. */
export function texteReponseEquipe(message: string): string {
  return `Réponse de l'équipe AOK :\n\n${message}`
}

// ---------------------------------------------------------------------------
// 1. Les pieces jointes
// ---------------------------------------------------------------------------

export type TypePiece = 'photo' | 'document'

/** Une piece jointe d'un message du fil : un fichier du bot des MEMBRES, relu chez Telegram a la demande. */
export type PieceSupport = {
  file_id: string
  file_unique_id: string | null
  type: TypePiece
  mime: string | null
  nom: string | null
  taille: number | null
}

/** Une piece recue par l'agent du cockpit : le bot qui l'a recue (un file_id ne vaut que pour lui). */
export type PieceAgent = PieceSupport & { bot: 'cockpit' | 'liveclub' }

/**
 * Poids maximal d'une image LUE (apercu du cockpit, image jointe a l'alerte) :
 * celui de la lecture d'Agent AOK (MAX_OCTETS_IMAGE), sous la limite de 4,5 Mo
 * d'une reponse de fonction Vercel.
 */
export const MAX_IMAGE_LUE = 3_750_000
/** Un fichier lu par getFile : 20 Mo au plus (limite de l'API des bots). */
export const MAX_FICHIER_AGENT = 20 * 1024 * 1024
/** Un fichier televerse depuis l'onglet Support : le corps d'une fonction Vercel ne passe pas 4,5 Mo. */
export const MAX_FICHIER_COCKPIT = 4 * 1024 * 1024
/** sendPhoto : 10 Mo au plus ; au-dela, l'image part en fichier. */
export const MAX_PHOTO_ENVOI = 10 * 1024 * 1024
/** Une legende Telegram : 1 024 caracteres au plus. */
export const MAX_LEGENDE = 1024

const IMAGES_LUES = ['image/jpeg', 'image/png', 'image/webp']

/** Les types qu'on accepte d'envoyer a un membre, et leur nom en clair. */
export const TYPES_SORTANTS: Record<string, string> = {
  'image/jpeg': 'image JPEG',
  'image/png': 'image PNG',
  'image/webp': 'image WEBP',
  'image/gif': 'image GIF',
  'application/pdf': 'PDF',
  'text/plain': 'texte',
  'text/csv': 'CSV',
  'application/rtf': 'RTF',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.ms-powerpoint': 'PowerPoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  'application/vnd.oasis.opendocument.text': 'OpenDocument texte',
  'application/vnd.oasis.opendocument.spreadsheet': 'OpenDocument tableur',
}

const PAR_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
  txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
}

const TYPES_EN_CLAIR = 'images (JPEG, PNG, WEBP, GIF), PDF, Word, Excel, PowerPoint, OpenDocument, texte, CSV ou RTF'

// Caracteres de controle et invisibles, construits par leur code.
const INVISIBLES = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
  .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`, 'g')

/** Un nom de fichier propre : sans chemin, sans caractere de controle, 120 caracteres au plus. */
export function nomFichierPropre(brut: unknown): string | null {
  if (typeof brut !== 'string') return null
  const sansChemin = brut.split(/[\\/]/).pop() ?? ''
  const nom = sansChemin.replace(INVISIBLES, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).trim()
  return nom || null
}

function extension(nom: string | null): string | null {
  return nom?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? null
}

/** Le type d'un fichier : son mime, sinon son extension. null = inconnu. */
export function typeDuFichier(mime: unknown, nom: string | null): string | null {
  const m = typeof mime === 'string' ? mime.toLowerCase().split(';')[0].trim() : ''
  if (m === 'image/jpg') return 'image/jpeg'
  if (m && m !== 'application/octet-stream') return m
  const ext = extension(nom)
  return ext ? PAR_EXTENSION[ext] ?? null : null
}

function tailleConnue(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null
}

/** '240 Ko', '1,2 Mo'. */
export function formaterTaille(octets: number | null | undefined): string {
  if (typeof octets !== 'number' || !Number.isFinite(octets) || octets < 0) return 'taille inconnue'
  if (octets < 1024 * 1024) return `${Math.max(1, Math.round(octets / 1024))} Ko`
  return `${(Math.round(octets / (1024 * 1024) * 10) / 10).toFixed(1).replace('.', ',')} Mo`
}

type TailleTg = { file_id?: unknown; file_unique_id?: unknown; width?: unknown; height?: unknown; file_size?: unknown }
type DocumentTg = { file_id?: unknown; file_unique_id?: unknown; file_name?: unknown; mime_type?: unknown; file_size?: unknown }

/**
 * La piece d'un message Telegram : une photo (la plus grande taille qui tient
 * sous `maxPhoto`, sinon la plus petite) ou un document (tout type). null =
 * ni photo ni document.
 */
export function lirePieceMessage(message: unknown, maxPhoto: number = MAX_FICHIER_AGENT): PieceSupport | null {
  if (!message || typeof message !== 'object') return null
  const m = message as { photo?: unknown; document?: unknown }
  if (Array.isArray(m.photo) && m.photo.length > 0) {
    const tailles = (m.photo as TailleTg[]).filter((t): t is TailleTg & { file_id: string } =>
      !!t && typeof t === 'object' && typeof t.file_id === 'string' && t.file_id !== '')
    if (tailles.length === 0) return null
    const aire = (t: TailleTg) => (Number(t.width) || 0) * (Number(t.height) || 0)
    const sous = tailles.filter((t) => { const p = tailleConnue(t.file_size); return p === null || p <= maxPhoto })
    const choix = sous.length
      ? sous.reduce((a, b) => (aire(b) > aire(a) ? b : a))
      : tailles.reduce((a, b) => ((tailleConnue(b.file_size) ?? Infinity) < (tailleConnue(a.file_size) ?? Infinity) ? b : a))
    return {
      file_id: choix.file_id,
      file_unique_id: typeof choix.file_unique_id === 'string' ? choix.file_unique_id : null,
      type: 'photo', mime: 'image/jpeg', nom: null, taille: tailleConnue(choix.file_size),
    }
  }
  if (m.document && typeof m.document === 'object') {
    const d = m.document as DocumentTg
    if (typeof d.file_id !== 'string' || !d.file_id) return null
    const nom = nomFichierPropre(d.file_name)
    return {
      file_id: d.file_id,
      file_unique_id: typeof d.file_unique_id === 'string' ? d.file_unique_id : null,
      type: 'document', mime: typeDuFichier(d.mime_type, nom), nom, taille: tailleConnue(d.file_size),
    }
  }
  return null
}

/** Une image que le cockpit sait montrer : photo, ou document JPEG, PNG, WEBP. */
export function estImage(p: Pick<PieceSupport, 'type' | 'mime'>): boolean {
  return p.type === 'photo' || (p.mime !== null && IMAGES_LUES.includes(p.mime))
}

/**
 * L'image envoyee par un MEMBRE au bot (photo, ou capture en fichier), avec sa
 * legende. null = pas une image : le parcours d'avant (« Je ne lis que les
 * messages ecrits »). La photo gardee est la plus grande qui se relit
 * (MAX_IMAGE_LUE) : l'apercu du cockpit et l'alerte la montrent telle quelle.
 */
export function lirePieceImageMembre(message: unknown): { piece: PieceSupport; legende: string } | null {
  const piece = lirePieceMessage(message, MAX_IMAGE_LUE)
  if (!piece || !estImage(piece)) return null
  const m = message as { caption?: unknown }
  const legende = typeof m.caption === 'string' ? m.caption.replace(INVISIBLES, ' ').trim().slice(0, 2000) : ''
  return { piece, legende }
}

export const TEXTE_IMAGE_FIL = '[image]'

/** Le texte du message du fil pour une image : sa legende, sinon « [image] ». */
export function texteFilImage(legende: string): string {
  return legende.trim() || TEXTE_IMAGE_FIL
}

/** La reponse du bot a l'image d'un membre (Brice, 16/10), au lieu de « Je ne lis que les messages ecrits ». */
export const TEXTE_IMAGE_TRANSMISE = "Bien reçu. Je ne lis pas les images moi-même, alors je transmets ta capture à l'équipe : "
  + 'elle te répond ici. Si tu veux, ajoute un mot pour expliquer.'

/** L'image n'a pas pu entrer au fil (pont en panne) : on ne promet pas une reponse que personne ne verra. */
export const TEXTE_IMAGE_NON_TRANSMISE = "J'ai bien reçu ton image, mais je n'arrive pas à la transmettre à l'équipe pour le moment."

/**
 * Ce que dit le bot apres avoir mis l'image au fil. Le fil passe en attente
 * d'un humain ; seul le message qui l'y fait passer recoit la reponse (et
 * declenche l'alerte) : un album de 3 photos, 3 updates simultanes, ne fait
 * qu'UNE reponse et qu'UNE alerte (passeEnAttente est atomique, support-pont.ts).
 * Deja en attente : rien. Fil non ecrit (null) : le secours.
 */
export function reponseAImage(issue: { passeEnAttente: boolean } | null): 'transmise' | 'silence' | 'secours' {
  if (!issue) return 'secours'
  return issue.passeEnAttente ? 'transmise' : 'silence'
}

/** La trace d'une piece dans l'historique d'Agent AOK (le fichier, lui, n'est jamais lu par le modele s'il n'est pas une image). */
export function tracePieceAgent(p: PieceSupport): string {
  const quoi = p.type === 'photo' ? 'photo' : `${(p.mime && TYPES_SORTANTS[p.mime]) || 'fichier'}${p.nom ? ` « ${p.nom} »` : ''}`
  return `[pièce jointe : ${quoi}, ${formaterTaille(p.taille)}. Je peux l'envoyer à un membre (proposer_reponse_membre, piece_jointe).]`
}

function lirePiece(x: unknown): PieceSupport | null {
  if (!x || typeof x !== 'object') return null
  const p = x as Record<string, unknown>
  if (typeof p.file_id !== 'string' || !p.file_id || p.file_id.length > 300) return null
  if (p.type !== 'photo' && p.type !== 'document') return null
  return {
    file_id: p.file_id,
    file_unique_id: typeof p.file_unique_id === 'string' ? p.file_unique_id.slice(0, 100) : null,
    type: p.type,
    mime: typeof p.mime === 'string' ? p.mime.slice(0, 120) : null,
    nom: nomFichierPropre(p.nom),
    taille: tailleConnue(p.taille),
  }
}

/** Une piece stockee (fil Support, historique d'Agent AOK, carte), relue strictement. */
export function lirePieceSupport(x: unknown): PieceSupport | null {
  return lirePiece(x)
}

export function lirePieceAgent(x: unknown): PieceAgent | null {
  const p = lirePiece(x)
  const bot = x && typeof x === 'object' ? (x as { bot?: unknown }).bot : null
  if (!p || (bot !== 'cockpit' && bot !== 'liveclub')) return null
  return { ...p, bot }
}

/**
 * La derniere piece recue dans la conversation avec Agent AOK (la plus
 * recente d'abord), parmi les `fenetre` derniers messages : « envoie-lui ça »
 * vise ce qui vient d'etre envoye, jamais un fichier ancien.
 */
export function dernierePieceHistorique(stockes: unknown, fenetre = 6): PieceAgent | null {
  const liste = Array.isArray(stockes) ? stockes : []
  for (let i = liste.length - 1; i >= Math.max(0, liste.length - fenetre); i--) {
    const e = liste[i] as { role?: unknown; piece?: unknown } | null
    if (!e || e.role !== 'user') continue
    const p = lirePieceAgent(e.piece)
    if (p) return p
  }
  return null
}

// --- L'envoi d'un fichier a un membre ---------------------------------------

export type MethodeEnvoi = 'sendPhoto' | 'sendDocument'

export type FichierLu = {
  mime: string
  /** Le nom en clair du type (« PDF », « image JPEG »). */
  libelle: string
  nom: string
  taille: number | null
  methode: MethodeEnvoi
}

/**
 * Un fichier a envoyer a un membre : type accepte, poids sous `max`, et la
 * methode Telegram. Une image JPEG, PNG ou WEBP de 10 Mo au plus part en
 * PHOTO (le membre la voit dans la conversation) ; le reste, GIF compris
 * (sendPhoto n'anime pas), part en FICHIER. Une chaine = refus, en clair.
 */
export function lireFichierSortant(
  f: { type: TypePiece; mime?: unknown; nom?: unknown; taille?: unknown },
  max: number,
): FichierLu | string {
  const nomLu = nomFichierPropre(f.nom)
  const mime = f.type === 'photo' ? 'image/jpeg' : typeDuFichier(f.mime, nomLu)
  if (!mime || !TYPES_SORTANTS[mime]) {
    return `Type de fichier refusé (${mime ?? extension(nomLu) ?? 'inconnu'}) : j'envoie seulement ${TYPES_EN_CLAIR}.`
  }
  const taille = tailleConnue(f.taille)
  if (taille !== null && taille > max) {
    return `Fichier trop lourd (${formaterTaille(taille)}) : ${formaterTaille(max)} au plus`
      + (max === MAX_FICHIER_COCKPIT
        ? " depuis l'onglet Support (limite d'envoi du serveur). Envoie-le plutôt depuis Agent AOK (jusqu'à 20 Mo)."
        : ' (limite de Telegram pour un bot).')
  }
  if (taille === 0) return 'Fichier vide : rien à envoyer.'
  const photo = IMAGES_LUES.includes(mime) && (taille === null || taille <= MAX_PHOTO_ENVOI)
  const ext = Object.entries(PAR_EXTENSION).find(([, m]) => m === mime)?.[0] ?? 'bin'
  return {
    mime,
    libelle: TYPES_SORTANTS[mime],
    nom: nomLu ?? (f.type === 'photo' ? 'image.jpg' : `fichier.${ext}`),
    taille,
    methode: photo ? 'sendPhoto' : 'sendDocument',
  }
}

/** « PDF « devis.pdf », 240 Ko, envoyé en fichier ». */
export function descriptionFichier(f: FichierLu): string {
  const nom = /^(image\.jpg|fichier\.[a-z]+)$/.test(f.nom) ? '' : ` « ${f.nom} »`
  return `${f.libelle}${nom}, ${formaterTaille(f.taille)}, ${f.methode === 'sendPhoto' ? 'envoyée en photo' : 'envoyé en fichier'}`
}

/** La legende du fichier : le texte de l'equipe, avec l'en-tete du bot. */
export function legendeFichier(message: string): string {
  return message.trim() ? texteReponseEquipe(message) : "De la part de l'équipe AOK."
}

/** Avec une piece jointe, le texte part en legende : trop long = refus en clair (rien n'est coupe). */
export function refusLegende(legende: string): string | null {
  if (legende.length <= MAX_LEGENDE) return null
  return `Avec une pièce jointe, le texte part en légende : ${MAX_LEGENDE} caractères au plus, en-tête compris `
    + `(${legende.length} ici). Raccourcis-le, ou envoie le texte dans une réponse à part.`
}

/** Le texte du message du fil pour un envoi de l'equipe avec piece : le texte, sinon ce qui est parti. */
export function texteFilEnvoi(message: string, f: Pick<FichierLu, 'methode' | 'nom'>): string {
  if (message.trim()) return message
  return f.methode === 'sendPhoto' ? TEXTE_IMAGE_FIL : `[fichier « ${f.nom} »]`
}

/** La piece du message rendu par Telegram apres sendPhoto ou sendDocument (file_id du bot qui a envoye). */
export function pieceDuResultat(result: unknown, f: Pick<FichierLu, 'mime' | 'nom'>): PieceSupport | null {
  if (!result || typeof result !== 'object') return null
  const lue = lirePieceMessage(result, MAX_IMAGE_LUE)
  if (!lue) return null
  return lue.type === 'photo' ? lue : { ...lue, mime: lue.mime ?? f.mime, nom: lue.nom ?? f.nom }
}

// ---------------------------------------------------------------------------
// 2. L'equipe a la main (Brice, 16/10), 3. le rythme des alertes
// ---------------------------------------------------------------------------
//
// Des qu'un membre de l'equipe repond dans un fil (role human, depuis
// l'onglet Support ou depuis Agent AOK), l'EQUIPE A LA MAIN : le bot ne
// repond plus aux messages ecrits du membre, qui vont a l'equipe (fil en
// attente, alerte « a repondu », un accuse neutre une seule fois). Les
// boutons du menu restent deterministes.
// Le bot reprend la main :
// - quand l'equipe clique « Rendre la main au bot » (onglet Support, bouton
//   sous l'alerte d'Agent AOK, ou « rends la main au bot » a l'agent) : une
//   ligne « [système] » LIGNE_MAIN_RENDUE au fil, et le fil sort de l'attente ;
// - seul, apres DUREE_MAIN_EQUIPE_MS sans AUCUN message de l'equipe dans le
//   fil (glissant : chaque message humain relance le delai), signale dans le
//   resume du matin.
// L'etat se LIT dans les messages du fil (dernier message humain, derniere
// ligne de main rendue) : aucune colonne, aucune migration. Pas de message au
// membre quand le bot reprend la main.

/** Filet de securite : le bot reprend seul la main apres 24 h sans message de l'equipe dans le fil. */
export const DUREE_MAIN_EQUIPE_MS = 24 * 60 * 60 * 1000
/** La ligne « [système] » posee au fil quand l'equipe rend la main au bot. */
export const LIGNE_MAIN_RENDUE = "Main rendue au bot par l'équipe."
/** Au plus une alerte (Agent AOK et email) par fil dans cet intervalle. */
export const INTERVALLE_ALERTES_MS = 10 * 60 * 1000
/** La ligne « [système] » posee au fil quand l'equipe est prevenue : elle date la derniere alerte. */
export const LIGNE_EQUIPE_PREVENUE = 'Équipe prévenue (Agent AOK et email).'
/** L'accuse, court et neutre, une seule fois tant que l'equipe a la main. */
export const TEXTE_ACCUSE_EQUIPE = "Je transmets à l'équipe, elle te répond ici."

type MessageFil = { role?: unknown; content?: unknown; at?: unknown }

function messages(x: unknown): MessageFil[] {
  return Array.isArray(x) ? (x as MessageFil[]).filter((m) => !!m && typeof m === 'object') : []
}

function instant(m: MessageFil): number | null {
  const t = typeof m.at === 'string' ? Date.parse(m.at) : NaN
  return Number.isFinite(t) ? t : null
}

const estLigne = (m: MessageFil, ligne: string) => m.role === 'system' && m.content === `${PREFIXE_SYSTEME}${ligne}`

/**
 * La periode ou l'equipe a la main, lue dans le fil : l'indice de son premier
 * message humain, et l'instant du dernier ; null si l'equipe n'a jamais ecrit,
 * ou si elle a rendu la main depuis son dernier message. Une periode s'ouvre
 * au premier message humain qui suit une main rendue, ou qui arrive 24 h
 * (ou plus) apres le message humain precedent (le bot avait repris seul).
 */
export function periodeEquipe(fil: unknown): { debut: number; dernierHumainT: number | null } | null {
  const l = messages(fil)
  let debut = -1
  let dernier: number | null = null
  let rendue = false
  for (let i = 0; i < l.length; i++) {
    if (l[i].role === 'human') {
      const t = instant(l[i])
      const expiree = t !== null && dernier !== null && t - dernier >= DUREE_MAIN_EQUIPE_MS
      if (debut < 0 || rendue || expiree) debut = i
      rendue = false
      dernier = t
    } else if (estLigne(l[i], LIGNE_MAIN_RENDUE)) {
      rendue = true
    }
  }
  return debut < 0 || rendue ? null : { debut, dernierHumainT: dernier }
}

/**
 * Qui repond aux messages ECRITS du membre : l'equipe si elle a la main
 * (message humain sans main rendue depuis, il y a moins de 24 h), le bot
 * sinon. Un message humain sans date ne garde pas la main.
 */
export function quiRepond(fil: unknown, maintenant: number): 'equipe' | 'bot' {
  const p = periodeEquipe(fil)
  if (!p || p.dernierHumainT === null) return 'bot'
  const ecoule = maintenant - p.dernierHumainT
  return ecoule < DUREE_MAIN_EQUIPE_MS ? 'equipe' : 'bot'
}

/**
 * Le bot a-t-il repris la main SEUL dans la fenetre (depuis, jusqua] ? Rend
 * l'instant de la reprise (dernier message humain + 24 h), ou null. Pour la
 * ligne du resume du matin.
 */
export function repriseAutomatique(fil: unknown, depuis: number, jusqua: number): number | null {
  const p = periodeEquipe(fil)
  if (!p || p.dernierHumainT === null) return null
  const reprise = p.dernierHumainT + DUREE_MAIN_EQUIPE_MS
  return reprise > depuis && reprise <= jusqua ? reprise : null
}

/** Ce que dit Agent AOK (ou l'agent) apres « Rendre la main au bot ». Rien n'est dit au membre. */
export function phraseMainRendue(
  issue: { ok: true; dejaAuBot: boolean } | { ok: false; raison: string },
  reference: string | null,
): string {
  const ref = reference ? ` (${reference})` : ''
  if (!issue.ok) {
    return issue.raison === 'pas_telegram'
      ? `Ce fil${ref} n'est pas un fil du bot Live Club : il n'y a pas de bot à qui rendre la main.`
      : `Ce fil Support${ref} n'existe plus : rien n'a changé.`
  }
  return issue.dejaAuBot
    ? `Le bot avait déjà la main${ref} : rien n'a changé.`
    : `C'est fait${ref} : le bot reprend la main et répond de nouveau à ses messages écrits. Le membre n'est pas prévenu.`
}

/** L'accuse neutre a-t-il deja ete donne depuis que l'equipe a la main ? (une seule fois par periode) */
export function accuseDejaDonne(fil: unknown): boolean {
  const p = periodeEquipe(fil)
  if (!p) return false
  const l = messages(fil)
  for (let i = p.debut + 1; i < l.length; i++) {
    if (l[i].role === 'assistant' && typeof l[i].content === 'string' && (l[i].content as string).startsWith(TEXTE_ACCUSE_EQUIPE)) return true
  }
  return false
}

/** L'instant de la derniere alerte (ligne LIGNE_EQUIPE_PREVENUE), ou null. */
export function derniereAlerteT(fil: unknown): number | null {
  const l = messages(fil)
  for (let i = l.length - 1; i >= 0; i--) if (estLigne(l[i], LIGNE_EQUIPE_PREVENUE)) return instant(l[i])
  return null
}

/** Une alerte peut-elle partir (aucune dans les INTERVALLE_ALERTES_MS precedentes) ? */
export function alerteAutorisee(fil: unknown, maintenant: number): boolean {
  const t = derniereAlerteT(fil)
  return t === null || maintenant - t >= INTERVALLE_ALERTES_MS || maintenant < t
}
