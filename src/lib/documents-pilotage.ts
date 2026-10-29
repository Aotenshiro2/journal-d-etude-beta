// Les documents du trader déposés dans Pilotage (brief D1, 30/10/2026) : la
// reconnaissance SANS IA. Plan : D:\6_Societe\Pilotage\PLAN-EDGYX-REPARTITION.md,
// section 7 bis (« Déposer mes documents »).
//
// Un document arrive (CSV, PDF, HTML, image...). Ici on décide, sans réseau ni
// base :
// - sa nature, aux octets d'abord (signature), puis à l'extension et au type
//   MIME. HEIC, RAR, ZIP, vidéos, classeurs : illisibles, avec la raison, sans
//   appel IA ;
// - ce qui se lit sans IA : les CSV de trades connus (parserFichierTrades), le
//   Cash History de Tradovate (mouvements d'un compte), le Trader Dashboard
//   (solde par compte), un CSV de trades aux colonnes devinées, les relevés
//   MetaTrader 4 en HTML (trades, dépôts, retraits, résumé) ;
// - sinon ce qu'on enverra à l'IA, au moindre coût : le texte d'un PDF lisible
//   (200 caractères utiles au moins) ou d'un HTML, et l'image seulement quand le
//   texte manque (documents-pilotage-ia.ts) ;
// - le compte de Pilotage auquel la lecture se rapproche, la limite de 5
//   lectures IA par jour, le chemin de l'original dans le coffre.
// Brief D3 (30/10/2026, après l'essai à l'aveugle) : les exports Quantower
// (exécutions et ordres, imports-trades.ts) et le relevé annuel d'eToro en PDF
// se lisent sans IA ; le texte envoyé à l'IA est nettoyé des restes
// d'extraction ; `origine` dit si firme et identifiant viennent du document ou
// du seul nom du fichier.
//
// Module PUR : il n'importe que d'autres modules purs (imports-trades, fuseau).
// scripts/verifier-documents.mjs le charge tel quel.

import { empreinteTrade, parserFichierTrades, proposerColonnes, type ColonnesCsv, type TradeNormalise } from './imports-trades'
import { instantDepuisHeureLocale } from './fuseau'

// ── Le contrat ───────────────────────────────────────────────────────────────

export const TYPES_LECTURE = [
  'trades', 'mouvements-compte', 'facture', 'releve-bancaire', 'releve-broker', 'capture-tableau', 'autre', 'illisible',
] as const
export type TypeLecture = (typeof TYPES_LECTURE)[number]

/** csv = lecteur déterministe (CSV, ou relevé MetaTrader en HTML) ; nom = reconnu
 *  au nom et à la signature sans lire le contenu (refus) ; texte = texte extrait
 *  envoyé à l'IA ; vision = PDF ou image envoyés à l'IA comme document. */
export type MethodeLecture = 'csv' | 'nom' | 'texte' | 'vision'

export const TYPES_MOUVEMENT = ['achat', 'renouvellement', 'reset', 'activation', 'payout', 'depot', 'retrait', 'frais', 'autre'] as const
export type TypeMouvement = (typeof TYPES_MOUVEMENT)[number]

export const OBJETS_FACTURE = ['propfirm', 'formation', 'outil', 'autre'] as const
export type ObjetFacture = (typeof OBJETS_FACTURE)[number]

export interface Periode { debut: string; fin: string }

/**
 * Montant signé du point de vue du compte décrit : négatif quand l'argent en
 * sort. `empreinte` (posée par finaliserLecture) : date, type, montant, devise
 * et compte, avec un rang quand deux mouvements identiques se suivent ; la
 * même dans le CSV et le PDF d'un même Cash History.
 */
export interface Mouvement { date: string; type: TypeMouvement; montant: number; devise: string | null; libelle: string; empreinte?: string }

/** Montant négatif quand le trader paie, positif quand c'est lui qui facture (payout). */
export interface Facture {
  fournisseur: string | null
  date: string | null
  montant: number | null
  devise: string | null
  objet: ObjetFacture
  libelle: string
}

/** Exactement ce que rend /api/pilotage/releve. */
export interface Operation { date: string; libelle: string; montant: number }

export interface ReleveBroker {
  broker: string | null
  identifiant: string | null
  periode: Periode | null
  resultat: number | null
  depots: number | null
  /** Négatif (l'argent sort du compte). */
  retraits: number | null
  soldeFin: number | null
  devise: string | null
  /** broker, identifiant, période (posée par finaliserLecture). */
  empreinte?: string
}

export interface CompteCapture { identifiant: string; solde: number | null; pnl: number | null; devise: string | null; compteId: string | null }

export interface Capture {
  date: string | null
  solde: number | null
  pnl: number | null
  devise: string | null
  texte: string
  /** Un export à plusieurs comptes (Trader Dashboard) : le solde de chacun. */
  comptes?: CompteCapture[]
}

/**
 * D'où viennent la firme (ou le broker) et l'identifiant (brief D3) : écrits
 * dans le document, ou tirés du seul nom du fichier (une courbe de solde
 * nommée « Statement-Courtier-123456.png »). null : la valeur manque.
 */
export type Provenance = 'document' | 'nom-de-fichier'
export interface Origine { firme: Provenance | null; identifiant: Provenance | null }

export interface Lecture {
  type: TypeLecture
  methode: MethodeLecture
  confiance: number
  firme: string | null
  broker: string | null
  identifiant: string | null
  /** D'où viennent firme / broker et identifiant (brief D3). Les lecteurs sans IA lisent le document. */
  origine: Origine
  periode: Periode | null
  devise: string | null
  compteId: string | null
  remarque: string
  trades?: TradeNormalise[]
  mouvements?: Mouvement[]
  facture?: Facture | null
  operations?: Operation[]
  releveBroker?: ReleveBroker | null
  capture?: Capture | null
  /** CSV de trades aux colonnes devinées : les en-têtes et la correspondance proposée. */
  entetes?: string[]
  proposition?: Partial<ColonnesCsv>
}

/** Un compte de Pilotage, tel qu'envoyé avec le document (body.comptes). */
export interface ComptePilotage {
  id: string
  nom?: string | null
  firmName?: string | null
  brokerName?: string | null
  identifiants?: string[]
}

/** Une lecture vide d'un type donné : les champs du contrat, tous présents. */
export function lectureVide(type: TypeLecture, methode: MethodeLecture, remarque = ''): Lecture {
  return {
    type, methode, confiance: type === 'illisible' ? 1 : 0, firme: null, broker: null, identifiant: null,
    origine: { firme: null, identifiant: null }, periode: null, devise: null, compteId: null, remarque,
  }
}

// ── Petits lecteurs ──────────────────────────────────────────────────────────

const RE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** « 2026-10-30 » valide (le 31/02 ne passe pas), sinon null. */
export function dateValide(brut: unknown): string | null {
  if (typeof brut !== 'string') return null
  const m = RE_DATE.exec(brut.trim())
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null
  if (+m[1] < 1990 || +m[1] > 2100) return null
  return m[0]
}

/** Montant écrit (« 1,234.50 », « -4.12 », « 1 234,50 », « (12.00) »), arrondi au centime ; null si illisible. */
export function lireNombre(brut: unknown): number | null {
  if (typeof brut === 'number') return Number.isFinite(brut) ? arrondi(brut) : null
  if (typeof brut !== 'string') return null
  let s = brut.trim().replace(/[\s\u00a0\u202f]/g, '').replace(/[$€£¤]|USD|EUR|GBP/gi, '')
  if (!s) return null
  let negatif = false
  if (/^\(.*\)$/.test(s)) { negatif = true; s = s.slice(1, -1) }
  if (s.startsWith('-')) { negatif = !negatif; s = s.slice(1) } else if (s.startsWith('+')) s = s.slice(1)
  if (s.includes('.') && s.includes(',')) s = s.replace(/,/g, '')
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '')
  else s = s.replace(',', '.')
  if (!/^\d*\.?\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? arrondi(negatif ? -n : n) : null
}

const arrondi = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Découpe une ligne CSV (guillemets, « "" » échappé). */
function decouperLigne(ligne: string, sep: string): string[] {
  const champs: string[] = []
  let courant = ''
  let guillemets = false
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i]
    if (guillemets) {
      if (c === '"' && ligne[i + 1] === '"') { courant += '"'; i++ } else if (c === '"') guillemets = false
      else courant += c
    } else if (c === '"') guillemets = true
    else if (c === sep) { champs.push(courant.trim()); courant = '' } else courant += c
  }
  champs.push(courant.trim())
  return champs
}

function separateur(ligne: string): string {
  const n = (c: string) => ligne.split(c).length - 1
  const candidats: [string, number][] = [[',', n(',')], [';', n(';')], ['\t', n('\t')]]
  candidats.sort((a, b) => b[1] - a[1])
  return candidats[0][1] > 0 ? candidats[0][0] : ','
}

/** Les lignes non vides d'un CSV, sans BOM ni la ligne « sep=, » qu'Excel met en tête. */
export function lignesCsv(texte: string): string[] {
  const lignes = texte.replace(/^\ufeff/, '').split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lignes.length > 0 && /^"?sep=.?"?$/i.test(lignes[0].trim())) lignes.shift()
  return lignes
}

/** Le tableau d'un CSV : en-têtes et cellules (séparateur du fichier). */
function tableauCsv(texte: string): { entetes: string[]; lignes: string[][]; brut: string } {
  const lignes = lignesCsv(texte)
  if (lignes.length === 0) return { entetes: [], lignes: [], brut: '' }
  const sep = separateur(lignes[0])
  return { entetes: decouperLigne(lignes[0], sep), lignes: lignes.slice(1).map(l => decouperLigne(l, sep)), brut: lignes.join('\n') }
}

/** La première et la dernière date d'une liste (AAAA-MM-JJ), ou null. */
export function periodeDe(dates: (string | null | undefined)[]): Periode | null {
  const valides = dates.filter((d): d is string => !!d && dateValide(d) !== null).sort()
  return valides.length > 0 ? { debut: valides[0], fin: valides[valides.length - 1] } : null
}

const unique = <T,>(valeurs: T[]): T | null => {
  const set = [...new Set(valeurs.filter(v => v !== null && v !== undefined && v !== ''))]
  return set.length === 1 ? set[0] : null
}

/** La firme d'après le préfixe d'un identifiant de compte (« APEX-12345-01 », « PA-APEX... »). */
export function firmeDuCompte(identifiant: string | null | undefined): string | null {
  if (!identifiant) return null
  if (/^(PA-)?APEX/i.test(identifiant.trim())) return 'Apex'
  return null
}

// ── La nature du document ───────────────────────────────────────────────────

export type Famille = 'csv' | 'texte' | 'pdf' | 'html' | 'image' | 'refuse'
export type MediaImage = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export interface Nature {
  famille: Famille
  /** Le type MIME retenu pour le coffre (reconnu aux octets quand c'est possible). */
  mime: string
  media?: MediaImage
  /** Pour un refus : pourquoi, dit au membre. */
  raison?: string
}

const ascii = (o: Uint8Array, debut: number, fin: number) => String.fromCharCode(...o.subarray(debut, fin))
const commencePar = (o: Uint8Array, octets: number[], decalage = 0) => octets.every((b, i) => o[decalage + i] === b)

const REFUS = {
  heic: "Photo HEIC (iPhone) : elle ne se lit pas ici. Exporte-la en JPEG ou en PNG, ou fais-en une capture d'écran.",
  video: "Vidéo : elle ne se lit pas. Fais une capture de l'écran qui compte.",
  audio: 'Fichier audio : il ne se lit pas.',
  archive: "Archive (ZIP, RAR, 7z) : décompresse-la et dépose les fichiers qu'elle contient.",
  classeur: 'Classeur (Excel, Numbers) : enregistre la feuille en CSV, ou en PDF, puis dépose-la.',
  traitement: 'Document Word ou Pages : enregistre-le en PDF puis dépose-le.',
  inconnu: "Format inconnu : dépose un CSV, un PDF, une page HTML ou une image (PNG, JPEG).",
} as const

const EXTENSIONS_REFUSEES: [RegExp, string][] = [
  [/^(heic|heif)$/, REFUS.heic],
  [/^(mov|mp4|m4v|avi|mkv|webm|wmv|flv|3gp)$/, REFUS.video],
  [/^(mp3|wav|m4a|aac|ogg|flac)$/, REFUS.audio],
  [/^(zip|rar|7z|tar|gz|tgz|bz2)$/, REFUS.archive],
  [/^(xlsx|xlsm|xls|ods|numbers)$/, REFUS.classeur],
  [/^(docx|doc|pages|odt|rtf)$/, REFUS.traitement],
]

/** L'extension en minuscules (« .PDF » donne « pdf »). */
export function extensionDe(nom: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(nom.trim())
  return m ? m[1].toLowerCase() : ''
}

/** Peu de caractères de contrôle : c'est du texte (CSV, TXT, OFX...). */
function ressembleATexte(octets: Uint8Array): boolean {
  const n = Math.min(octets.length, 4096)
  if (n === 0) return false
  let controles = 0
  for (let i = 0; i < n; i++) {
    const b = octets[i]
    if (b === 0) return false
    if (b < 9 || (b > 13 && b < 32)) controles++
  }
  return controles / n < 0.01
}

/**
 * La nature d'un document : les octets d'abord (un .pdf renommé .png reste un
 * PDF), puis l'extension, puis le type MIME envoyé par le navigateur.
 */
export function natureDuDocument(nom: string, type: string, octets: Uint8Array): Nature {
  const ext = extensionDe(nom)
  const mime = (type || '').toLowerCase().split(';')[0].trim()
  const refus = (raison: string): Nature => ({ famille: 'refuse', mime: mime || 'application/octet-stream', raison })

  // Signatures.
  if (commencePar(octets, [0x25, 0x50, 0x44, 0x46])) return { famille: 'pdf', mime: 'application/pdf' }
  if (commencePar(octets, [0x89, 0x50, 0x4e, 0x47])) return { famille: 'image', mime: 'image/png', media: 'image/png' }
  if (commencePar(octets, [0xff, 0xd8, 0xff])) return { famille: 'image', mime: 'image/jpeg', media: 'image/jpeg' }
  if (commencePar(octets, [0x47, 0x49, 0x46, 0x38])) return { famille: 'image', mime: 'image/gif', media: 'image/gif' }
  if (octets.length >= 12 && ascii(octets, 0, 4) === 'RIFF' && ascii(octets, 8, 12) === 'WEBP') {
    return { famille: 'image', mime: 'image/webp', media: 'image/webp' }
  }
  if (octets.length >= 12 && ascii(octets, 4, 8) === 'ftyp') {
    const marque = ascii(octets, 8, 12).toLowerCase()
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(marque)) return refus(REFUS.heic)
    return refus(REFUS.video) // qt, isom, mp41, mp42, m4v, 3gp...
  }
  if (commencePar(octets, [0x52, 0x61, 0x72, 0x21]) || commencePar(octets, [0x37, 0x7a, 0xbc, 0xaf])) return refus(REFUS.archive)
  if (commencePar(octets, [0x1f, 0x8b])) return refus(REFUS.archive)
  if (commencePar(octets, [0x50, 0x4b, 0x03, 0x04])) {
    if (/^(xlsx|xlsm|ods|numbers)$/.test(ext)) return refus(REFUS.classeur)
    if (/^(docx|odt|pages)$/.test(ext)) return refus(REFUS.traitement)
    return refus(REFUS.archive)
  }
  if (commencePar(octets, [0xd0, 0xcf, 0x11, 0xe0])) return refus(ext === 'doc' ? REFUS.traitement : REFUS.classeur)

  // Extension.
  for (const [re, raison] of EXTENSIONS_REFUSEES) if (re.test(ext)) return refus(raison)
  if (mime.startsWith('video/')) return refus(REFUS.video)
  if (mime.startsWith('audio/')) return refus(REFUS.audio)
  if (mime === 'image/heic' || mime === 'image/heif') return refus(REFUS.heic)
  if (ext === 'pdf' || mime === 'application/pdf') return refus("PDF illisible : le fichier ne commence pas comme un PDF, il est sans doute abîmé.")

  if (!ressembleATexte(octets) && !(octets[0] === 0xff && octets[1] === 0xfe) && !(octets[0] === 0xfe && octets[1] === 0xff)) {
    return refus(REFUS.inconnu)
  }
  if (ext === 'htm' || ext === 'html' || mime === 'text/html') return { famille: 'html', mime: 'text/html' }
  if (ext === 'csv' || ext === 'tsv' || mime === 'text/csv') return { famille: 'csv', mime: 'text/csv' }
  const debut = decoderTexte(octets.subarray(0, 2048)).trimStart().slice(0, 200).toLowerCase()
  if (debut.startsWith('<!doctype html') || debut.startsWith('<html')) return { famille: 'html', mime: 'text/html' }
  return { famille: 'texte', mime: 'text/plain' }
}

/** Le texte d'un fichier : UTF-8 (BOM ou non), UTF-16 (BOM, relevés MetaTrader 5), sinon Windows-1252. */
export function decoderTexte(octets: Uint8Array): string {
  if (octets[0] === 0xff && octets[1] === 0xfe) return new TextDecoder('utf-16le').decode(octets.subarray(2))
  if (octets[0] === 0xfe && octets[1] === 0xff) return new TextDecoder('utf-16be').decode(octets.subarray(2))
  const corps = octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf ? octets.subarray(3) : octets
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(corps)
  } catch {
    return new TextDecoder('windows-1252').decode(corps)
  }
}

// ── Texte avant image ───────────────────────────────────────────────────────

/** Seuil du brief : au moins 200 caractères utiles pour lire le texte plutôt que l'image. */
export const SEUIL_TEXTE_UTILE = 200

/** Les caractères qui portent du sens (lettres et chiffres), espaces et ponctuation exclus. */
export function caracteresUtiles(texte: string | null | undefined): number {
  if (!texte) return 0
  return (texte.match(/[\p{L}\p{N}]/gu) ?? []).length
}

/** Ce qui ne se lit pas : contrôles (sauf tabulation et fins de ligne), largeur nulle, direction, trait d'union conditionnel, BOM, sélecteurs de variante, tags. */
function illisible(cp: number): boolean {
  return (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) || (cp >= 0x7f && cp <= 0x9f)
    || cp === 0x00ad || cp === 0x034f || cp === 0x061c || cp === 0x180e
    || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x206f)
    || cp === 0xfeff || (cp >= 0xfff9 && cp <= 0xfffb) || (cp >= 0xfe00 && cp <= 0xfe0f)
    || (cp >= 0xe0000 && cp <= 0xe007f) || (cp >= 0xe0100 && cp <= 0xe01ef)
}

/**
 * Le texte extrait (PDF, HTML, CSV) débarrassé de ce qui ne se lit pas (brief
 * D3) : les restes d'extraction d'un PDF (caractères de contrôle et
 * invisibles) ne gênent plus ni l'IA ni le contrôle des consignes. Le texte
 * caché en caractères « tag » (ASCII invisible) est rendu lisible : une
 * consigne qui s'y cachait se lit alors comme du texte, et se contrôle.
 */
export function nettoyerTexteExtrait(texte: string): string {
  let sortie = ''
  for (const c of texte) {
    const cp = c.codePointAt(0) as number
    if (cp >= 0xe0020 && cp <= 0xe007e) sortie += String.fromCharCode(cp - 0xe0000)
    else if (!illisible(cp)) sortie += c
  }
  return sortie
}

/** Un PDF dont le texte se sélectionne se lit en texte ; un scan ou une capture, en image. */
export function methodePourPdf(texteExtrait: string | null | undefined): 'texte' | 'vision' {
  return caracteresUtiles(texteExtrait) >= SEUIL_TEXTE_UTILE ? 'texte' : 'vision'
}

const ENTITES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", euro: '€', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' }

function decoderEntites(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    }
    return ENTITES[e.toLowerCase()] ?? tout
  })
}

/** Le texte d'une cellule ou d'un fragment HTML : balises retirées, entités décodées, espaces resserrés. */
function texteFragment(html: string): string {
  return decoderEntites(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')).replace(/[\s\u00a0]+/g, ' ').trim()
}

/**
 * Le texte d'une page HTML pour l'IA : le titre, puis le corps, une ligne par
 * rangée de tableau (cellules séparées par « | »). Scripts, styles et
 * commentaires retirés.
 */
export function texteDuHtml(html: string): string {
  const titre = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const corps = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(td|th)\s*>/gi, ' | ')
    .replace(/<br\s*\/?>|<\/(tr|p|div|h[1-6]|li|table|caption|section|article)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
  const lignes = decoderEntites(corps)
    .split('\n')
    .map(l => l.replace(/[ \t\u00a0]+/g, ' ').replace(/(\s*\|\s*)+$/, '').replace(/^(\s*\|\s*)+/, '').trim())
    .filter(l => l && !/^[|\s]+$/.test(l))
  const t = titre ? texteFragment(titre[1]) : ''
  return [t, ...lignes].filter(Boolean).join('\n')
}

// ── Les lecteurs sans IA ────────────────────────────────────────────────────

const ENTETES_CASH = ['Account', 'Transaction ID', 'Timestamp', 'Date', 'Delta', 'Amount', 'Cash Change Type', 'Currency']

/** Le type d'un mouvement du Cash History de Tradovate, d'après « Cash Change Type ». */
export function typeCashChange(brut: string): TypeMouvement {
  const s = brut.trim().toLowerCase()
  if (/payout/.test(s)) return 'payout'
  if (/commission|fee|clearing|exchange|nfa|charge/.test(s)) return 'frais'
  if (/deposit|funding/.test(s)) return 'depot'
  if (/withdraw/.test(s)) return 'retrait'
  return 'autre'
}

/**
 * Cash History de Tradovate (« Cash History.csv ») : une ligne = un mouvement
 * du compte (Delta signé). Les types suivent « Cash Change Type » : payout,
 * frais (commissions, frais de bourse), dépôt, retrait, autre (« Trade
 * Paired » : le résultat d'un trade apparié).
 */
export function lireCashHistory(texte: string): Lecture | null {
  const { entetes, lignes } = tableauCsv(texte)
  if (!ENTETES_CASH.every(e => entetes.includes(e))) return null
  const idx = (nom: string) => entetes.indexOf(nom)
  const mouvements: Mouvement[] = []
  const comptes: string[] = []
  const devises: string[] = []
  let illisibles = 0
  for (const c of lignes) {
    const val = (nom: string) => (idx(nom) >= 0 ? c[idx(nom)] ?? '' : '')
    let date = dateValide(val('Date'))
    if (!date) {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(val('Timestamp'))
      date = m ? dateValide(`${m[3]}-${m[1]}-${m[2]}`) : null
    }
    const montant = lireNombre(val('Delta'))
    if (!date || montant === null) { illisibles++; continue }
    if (montant === 0) continue
    const genre = val('Cash Change Type').trim()
    const devise = /^[A-Za-z]{3}$/.test(val('Currency')) ? val('Currency').toUpperCase() : null
    if (val('Account')) comptes.push(val('Account'))
    if (devise) devises.push(devise)
    mouvements.push({
      date,
      type: typeCashChange(genre),
      montant,
      devise,
      libelle: [genre || 'Mouvement', val('Contract')].filter(Boolean).join(' ').slice(0, 200),
    })
  }
  const identifiant = unique(comptes)
  const plusieurs = new Set(comptes).size > 1
  const remarques = [
    `Cash History de Tradovate lu sans IA : ${mouvements.length} mouvement${mouvements.length > 1 ? 's' : ''}.`,
    illisibles > 0 ? `${illisibles} ligne${illisibles > 1 ? 's' : ''} illisible${illisibles > 1 ? 's' : ''} ignorée${illisibles > 1 ? 's' : ''}.` : '',
    plusieurs ? 'Le fichier mélange plusieurs comptes.' : '',
  ]
  return {
    ...lectureVide('mouvements-compte', 'csv'),
    confiance: illisibles > 0 || plusieurs ? 0.8 : 1,
    firme: firmeDuCompte(identifiant),
    broker: 'Tradovate',
    identifiant,
    periode: periodeDe(mouvements.map(m => m.date)),
    devise: unique(devises),
    remarque: remarques.filter(Boolean).join(' '),
    mouvements,
  }
}

const ENTETES_DASHBOARD = ['Account', 'Account Balance', 'P&L']

/**
 * Trader Dashboard (export de la liste des comptes, « Trader Dashboard -
 * Apex.csv ») : le solde et le P&L de chaque compte au moment de l'export.
 * Le fichier ne porte aucune date.
 */
export function lireTraderDashboard(texte: string): Lecture | null {
  const { entetes, lignes } = tableauCsv(texte)
  if (!ENTETES_DASHBOARD.every(e => entetes.includes(e))) return null
  const idx = (nom: string) => entetes.indexOf(nom)
  const comptes: CompteCapture[] = []
  for (const c of lignes) {
    const val = (nom: string) => (idx(nom) >= 0 ? c[idx(nom)] ?? '' : '')
    const identifiant = val('Account').slice(0, 80)
    if (!identifiant) continue
    const devise = /^[A-Za-z]{3}$/.test(val('Account Currency')) ? val('Account Currency').toUpperCase() : null
    comptes.push({ identifiant, solde: lireNombre(val('Account Balance')), pnl: lireNombre(val('P&L')), devise, compteId: null })
  }
  if (comptes.length === 0) return null
  const seul = comptes.length === 1 ? comptes[0] : null
  const firmes = comptes.map(c => firmeDuCompte(c.identifiant))
  return {
    ...lectureVide('capture-tableau', 'csv'),
    confiance: 1,
    firme: firmes.every(f => f && f === firmes[0]) ? firmes[0] : null,
    identifiant: seul?.identifiant ?? null,
    devise: unique(comptes.map(c => c.devise)),
    remarque: `Tableau de bord lu sans IA : ${comptes.length} compte${comptes.length > 1 ? 's' : ''}. Le fichier ne porte pas de date : les soldes sont ceux du jour de l'export.`,
    capture: { date: null, solde: seul?.solde ?? null, pnl: seul?.pnl ?? null, devise: unique(comptes.map(c => c.devise)), texte: '', comptes },
  }
}

const BROKERS_FORMAT: Record<string, { broker: string | null; firme: string | null }> = {
  'tradovate-performance': { broker: 'Tradovate', firme: null },
  'topstepx-trades': { broker: 'TopstepX', firme: 'Topstep' },
  // Quantower est une plateforme : le fichier ne dit ni la firme ni le broker.
  'quantower-executions': { broker: null, firme: null },
  'quantower-orders': { broker: null, firme: null },
}

const jourDe = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Un CSV : Cash History, Trader Dashboard, puis les trades (formats connus de
 * parserFichierTrades ; sinon les colonnes devinées à leur nom, si symbole,
 * entrée et P&L s'y trouvent). Null : le CSV n'est pas reconnu, l'IA le lira.
 */
export function lireCsv(texte: string, nom: string): Lecture | null {
  const cash = lireCashHistory(texte)
  if (cash) return cash
  const tableau = lireTraderDashboard(texte)
  if (tableau) return tableau

  const lignes = lignesCsv(texte)
  if (lignes.length === 0) return { ...lectureVide('illisible', 'csv'), remarque: 'Fichier vide.' }
  const propre = lignes.join('\n')
  const lu = parserFichierTrades(propre, nom)
  const avecTrades = (trades: TradeNormalise[], format: string, confiance: number, remarque: string, extra: Partial<Lecture> = {}): Lecture => {
    const origine = BROKERS_FORMAT[format] ?? { broker: null, firme: null }
    return {
      ...lectureVide('trades', 'csv'),
      confiance,
      firme: origine.firme,
      broker: origine.broker,
      // Plusieurs sous-comptes d'un même compte (Quantower) : le compte commun.
      identifiant: unique(trades.map(t => t.compte)) ?? lu.compte ?? null,
      periode: periodeDe(trades.map(t => jourDe(t.entreLe))),
      devise: unique(trades.map(t => t.devise)),
      remarque,
      trades,
      ...extra,
    }
  }
  if (lu.format && lu.format !== 'csv-generique') {
    const n = lu.trades.length
    const remarque = [
      `Export de trades lu sans IA (${lu.format}) : ${n} trade${n > 1 ? 's' : ''}.`,
      ...(lu.remarques ?? []),
      ...lu.erreurs.slice(0, 3),
    ].join(' ')
    return avecTrades(lu.trades, lu.format, n > 0 ? 1 : 0.9, remarque.trim())
  }

  // CSV générique : des trades seulement si les colonnes indispensables se devinent.
  const entetes = lu.entetes ?? []
  const proposition = lu.proposition ?? proposerColonnes(entetes)
  if (!proposition.symbole || !proposition.entreLe || !proposition.pnl) return null
  const essai = parserFichierTrades(propre, nom, proposition)
  const erreurs = essai.erreurs.length > 0 ? ` ${essai.erreurs.slice(0, 3).join(' ')}` : ''
  return avecTrades(
    essai.trades, 'csv-generique', essai.trades.length > 0 ? 0.6 : 0.4,
    `Colonnes devinées d'après leurs noms : vérifie-les avant d'importer (${essai.trades.length} trade${essai.trades.length > 1 ? 's' : ''} lus).${erreurs}`,
    { entetes, proposition },
  )
}

// ── Les PDF de Tradovate, lus sans IA ───────────────────────────────────────
//
// Le rapport Performance et le Cash History existent en CSV et en PDF, avec
// les mêmes données. Leur texte est régulier : on le lit comme le CSV, pour
// que les deux versions d'un même rapport donnent les mêmes faits et les mêmes
// clés (aucun appel IA, aucun écart de lecture).

const RE_HEURE_US = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/

/** « MM/DD/YYYY HH:mm:ss » telle qu'affichée, codée comme UTC (comme lireDateUs du lecteur CSV). */
function heureUs(brut: string): Date | null {
  const m = RE_HEURE_US.exec(brut.trim())
  if (!m) return null
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6]))
  return Number.isNaN(d.getTime()) || d.getUTCDate() !== +m[2] ? null : d
}

/** « 1h 5min 10sec » en secondes, null si rien ne se lit. */
function dureeTexte(brut: string): number | null {
  const h = /(\d+)\s*h/.exec(brut)
  const min = /(\d+)\s*min/.exec(brut)
  const sec = /(\d+)\s*sec/.exec(brut)
  return h || min || sec ? (h ? +h[1] * 3600 : 0) + (min ? +min[1] * 60 : 0) + (sec ? +sec[1] : 0) : null
}

const HEURE = String.raw`\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}`
const PRIX = String.raw`\d[\d,]*(?:\.\d+)?`
const RE_TRADE_PERFORMANCE = new RegExp(
  String.raw`([A-Z][A-Z0-9]{1,11}) (\d+) (${PRIX}) (${HEURE}) ((?:\d+h ?)?(?:\d+min ?)?(?:\d+sec)?) ?(${HEURE}) (${PRIX}) (\$?\(?-?\$?\d[\d,]*\.\d{2}\)?)`, 'g',
)

/**
 * Le rapport Performance de Tradovate en PDF (« Performance.20250215.131220.pdf ») :
 * le tableau TRADES (Symbol, Qty, Buy Price, Buy Time, Duration, Sell Time,
 * Sell Price, P&L) donne les mêmes trades que le CSV, sans les ids de fills :
 * même source (tradovate-performance), clé = l'empreinte (empreinteTrade),
 * celle du CSV quand ses ids manquent. Le CSV et le PDF d'un même rapport se
 * reconnaissent à l'import par cette empreinte (connusParEmpreinte).
 */
export function lirePerformancePdf(texte: string): Lecture | null {
  const plat = texte.replace(/\s+/g, ' ')
  const debut = plat.search(/Symbol Qty Buy Price Buy Time Duration Sell Time Sell Price P&L/)
  if (debut < 0 || !/ALL TRADES/.test(plat)) return null
  const trades: TradeNormalise[] = []
  const rangs = new Map<string, number>()
  for (const m of plat.slice(debut).matchAll(RE_TRADE_PERFORMANCE)) {
    const [, symbole, qte, prixAchat, achat, duree, vente, prixVente, resultat] = m
    const achatLe = heureUs(achat)
    const venteLe = heureUs(vente)
    const pnl = lireNombre(resultat)
    if (!achatLe || !venteLe || pnl === null) continue
    const direction: 'long' | 'short' = achatLe.getTime() <= venteLe.getTime() ? 'long' : 'short'
    const entreLe = direction === 'long' ? achatLe : venteLe
    const quantite = Math.abs(parseInt(qte, 10)) || 1
    const cle = empreinteTrade({ symbole, entreLe, quantite, pnl })
    const rang = (rangs.get(cle) ?? 0) + 1
    rangs.set(cle, rang)
    trades.push({
      source: 'tradovate-performance',
      idExterne: rang === 1 ? cle : `${cle}#${rang}`,
      compte: null,
      symbole,
      direction,
      quantite,
      prixEntree: lireNombre(direction === 'long' ? prixAchat : prixVente),
      prixSortie: lireNombre(direction === 'long' ? prixVente : prixAchat),
      entreLe,
      sortiLe: direction === 'long' ? venteLe : achatLe,
      pnl,
      devise: 'USD',
      frais: null,
      dureeSec: dureeTexte(duree),
    })
  }
  const annonce = /# of Trades (\d+)/.exec(plat)
  const attendu = annonce ? +annonce[1] : null
  const complet = attendu === null || attendu === trades.length
  return {
    ...lectureVide('trades', 'csv'),
    confiance: trades.length > 0 && complet ? 1 : 0.7,
    broker: 'Tradovate',
    periode: periodeDe(trades.map(t => jourDe(t.entreLe))),
    devise: trades.length > 0 ? 'USD' : null,
    remarque: [
      `Rapport Performance de Tradovate (PDF) lu sans IA : ${trades.length} trade${trades.length > 1 ? 's' : ''}.`,
      complet ? '' : `Le rapport en annonce ${attendu} : préfère son export CSV.`,
    ].filter(Boolean).join(' '),
    trades,
  }
}

const RE_LIGNE_CASH = new RegExp(
  String.raw`Date: (\d{4}-\d{2}-\d{2}) acc\. #: (\S+)|(\d{6,}) (?:([A-Z][A-Z0-9]{1,11}) )?(${HEURE}) (-?[\d,]*\.?\d+) (-?[\d,]*\.?\d+) ([A-Z]{3}) ([A-Za-z][A-Za-z ]*?)(?= \d| Date:| TOTAL:|$)`, 'g',
)

/**
 * Le Cash History de Tradovate en PDF : des sections « Date: AAAA-MM-JJ acc.
 * #: COMPTE », puis une ligne par mouvement (Transaction ID, Contract,
 * Timestamp, Delta, Amount, Currency, Cash Change Type). Mêmes mouvements que
 * le CSV (date de la section = colonne Date du CSV, même type, même libellé).
 */
export function lireCashHistoryPdf(texte: string): Lecture | null {
  const plat = texte.replace(/\s+/g, ' ').trim()
  if (!/acc\. #:/.test(plat) || !/Cash Change Type/.test(plat)) return null
  const mouvements: Mouvement[] = []
  const comptes: string[] = []
  const devises: string[] = []
  let date: string | null = null
  let lignes = 0
  for (const m of plat.matchAll(RE_LIGNE_CASH)) {
    if (m[1]) { date = dateValide(m[1]); comptes.push(m[2]); continue }
    lignes++
    const [, , , , contrat, , delta, , devise, genreBrut] = m
    const montant = lireNombre(delta)
    if (!date || montant === null || montant === 0) continue
    const genre = genreBrut.trim()
    devises.push(devise)
    mouvements.push({ date, type: typeCashChange(genre), montant, devise, libelle: [genre, contrat].filter(Boolean).join(' ').slice(0, 200) })
  }
  const annonce = /TOTAL: ?transactions ?(\d+)/.exec(plat)
  const complet = !annonce || +annonce[1] === lignes
  const identifiant = unique(comptes)
  return {
    ...lectureVide('mouvements-compte', 'csv'),
    confiance: complet ? 1 : 0.7,
    firme: firmeDuCompte(identifiant),
    broker: 'Tradovate',
    identifiant,
    periode: periodeDe(mouvements.map(m => m.date)),
    devise: unique(devises),
    remarque: [
      `Cash History de Tradovate (PDF) lu sans IA : ${mouvements.length} mouvement${mouvements.length > 1 ? 's' : ''}.`,
      complet ? '' : `Le relevé en annonce ${annonce![1]} : préfère son export CSV.`,
      new Set(comptes).size > 1 ? 'Le fichier mélange plusieurs comptes.' : '',
    ].filter(Boolean).join(' '),
    mouvements,
  }
}

// ── Le relevé annuel d'eToro en PDF (brief D3) ──────────────────────────────
//
// Le texte du relevé (« account statement ») est régulier : un récapitulatif,
// la table des positions fermées (une position sur plusieurs lignes : action et
// nom de l'instrument, identifiant, montant, unités, ouverture, clôture,
// levier, spread, bénéfice, taux d'ouverture, de clôture, take profit, stop
// loss, frais de roulement et dividendes, type, ISIN), puis l'activité du
// compte (dépôts, retraits, frais, dividendes). L'IA n'en rendait que 25
// lignes : il se lit sans IA, en entier, que le texte soit en français ou en
// anglais.

const MOIS_COURTS: Record<string, number> = {
  JAN: 1, JANV: 1, FEB: 2, FEV: 2, FEVR: 2, MAR: 3, MARS: 3, APR: 4, AVR: 4, MAY: 5, MAI: 5, JUN: 6, JUIN: 6,
  JUL: 7, JUIL: 7, AUG: 8, AOU: 8, AOUT: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
}

/** « JANV. 1, 2018 », « Dec 31, 2018 » en AAAA-MM-JJ, ou null. */
function dateMoisEcrit(mot: string, jour: string, annee: string): string | null {
  const mois = MOIS_COURTS[mot.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\./g, '').toUpperCase()]
  return mois ? dateValide(`${annee}-${String(mois).padStart(2, '0')}-${jour.padStart(2, '0')}`) : null
}

const NOMBRE_ETORO = String.raw`\(?-?\d[\d,]*(?:\.\d+)?\)?`
const DATE_ETORO = String.raw`\d{2}[-/.]\d{2}[-/.]\d{4} \d{2}:\d{2}(?::\d{2})?`
const FIN_POSITION = String.raw`(?= (?:Buy|Sell) | (?:Activité du compte|Account Activity)\b|$)`
// Le nom de l'instrument ne traverse jamais une autre position (aucun mot « Buy » ou « Sell ») :
// une position coupée par la mise en page est perdue seule, sans avaler la suivante.
const RE_POSITION_ETORO = new RegExp(
  String.raw`(Buy|Sell) ((?:(?!(?:Buy|Sell) )\S+ )+?)(\d{5,12}) (${NOMBRE_ETORO}) (${NOMBRE_ETORO}) (${DATE_ETORO}) (${DATE_ETORO}) X?(\d+(?:\.\d+)?) `
  + String.raw`(${NOMBRE_ETORO}) (${NOMBRE_ETORO}) (${NOMBRE_ETORO}) (${NOMBRE_ETORO}) (${NOMBRE_ETORO}) (${NOMBRE_ETORO}) (${NOMBRE_ETORO}) `
  + String.raw`([^\d() ][^\d()]*?)(?: ([A-Z]{2}[A-Z0-9]{9}\d))?${FIN_POSITION}`,
  'g',
)

/** Les dates « JJ-MM-AAAA HH:MM:SS » d'eToro (jour d'abord, sauf si une date dit le contraire), codées comme UTC. */
function lecteurDatesEtoro(valeurs: string[]): (brut: string) => Date | null {
  const re = /^(\d{2})[-/.](\d{2})[-/.](\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/
  const moisDabord = valeurs.some(v => { const m = re.exec(v); return !!m && +m[2] > 12 })
  return brut => {
    const m = re.exec(brut.trim())
    if (!m) return null
    const [jour, mois] = moisDabord ? [m[2], m[1]] : [m[1], m[2]]
    const d = new Date(Date.UTC(+m[3], +mois - 1, +jour, +m[4], +m[5], +(m[6] ?? 0)))
    return Number.isNaN(d.getTime()) || d.getUTCDate() !== +jour || d.getUTCMonth() !== +mois - 1 ? null : d
  }
}

/** Un montant du récapitulatif (« Dépôts 1234.56 », « Deposits 1,234.56 »), ou null. */
function montantResume(plat: string, libelles: string[]): number | null {
  for (const l of libelles) {
    const m = new RegExp(`${l} (${NOMBRE_ETORO})(?= |$)`).exec(plat)
    if (m) return lireNombre(m[1])
  }
  return null
}

/**
 * Relevé d'eToro en PDF : releve-broker, toutes les positions fermées en
 * trades (source etoro-statement, clé = identifiant de la position, pnl =
 * bénéfice, frais = frais de roulement quand ils sont négatifs), les dépôts et
 * retraits de l'activité du compte en mouvements, le récapitulatif en
 * releveBroker. Identifiant = le nom d'utilisateur eToro (le relevé n'a pas
 * d'autre numéro de compte). Null si ce n'est pas un relevé eToro.
 */
export function lireReleveEtoro(texte: string): Lecture | null {
  const plat = texte.replace(/\s+/g, ' ').trim()
  if (!/eToro/i.test(plat)) return null
  const debut = plat.search(/(Positions fermées|Closed Positions)\b/i)
  if (debut < 0) return null
  const finTable = plat.slice(debut).search(/(Activité du compte|Account Activity)\b/i)
  const table = (finTable < 0 ? plat.slice(debut) : plat.slice(debut, debut + finTable)).trim()

  const positions = [...table.matchAll(RE_POSITION_ETORO)]
  if (positions.length === 0) return null
  const quand = lecteurDatesEtoro(positions.flatMap(p => [p[6], p[7]]))
  const utilisateur = /(?:Nom d.utilisateur|Username|User name)\s*:\s*(\S+)/i.exec(plat)?.[1]?.slice(0, 80) ?? null
  // Les positions annoncées par la table (chaque ligne commence par Buy ou Sell suivi d'un nom) : celles qu'on n'a pas lues se disent.
  const annoncees = (table.match(/(?:^| )(?:Buy|Sell) (?!\d)/g) ?? []).length
  const broker = /(eToro \([A-Za-z]+\) (?:Ltd|Limited|GmbH|AG|S\.A\.)\.?|eToro [A-Z][A-Za-z]* (?:Ltd|Limited)\.?)/.exec(plat)?.[1] ?? 'eToro'

  const trades: TradeNormalise[] = []
  const vus = new Set<string>()
  let illisibles = 0
  for (const p of positions) {
    const [, action, nom, id, , unites, ouverture, cloture, , , benefice, tauxOuverture, tauxCloture, , stop, roulement] = p
    const entreLe = quand(ouverture)
    const sortiLe = quand(cloture)
    const quantite = lireNombre(unites)
    const pnl = lireNombre(benefice)
    if (!entreLe || !sortiLe || quantite === null || quantite <= 0 || pnl === null || vus.has(id)) { illisibles++; continue }
    vus.add(id)
    const frais = lireNombre(roulement)
    const stopPrix = lireNombre(stop)
    trades.push({
      source: 'etoro-statement',
      idExterne: id,
      compte: utilisateur,
      symbole: nom.trim().slice(0, 40),
      direction: action === 'Buy' ? 'long' : 'short',
      quantite,
      prixEntree: lireNombre(tauxOuverture),
      prixSortie: lireNombre(tauxCloture),
      entreLe,
      sortiLe,
      pnl,
      devise: 'USD',
      frais: frais !== null && frais < 0 ? -frais : null,
      dureeSec: Math.round((sortiLe.getTime() - entreLe.getTime()) / 1000),
      fuseau: null,
      stopPrix: stopPrix === null || stopPrix <= 0 ? null : stopPrix,
    })
  }

  // L'activité du compte : dépôts et retraits (les quatre derniers nombres d'une ligne : montant, changement, équité, solde).
  const mouvements: Mouvement[] = []
  if (finTable >= 0) {
    const activite = plat.slice(debut + finTable)
    for (const m of activite.matchAll(new RegExp(String.raw`(${DATE_ETORO}) (Deposit|Dépôt|Withdraw\w*|Retrait\w*)\b(.*?)(?= ${DATE_ETORO}|$)`, 'g'))) {
      const nombres = m[3].match(new RegExp(NOMBRE_ETORO, 'g')) ?? []
      const montant = nombres.length >= 4 ? lireNombre(nombres[nombres.length - 4]) : null
      const d = quand(m[1])
      if (montant === null || montant === 0 || !d) continue
      const depot = /^(Deposit|Dépôt)/i.test(m[2])
      mouvements.push({
        date: jourDe(d),
        type: depot ? 'depot' : 'retrait',
        montant: depot ? Math.abs(montant) : -Math.abs(montant),
        devise: 'USD',
        libelle: (depot ? 'Dépôt' : 'Retrait'),
      })
    }
  }

  const resume = /(?:Récapitulatif du compte|Account Summary) ([A-Za-zÀ-ÿ]+)\.? (\d{1,2}), (\d{4}) (?:to|au|à) ([A-Za-zÀ-ÿ]+)\.? (\d{1,2}), (\d{4})/i.exec(plat)
  const debutPeriode = resume ? dateMoisEcrit(resume[1], resume[2], resume[3]) : null
  const finPeriode = resume ? dateMoisEcrit(resume[4], resume[5], resume[6]) : null
  const periode = debutPeriode && finPeriode
    ? { debut: debutPeriode, fin: finPeriode }
    : periodeDe([...trades.flatMap(t => [jourDe(t.entreLe), t.sortiLe ? jourDe(t.sortiLe) : null]), ...mouvements.map(m => m.date)])
  const resultat = montantResume(plat, ['Bénéfice ou perte \\(positions fermées uniquement\\)', 'Profit or Loss \\(Closed positions only\\)'])
  const somme = arrondi(trades.reduce((s, t) => s + t.pnl, 0))
  const n = trades.length
  const manquantes = Math.max(illisibles, annoncees - n)
  const juste = resultat !== null && Math.abs(somme - resultat) < 0.05 && manquantes === 0
  return {
    ...lectureVide('releve-broker', 'csv'),
    confiance: juste ? 1 : 0.85,
    broker,
    identifiant: utilisateur,
    periode,
    devise: 'USD',
    remarque: [
      `Relevé eToro lu sans IA : ${n} position${n > 1 ? 's' : ''} fermée${n > 1 ? 's' : ''}, ${mouvements.length} mouvement${mouvements.length > 1 ? 's' : ''}.`,
      manquantes > 0 ? `${manquantes} position${manquantes > 1 ? 's' : ''} de la table illisible${manquantes > 1 ? 's' : ''} (coupée${manquantes > 1 ? 's' : ''} par la mise en page) : non rendue${manquantes > 1 ? 's' : ''}.` : '',
      resultat !== null && !juste ? 'La somme des bénéfices ne retombe pas sur le résultat du récapitulatif : vérifie la liste.' : '',
      "L'identifiant est le nom d'utilisateur eToro. Heures telles qu'écrites, sans fuseau.",
    ].filter(Boolean).join(' '),
    trades,
    mouvements,
    releveBroker: {
      broker,
      identifiant: utilisateur,
      periode,
      resultat,
      depots: montantResume(plat, ['Dépôts', 'Deposits']),
      retraits: (() => { const r = montantResume(plat, ['Retraits', 'Withdrawals']); return r === null || r === 0 ? r : -Math.abs(r) })(),
      soldeFin: montantResume(plat, ["Fin de l'équité réalisée", 'Ending Realized Equity']),
      devise: 'USD',
    },
  }
}

// ── Relevés MetaTrader 4 en HTML ────────────────────────────────────────────

/** « 2019.03.04 10:15:02 » (heure du serveur du broker, sans décalage), codée comme UTC. */
function dateMetaTrader(brut: string): Date | null {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(brut.trim())
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)))
  return Number.isNaN(d.getTime()) || d.getUTCDate() !== +m[3] ? null : d
}

/** « SimpleFX Ltd. » donne « simplefx » : le nom court qui sert de source aux trades. */
export function slugBroker(nom: string | null | undefined): string {
  const premier = (nom ?? '').normalize('NFD').toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().split(/[\s-]+/)[0]
  return premier || 'inconnu'
}

/**
 * Relevé MetaTrader 4 (« Statement », « Detailed Statement » : SimpleFX,
 * Vantage...) : la page générée par le terminal, toujours la même. Lu sans
 * IA, quelle que soit sa longueur (une année de trades ne tiendrait pas dans
 * une réponse de l'IA).
 * - « Closed Transactions » : buy et sell deviennent des trades (pnl = Profit
 *   + Swap + Taxes, frais = Commission, net = « Closed P/L » du relevé), les
 *   lignes balance des dépôts ou des retraits, credit un mouvement « autre » ;
 *   les ordres annulés sont ignorés.
 * - « Summary » : Deposit/Withdrawal, Closed Trade P/L, Balance.
 */
export function lireReleveMetaTrader(html: string): Lecture | null {
  if (!/Closed Transactions:/i.test(html) || !/Summary:/i.test(html)) return null
  const titre = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const societe = /<div[^>]*>\s*<b>([^<]{2,120})<\/b>\s*<\/div>/i.exec(html)
  const broker = societe ? texteFragment(societe[1]) : null

  let section = 'entete'
  let compte: string | null = null
  let devise: string | null = null
  const resume: Record<string, number | null> = {}
  const trades: TradeNormalise[] = []
  const mouvements: Mouvement[] = []
  let annules = 0
  let illisibles = 0
  // Le rapport, pas le format du fichier : un « Statement » et un « Detailed
  // Statement » du même compte portent les mêmes tickets, donc les mêmes clés.
  const source = `mt4:${slugBroker(broker)}`

  for (const brut of html.split(/<tr[\s>]/i).slice(1)) {
    const cellules = [...brut.split(/<\/tr>/i)[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => texteFragment(m[1]))
    if (cellules.length === 0) continue
    const tete = cellules[0]
    if (/^Closed Transactions:/i.test(tete)) { section = 'closed'; continue }
    if (/^Open Trades:/i.test(tete)) { section = 'open'; continue }
    if (/^Working Orders:/i.test(tete)) { section = 'working'; continue }
    if (/^Summary:/i.test(tete)) { section = 'summary'; continue }
    if (/^Details:/i.test(tete)) { section = 'details'; continue }

    if (section === 'entete') {
      for (const c of cellules) {
        const a = /^Account:\s*(\S+)/i.exec(c)
        if (a) compte = a[1]
        const d = /^Currency:\s*([A-Za-z]{3})/i.exec(c)
        if (d) devise = d[1].toUpperCase()
      }
      continue
    }
    if (section === 'summary') {
      for (let i = 0; i + 1 < cellules.length; i++) {
        if (/:$/.test(cellules[i])) resume[cellules[i].replace(/:$/, '').toLowerCase()] = lireNombre(cellules[i + 1])
      }
      continue
    }
    if (section !== 'closed') continue

    const genre = (cellules[2] ?? '').toLowerCase()
    if (genre === 'balance' || genre === 'credit') {
      const quand = dateMetaTrader(cellules[1] ?? '')
      const montant = lireNombre(cellules[cellules.length - 1])
      if (!quand || montant === null) { illisibles++; continue }
      if (montant === 0) continue
      mouvements.push({
        date: jourDe(quand),
        type: genre === 'credit' ? 'autre' : montant > 0 ? 'depot' : 'retrait',
        montant,
        devise,
        libelle: (cellules[3] || (montant > 0 ? 'Dépôt' : 'Retrait')).slice(0, 200),
      })
      continue
    }
    if (genre !== 'buy' && genre !== 'sell') {
      if (/limit|stop/.test(genre)) annules++
      continue
    }
    if (cellules.length < 14) { illisibles++; continue }
    const [ticket, ouverture, , taille, symbole, prixEntree, stop, , cloture, prixSortie, commission, taxes, swap, profit] = cellules
    const entreLe = dateMetaTrader(ouverture)
    const sortiLe = dateMetaTrader(cloture)
    const quantite = lireNombre(taille)
    const p = lireNombre(profit)
    if (!ticket || !symbole || !entreLe || !sortiLe || quantite === null || quantite <= 0 || p === null) { illisibles++; continue }
    const stopPrix = lireNombre(stop)
    const com = lireNombre(commission) ?? 0
    trades.push({
      source,
      idExterne: `${compte ?? 'compte'}-${ticket}`,
      compte,
      symbole: symbole.toUpperCase().slice(0, 40),
      direction: genre === 'buy' ? 'long' : 'short',
      quantite,
      prixEntree: lireNombre(prixEntree),
      prixSortie: lireNombre(prixSortie),
      entreLe,
      sortiLe,
      pnl: arrondi(p + (lireNombre(swap) ?? 0) + (lireNombre(taxes) ?? 0)),
      devise: devise ?? 'USD',
      frais: Math.abs(com),
      dureeSec: Math.round((sortiLe.getTime() - entreLe.getTime()) / 1000),
      fuseau: null,
      stopPrix: stopPrix === null || stopPrix === 0 ? null : stopPrix,
    })
  }

  if (!compte && titre) compte = /Statement:\s*(\S+)/i.exec(texteFragment(titre[1]))?.[1] ?? null
  const periode = periodeDe([...trades.flatMap(t => [jourDe(t.entreLe), t.sortiLe ? jourDe(t.sortiLe) : null]), ...mouvements.map(m => m.date)])
  const somme = (signe: 1 | -1) => {
    const lus = mouvements.filter(m => m.type !== 'autre' && Math.sign(m.montant) === signe)
    return lus.length > 0 ? arrondi(lus.reduce((s, m) => s + m.montant, 0)) : 0
  }
  const remarques = [
    `Relevé MetaTrader 4 lu sans IA : ${trades.length} trade${trades.length > 1 ? 's' : ''}, ${mouvements.length} mouvement${mouvements.length > 1 ? 's' : ''}.`,
    annules > 0 ? `${annules} ordre${annules > 1 ? 's' : ''} en attente annulé${annules > 1 ? 's' : ''} ignoré${annules > 1 ? 's' : ''}.` : '',
    illisibles > 0 ? `${illisibles} ligne${illisibles > 1 ? 's' : ''} illisible${illisibles > 1 ? 's' : ''} ignorée${illisibles > 1 ? 's' : ''}.` : '',
    "Heures du serveur du broker, sans fuseau : donne le tien à l'import si tu le connais.",
  ]
  return {
    ...lectureVide('releve-broker', 'csv'),
    confiance: illisibles > 0 ? 0.85 : 0.95,
    broker,
    identifiant: compte,
    periode,
    devise,
    remarque: remarques.filter(Boolean).join(' '),
    trades,
    mouvements,
    releveBroker: {
      broker,
      identifiant: compte,
      periode,
      resultat: resume['closed trade p/l'] ?? null,
      depots: somme(1),
      retraits: somme(-1),
      soldeFin: resume['balance'] ?? null,
      devise,
    },
  }
}

// ── Préparer la lecture : sans IA, ou ce qu'on enverra à l'IA ────────────────

/** Ce que le nom du fichier dit déjà (« amember-invoice » : une facture Apex). */
export function indiceDuNom(nom: string): string | null {
  if (/amember-invoice/i.test(nom)) {
    return "Le nom du fichier (« amember-invoice ») est celui des factures d'aMember, le système de facturation d'Apex Trader Funding : c'est très probablement une facture de propfirm."
  }
  if (/cash[\s_-]*history/i.test(nom)) return "Le nom du fichier indique l'historique des mouvements d'argent d'un compte Tradovate (Cash History)."
  if (/^performance[.\s_-]/i.test(nom)) return 'Le nom du fichier indique un rapport de performance Tradovate (liste des trades fermés).'
  if (/statement|relev[eé]/i.test(nom)) return 'Le nom du fichier indique un relevé de compte (broker ou banque).'
  return null
}

/**
 * Le rapport de trades reconnu au nom du fichier, quand c'est celui d'un
 * export connu : ses trades lus par l'IA (une capture du rapport, un PDF que le
 * lecteur sans IA n'a pas su lire) prennent la MÊME source que le lecteur CSV
 * du même rapport, quel que soit le format du fichier et ce que l'IA a lu.
 */
export function origineDuNom(nom: string): string | null {
  if (/^performance[.\s_-]/i.test(nom.trim())) return 'tradovate-performance'
  return null
}

/** Le texte envoyé à l'IA est borné : au-delà, l'IA ne rendrait de toute façon pas tout dans le temps d'une requête. */
export const TEXTE_MAX_IA = 100_000

/** origine (rapport reconnu au nom) fait la source des trades lus par l'IA, sinon « ia:<identifiant de compte> » (sourceIA) ; prefixe dit le format. */
export type Preparation =
  | { lecture: Lecture }
  | { ia: 'texte'; texte: string; prefixe: string; origine: string | null; indice: string | null; coupe: boolean }
  | { ia: 'vision'; bloc: 'pdf' | 'image'; media: 'application/pdf' | MediaImage; prefixe: string; origine: string | null; indice: string | null }

/**
 * Ce qu'on fait d'un document : le lire sans IA (lecture rendue), ou ce qu'on
 * enverra à l'IA (texte d'abord, image seulement quand le texte manque).
 * `textePdf` : le texte extrait du PDF par l'appelant (null si l'extraction a échoué).
 */
export function preparerLecture(e: { nom: string; nature: Nature; octets: Uint8Array; textePdf?: string | null }): Preparation {
  const { nom, nature, octets } = e
  const indice = indiceDuNom(nom)
  const origine = origineDuNom(nom)
  // Le texte envoyé à l'IA est nettoyé (nettoyerTexteExtrait) : c'est aussi celui que contrôle la route.
  const versIA = (brut: string, prefixe: string): Preparation => {
    const texte = nettoyerTexteExtrait(brut)
    return { ia: 'texte', texte: texte.slice(0, TEXTE_MAX_IA), prefixe, origine, indice, coupe: texte.length > TEXTE_MAX_IA }
  }

  switch (nature.famille) {
    case 'refuse':
      return { lecture: { ...lectureVide('illisible', 'nom'), remarque: nature.raison ?? 'Format non lu.' } }
    case 'pdf': {
      const textePdf = e.textePdf == null ? null : nettoyerTexteExtrait(e.textePdf)
      if (methodePourPdf(textePdf) !== 'texte') return { ia: 'vision', bloc: 'pdf', media: 'application/pdf', prefixe: 'pdf', origine, indice }
      const lu = lirePerformancePdf(textePdf ?? '') ?? lireCashHistoryPdf(textePdf ?? '') ?? lireReleveEtoro(textePdf ?? '')
      if (lu && ((lu.trades?.length ?? 0) > 0 || (lu.mouvements?.length ?? 0) > 0)) return { lecture: lu }
      return versIA(textePdf ?? '', 'pdf')
    }
    case 'image':
      return { ia: 'vision', bloc: 'image', media: nature.media ?? 'image/png', prefixe: 'image', origine, indice }
    case 'html': {
      const html = decoderTexte(octets)
      const mt4 = lireReleveMetaTrader(html)
      if (mt4) return { lecture: mt4 }
      const texte = texteDuHtml(html)
      if (caracteresUtiles(texte) === 0) return { lecture: { ...lectureVide('illisible', 'nom'), remarque: 'Page HTML sans texte.' } }
      return versIA(texte, 'html')
    }
    case 'csv':
    case 'texte': {
      const texte = decoderTexte(octets)
      const lu = nature.famille === 'csv' ? lireCsv(texte, nom) : (lireCashHistory(texte) ?? lireTraderDashboard(texte))
      if (lu) return { lecture: lu }
      if (caracteresUtiles(texte) === 0) return { lecture: { ...lectureVide('illisible', 'nom'), remarque: 'Fichier vide.' } }
      return versIA(texte, nature.famille)
    }
  }
}

// ── Le compte de Pilotage ───────────────────────────────────────────────────

const norme = (s: string | null | undefined) => (s ?? '').normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Deux noms de firme ou de broker se valent : égaux, ou l'un prolonge l'autre (« Apex » et « Apex Trader Funding »). */
function memeNom(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const [court, long] = a.length <= b.length ? [a, b] : [b, a]
  return court.length >= 4 && long.startsWith(court)
}

/**
 * Le compte de Pilotage d'une lecture : l'identifiant lu dans un de ses
 * `identifiants` (sans casse ni ponctuation) ; sinon un SEUL compte dont la
 * firme (firmName), puis le broker (brokerName), est celle lue. Plusieurs
 * candidats : null (on ne devine pas, la revue tranche). Quand un identifiant
 * est lu, un compte qui a déjà ses identifiants (aucun ne correspond) n'est
 * pas candidat par la firme : c'est sans doute un autre compte, peut-être un
 * nouveau.
 */
export function rapprocherCompte(
  lu: { identifiant?: string | null; firme?: string | null; broker?: string | null },
  comptes: ComptePilotage[],
): string | null {
  if (comptes.length === 0) return null
  const id = norme(lu.identifiant)
  if (id) {
    const parId = comptes.find(c => (c.identifiants ?? []).some(i => norme(i) === id))
    if (parId) return parId.id
  }
  const noms = [lu.firme, lu.broker].map(norme).filter(Boolean)
  if (noms.length === 0) return null
  const candidats = id ? comptes.filter(c => !(c.identifiants ?? []).some(i => norme(i))) : comptes
  const parFirme = candidats.filter(c => noms.some(n => memeNom(n, norme(c.firmName))))
  if (parFirme.length === 1) return parFirme[0].id
  if (parFirme.length > 1) return null
  const parBroker = candidats.filter(c => noms.some(n => memeNom(n, norme(c.brokerName))))
  return parBroker.length === 1 ? parBroker[0].id : null
}

/** La lecture avec son compte (et celui de chaque compte d'un tableau de bord). */
export function avecCompte(lecture: Lecture, comptes: ComptePilotage[]): Lecture {
  const compteId = rapprocherCompte(lecture, comptes)
  if (!lecture.capture?.comptes) return { ...lecture, compteId }
  const lignes = lecture.capture.comptes.map(c => ({
    ...c, compteId: rapprocherCompte({ identifiant: c.identifiant, firme: lecture.firme, broker: lecture.broker }, comptes),
  }))
  return { ...lecture, compteId, capture: { ...lecture.capture, comptes: lignes } }
}

/** Le body.comptes d'une requête, réduit aux champs connus (200 comptes au plus). */
export function lireComptes(brut: unknown): ComptePilotage[] {
  if (!Array.isArray(brut)) return []
  const texte = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const comptes: ComptePilotage[] = []
  for (const c of brut.slice(0, 200)) {
    if (!c || typeof c !== 'object') continue
    const o = c as Record<string, unknown>
    const id = texte(o.id, 200)
    if (!id) continue
    comptes.push({
      id,
      nom: texte(o.nom),
      firmName: texte(o.firmName),
      brokerName: texte(o.brokerName),
      identifiants: Array.isArray(o.identifiants) ? o.identifiants.map(i => texte(i)).filter((i): i is string => !!i).slice(0, 20) : [],
    })
  }
  return comptes
}

// ── Les empreintes : un fait déjà vu dans un autre document ─────────────────
//
// Brice dépose souvent le même rapport deux fois (le CSV et le PDF d'un
// Performance ou d'un Cash History, deux exports MetaTrader du même compte,
// la même facture « (1) » et « (2) »). Chaque fait rendu porte une empreinte
// qui ne dépend ni du format ni du nom du fichier : Pilotage compare deux
// documents d'un même dépôt avant d'écrire, et un fait déjà vu n'est pas
// proposé deux fois. Deux faits identiques dans UN document (deux commissions
// du même montant le même jour) se distinguent par leur rang (« #2 »).

/** Un compteur de rangs : la première occurrence garde sa clé, les suivantes prennent « #2 », « #3 »... */
function rangeur(): (cle: string) => string {
  const vus = new Map<string, number>()
  return cle => {
    const rang = (vus.get(cle) ?? 0) + 1
    vus.set(cle, rang)
    return rang === 1 ? cle : `${cle}#${rang}`
  }
}

/** Mouvement : date, type, montant au centime, devise, compte lu (sans casse ni ponctuation). */
export function empreinteMouvement(m: Pick<Mouvement, 'date' | 'type' | 'montant' | 'devise'>, identifiant: string | null): string {
  return ['mouvement', m.date, m.type, m.montant.toFixed(2), m.devise ?? '', norme(identifiant)].join('|')
}

/** Relevé de broker : broker (nom court), compte, période. */
export function empreinteReleve(r: Pick<ReleveBroker, 'broker' | 'identifiant' | 'periode'>): string {
  return ['releve', slugBroker(r.broker), norme(r.identifiant), r.periode?.debut ?? '', r.periode?.fin ?? ''].join('|')
}

/** Facture : fournisseur (nom court), date, montant, devise. */
export function empreinteFacture(f: Pick<Facture, 'fournisseur' | 'date' | 'montant' | 'devise'>): string {
  return ['facture', slugBroker(f.fournisseur), f.date ?? '', f.montant === null ? '' : f.montant.toFixed(2), f.devise ?? ''].join('|')
}

/**
 * La lecture rendue au front : le compte de Pilotage rapproché, l'empreinte de
 * chaque mouvement et du relevé de broker, et la liste des empreintes des faits
 * rendus (trades : source et empreinteTrade, la même pour le CSV et le PDF d'un
 * même rapport ; mouvements ; relevé ; facture).
 */
export function finaliserLecture(lecture: Lecture, comptes: ComptePilotage[]): { lecture: Lecture; empreintes: string[] } {
  const l = avecCompte(lecture, comptes)
  // La provenance (brief D3) : une valeur lue sans provenance dite vient du document (lecteurs sans IA).
  const o = l.origine ?? { firme: null, identifiant: null }
  l.origine = { firme: l.firme || l.broker ? (o.firme ?? 'document') : null, identifiant: l.identifiant ? (o.identifiant ?? 'document') : null }
  const empreintes: string[] = []
  const rangTrade = rangeur()
  for (const t of l.trades ?? []) empreintes.push(rangTrade(['trade', t.source, empreinteTrade(t)].join('|')))
  if (l.mouvements) {
    const rang = rangeur()
    l.mouvements = l.mouvements.map(m => ({ ...m, empreinte: rang(empreinteMouvement(m, l.identifiant)) }))
    for (const m of l.mouvements) empreintes.push(m.empreinte!)
  }
  if (l.releveBroker) {
    l.releveBroker = { ...l.releveBroker, empreinte: empreinteReleve(l.releveBroker) }
    empreintes.push(l.releveBroker.empreinte!)
  }
  if (l.facture) empreintes.push(empreinteFacture(l.facture))
  return { lecture: l, empreintes }
}

// ── La limite : 5 lectures par l'IA par membre et par jour ──────────────────

export const LIMITE_LECTURES_IA_JOUR = 5
export const MESSAGE_LIMITE = 'Tu as lu tes 5 documents du jour, reviens demain.'

export interface Quota { lusParIaAujourdhui: number; limite: number; sansPlafond: boolean }

/** Une lecture par l'IA de plus est-elle permise ? `lus` = lectures IA déjà faites aujourd'hui. */
export function etatQuota(lus: number, sansPlafond: boolean, limite = LIMITE_LECTURES_IA_JOUR): { autorise: boolean; quota: Quota } {
  return { autorise: sansPlafond || lus < limite, quota: { lusParIaAujourdhui: lus, limite, sansPlafond } }
}

/** Le début du jour à Paris (minuit, heure d'été comprise), en vrai instant : la limite se recharge à minuit à Paris. */
export function debutJourParis(maintenant: Date): Date {
  const jour = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(maintenant)
  const [a, m, j] = jour.split('-').map(Number)
  return instantDepuisHeureLocale(new Date(Date.UTC(a, m - 1, j, 0, 0, 0)), 'Europe/Paris')
}

// ── Le coffre ────────────────────────────────────────────────────────────────

export const BUCKET_DOCUMENTS = 'documents-pilotage'
/** 200 Mo par membre (brief D1). */
export const COFFRE_MAX_OCTETS = 200 * 1024 * 1024
export const MESSAGE_COFFRE_PLEIN = "Ton coffre est plein (200 Mo) : l'original n'a pas été gardé. Retire des documents que tu n'as plus besoin de garder, puis redépose celui-ci."

/** Les types MIME que le coffre garde tels quels (les mêmes que le bucket) ; tout autre original part en octet-stream. */
export const TYPES_COFFRE = [
  'application/pdf', 'text/csv', 'text/plain', 'text/html', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'image/heic', 'image/heif', 'application/octet-stream',
] as const

export function typeCoffre(mime: string): string {
  return (TYPES_COFFRE as readonly string[]).includes(mime) ? mime : 'application/octet-stream'
}

/** « Relevé Mars 2025 (2).PDF » donne « Releve-Mars-2025-2.pdf » : un nom sûr pour un chemin de stockage. */
export function nettoyerNom(nom: string): string {
  const ext = extensionDe(nom)
  const base = (ext ? nom.trim().slice(0, -(ext.length + 1)) : nom.trim())
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.{2,}/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
  return `${base || 'document'}${ext ? `.${ext}` : ''}`
}

/** Le chemin de l'original : le dossier du membre, puis l'id du document. */
export function cheminDocument(userId: string, id: string, nom: string): string {
  return `${userId}/${id}-${nettoyerNom(nom)}`
}

/** Le coffre peut-il prendre ce fichier ? */
export function coffreAccepte(octetsDejaGardes: number, taille: number): boolean {
  return octetsDejaGardes + taille <= COFFRE_MAX_OCTETS
}
