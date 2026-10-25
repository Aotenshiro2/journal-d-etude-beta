// LE CONNECTEUR MCP DE CHATGPT POUR BELRIVE (23/10/2026) : la partie PURE.
//
// Brice concoit l'histoire de son jeu Belrive avec ChatGPT, dans un Projet
// ChatGPT. Ce connecteur (POST /api/mcp/<secret>, protocole MCP en HTTP SANS
// ETAT, reponses application/json, jamais de flux SSE) lui donne, et a lui seul :
// - la LECTURE des documents de Belrive (cockpit_perso_documents, projet
//   belrive : scenario, histoire et vue d'ensemble des arcs, plans, file des
//   lots, ETAT.md) et des notes du projet belrive (cockpit_perso_notes) ;
// - deux ECRITURES : une note pour Sora, Yume, Sekai ou Tab (auteur gpt,
//   projet belrive, memes pings que les notes de Tab), et un document a lui
//   (source gpt, une ligne par version, range sous Scenario/De-GPT/, jamais a
//   la place d'un document du disque) ;
// - depuis le 25/10/2026, une troisieme : une IMAGE (deposer_image, regles dans
//   images-pur.ts, telechargement sur dans telechargement.ts, bucket prive
//   belrive-images et table cockpit_perso_images), montree par lister_documents.
// Rien d'autre : ni membres, ni paiements, ni Telegram, ni autres projets, ni
// les notes qui ne sont pas du projet belrive.
//
// Le secret est dans le CHEMIN de l'URL (en mode « aucune authentification »,
// ChatGPT n'envoie pas d'en-tete fixe fiable) : gpt_ + 32 octets aleatoires
// en base64url. Seule son empreinte est en base (cockpit_tab_cles, portee
// gpt_belrive), coupee depuis le cockpit (ecran Perso). L'empreinte est
// SEPAREE de celle des cles de Tab (prefixe « mcp-gpt-belrive: ») : une cle
// de l'un ne passe jamais chez l'autre, meme si le filtre de portee manquait.
//
// Ce fichier n'importe que node:crypto et ./images-pur (node:crypto, node:net) : scripts/verifier-mcp-gpt.mjs et
// scripts/essayer-migration-gpt-belrive.mjs le chargent tel quel (Node 22
// retire les types). Le cote serveur (base, pings) : serveur.ts ; le SQL :
// requetes.ts ; la route : src/app/api/mcp/[secret]/route.ts.

import { createHash, timingSafeEqual } from 'node:crypto'
import {
  assainirNomFichier, cheminStockage, empreinteOctets, lireSourceImage, nomDansUrl, ROLE_MAX, TITRE_IMAGE_MAX, validerOctets, verifierUrl,
  type TypeImage,
} from './images-pur'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Versions du protocole MCP comprises, la plus recente d'abord. */
export const VERSIONS_PROTOCOLE: readonly string[] = ['2025-11-25', '2025-06-18', '2025-03-26']
export const VERSION_RECENTE = VERSIONS_PROTOCOLE[0]

export const SERVEUR = { name: 'belrive-aok', title: 'Belrive (AOKnowledge)', version: '1.0.0' }

/** La portee des cles de ChatGPT dans cockpit_tab_cles (migration 20261023171000). */
export const PORTEE_GPT = 'gpt_belrive'

/** Le secret du chemin : gpt_ + 32 octets aleatoires en base64url (43 caracteres). */
export const SECRET_GPT = /^gpt_[A-Za-z0-9_-]{43}$/

/** Meme limite que l'API de Tab (src/lib/tab/pur.ts), comptee dans cockpit_tab_acces. */
export const DEBIT_PAR_MINUTE_GPT = 60

/** Le corps HTTP (un depot de 300 000 octets, echappe en JSON, y tient). */
export const CORPS_MAX = 1_000_000
/** Messages JSON-RPC par lot (protocole 2025-03-26). */
export const LOT_MAX = 20
/** Un document depose par ChatGPT (une version de l'histoire fait environ 100 Ko). */
export const DEPOT_MAX_OCTETS = 300_000
/** fetch sans longueur : au plus ce nombre de caracteres par appel (le scenario de reference en fait pres de 500 000), la suite par debut. */
export const LONGUEUR_FETCH_DEFAUT = 120_000
export const TITRE_MAX = 200
export const REQUETE_MAX = 300
export const RESULTATS_MAX = 10
export const NOTES_MAX = 100
// Memes bornes que la table cockpit_perso_notes et src/lib/tab/notes-pur.ts.
export const SUJET_MAX = 200
export const TEXTE_MAX = 20_000
export const LIENS_MAX = 20

/** Le lien de citation d'un resultat : l'ecran Perso du cockpit (Brice seul). */
export const URL_PERSO = 'https://cockpit.aoknowledge.com/?vue=perso'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const ERREUR_INTERNE = 'Erreur interne du serveur Belrive. Réessaie dans un instant.'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Instances Claude Code de Brice : umi est la valeur technique de Yume (ex-Umi, WSL). */
export type Instance = 'sora' | 'umi' | 'sekai' | 'toutes'
export type Destinataire = { sens: 'vers_claude'; instance: Instance } | { sens: 'vers_tab'; instance: null }
export type StatutNote = 'nouvelle' | 'lue' | 'traitee'
export type FiltreStatut = StatutNote | 'toutes'

export type DocumentResume = {
  document_id: string
  titre: string
  chemin: string
  taille: number
  source: 'disque' | 'gpt'
  version: number
  maj_le: string
}
export type Document = DocumentResume & { contenu: string }

export type NoteBelrive = {
  note_id: string
  sens: 'vers_claude' | 'vers_tab'
  auteur: string
  instance: string | null
  sujet: string
  texte: string
  liens: string[]
  statut: StatutNote
  cree_le: string
}

export type Trouvaille = {
  genre: 'doc' | 'note'
  id: string
  titre: string
  chemin: string | null
  extrait: string
  date: string
  score: number
}

/** Une recherche preparee : texte sans accents, motif LIKE echappe, mots pour situer l'extrait. */
export type Recherche = { brute: string; normalisee: string; motif: string; mots: string[]; limite: number }
export type NoteGpt = { destinataire: Destinataire; sujet: string; texte: string; liens: string[] }
export type DepotGpt = { titre: string; contenu: string; famille: string; empreinte: string }

/** Une image de Belrive deposee par ChatGPT (cockpit_perso_images). */
export type ImageBelrive = {
  image_id: string
  titre: string
  role: string
  nom_fichier: string
  chemin: string
  mime: string
  taille: number
  empreinte: string
  origine: 'fichier' | 'url' | 'base64'
  depose_le: string
}
export type ImageAEnregistrer = {
  titre: string
  role: string
  nomFichier: string
  chemin: string
  mime: TypeImage['mime']
  octets: Buffer
  empreinte: string
  origine: ImageBelrive['origine']
}
export type TelechargementImage = { ok: true; octets: Buffer } | { ok: false; raison: string }

/** Tout ce que le connecteur peut faire en base. Rien d'autre n'existe pour lui. */
export type Base = {
  chercher: (r: Recherche) => Promise<Trouvaille[]>
  lireDocument: (id: string) => Promise<Document | null>
  lireDocumentParChemin: (chemin: string) => Promise<Document | null>
  lireNote: (id: string) => Promise<NoteBelrive | null>
  listerDocuments: () => Promise<DocumentResume[]>
  listerNotes: (statut: FiltreStatut, limite: number) => Promise<NoteBelrive[]>
  ecrireNote: (n: NoteGpt) => Promise<{ note: NoteBelrive; prevenu: string }>
  deposerDocument: (d: DepotGpt) => Promise<DocumentResume | null>
  /** Telecharge une image par https (gardes anti-SSRF, 8 Mo) : src/lib/mcp-gpt/telechargement.ts. */
  telechargerImage: (url: string) => Promise<TelechargementImage>
  /** Range l'image (bucket prive puis ligne de suivi). deja = la meme empreinte etait deja deposee. */
  enregistrerImage: (i: ImageAEnregistrer) => Promise<{ image: ImageBelrive; deja: boolean }>
  listerImages: () => Promise<ImageBelrive[]>
}

export type VerdictCle =
  | { ok: true; cleId: string }
  | { ok: false; raison: 'inconnue' | 'debit' | 'base'; cleId: string | null }

export type Dependances = { verifierCle: (secret: string) => Promise<VerdictCle>; base: Base }

export type EntreePost = { secret: string; typeContenu: string | null; versionProtocole: string | null; brut: string }

/** La ligne du journal d'acces (cockpit_tab_acces), sans le statut ni la duree que la route ajoute. */
export type JournalAppel = {
  cleId: string | null
  route: string
  parametres: Record<string, unknown>
  lignes: number | null
  erreur: string | null
}

/** corps null = pas de corps (202). journal null = rien a journaliser (chemin qui n'est pas un secret). */
export type SortieHttp = { status: number; corps: unknown; journal: JournalAppel | null }

// ---------------------------------------------------------------------------
// Cle, empreintes, textes
// ---------------------------------------------------------------------------

/** L'empreinte d'un secret de ChatGPT : sha256 avec un prefixe propre (separee des cles de Tab). */
export function empreinteCleGpt(secret: string): string {
  return createHash('sha256').update(`mcp-gpt-belrive:${secret}`, 'utf8').digest('hex')
}

/** L'empreinte d'un contenu : sha256 du texte en UTF-8 (la meme que pousser_docs_belrive.py). */
export function empreinteContenu(texte: string): string {
  return createHash('sha256').update(texte, 'utf8').digest('hex')
}

/** La cle active qui correspond au secret, comparee en temps constant sur toutes les cles. */
export function choisirCle<T extends { empreinte: string }>(cles: T[], secret: string): T | null {
  const recue = Buffer.from(empreinteCleGpt(secret), 'hex')
  let trouvee: T | null = null
  for (const c of cles) {
    const attendue = Buffer.from(c.empreinte, 'hex')
    if (attendue.length === recue.length && timingSafeEqual(attendue, recue) && !trouvee) trouvee = c
  }
  return trouvee
}

/** Minuscules sans accents (œ -> oe, æ -> ae) : la meme forme que la colonne tsv de la base. */
export function sansAccents(s: string): string {
  return s.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function preparerRecherche(brute: string, limite: number = RESULTATS_MAX): Recherche {
  const b = brute.trim().slice(0, REQUETE_MAX)
  const normalisee = sansAccents(b).replace(/\s+/g, ' ').trim()
  const motif = `%${normalisee.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  // Les mots situent l'extrait (premiere occurrence) : racine grossiere pour attraper pluriels et accords.
  const mots = [...new Set(normalisee.split(/[^a-z0-9]+/).filter((m) => m.length >= 3))]
    .slice(0, 8)
    .map((m) => (m.length > 6 ? m.slice(0, m.length - 2) : m))
  return { brute: b, normalisee, motif, mots, limite }
}

/** Le nom de famille d'un document depose : le titre en minuscules, sans accents, mots separes par des tirets. */
export function familleDe(titre: string): string {
  const s = sansAccents(titre).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '')
  return s || 'document'
}

/** pour : sora, yume (ou umi), sekai, toutes, tab. null = inconnu. */
export function lireDestinataire(v: unknown): Destinataire | null {
  if (typeof v !== 'string') return null
  const s = sansAccents(v).trim().replace(/[\s-]+/g, '_')
  if (s === 'tab') return { sens: 'vers_tab', instance: null }
  if (s === 'sora' || s === 'sekai') return { sens: 'vers_claude', instance: s }
  if (s === 'yume' || s === 'umi') return { sens: 'vers_claude', instance: 'umi' }
  if (['toutes', 'tous', 'les_trois', 'toutes_les_instances', 'claude', 'all'].includes(s)) return { sens: 'vers_claude', instance: 'toutes' }
  return null
}

const NOM_INSTANCE: Record<string, string> = {
  sora: 'Sora', umi: 'Yume', sekai: 'Sekai', toutes: 'Sora, Yume et Sekai', les_deux: 'Sora et Yume',
}
const NOM_AUTEUR: Record<string, string> = { tab: 'Tab', claude: 'Claude', brice: 'Brice', gpt: 'ChatGPT' }

/** Qui ecrit a qui, en clair, pour ChatGPT. */
export function deEtPour(n: Pick<NoteBelrive, 'sens' | 'auteur' | 'instance'>): { de: string; pour: string } {
  if (n.sens === 'vers_claude') {
    return { de: NOM_AUTEUR[n.auteur] ?? n.auteur, pour: NOM_INSTANCE[n.instance ?? 'les_deux'] ?? 'Claude' }
  }
  const de = n.auteur === 'claude' && n.instance && NOM_INSTANCE[n.instance] ? `Claude (${NOM_INSTANCE[n.instance]})` : (NOM_AUTEUR[n.auteur] ?? n.auteur)
  return { de, pour: 'Tab' }
}

/** Les arguments d'un appel, pour le journal : aucun texte long (une note, un document) n'y entre. */
export function resumeArgs(a: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(a).slice(0, 12)) {
    const cle = k.slice(0, 40)
    // Une adresse sans sa requete (un lien signe y porte son jeton).
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) r[cle] = v.split(/[?#]/)[0].slice(0, 120) + (/[?#]/.test(v) ? '?[...]' : '')
    else if (typeof v === 'string') r[cle] = v.length <= 120 ? v : `[${v.length} caractères]`
    else if (Array.isArray(v)) r[cle] = `[${v.length} élément(s)]`
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) r[cle] = v
    else r[cle] = '[objet]'
  }
  return r
}

export function versionAcceptee(v: string): boolean {
  return VERSIONS_PROTOCOLE.includes(v)
}

/** La version rendue a initialize : celle du client si on la parle, sinon la plus recente. */
export function choisirVersion(demandee: unknown): string {
  return typeof demandee === 'string' && versionAcceptee(demandee) ? demandee : VERSION_RECENTE
}

function raisonDe(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  return (m.split('\n').filter(Boolean).pop() ?? '').slice(0, 300)
}

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function idValide(v: unknown): v is string | number {
  return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))
}

function estJson(typeContenu: string | null): boolean {
  return /^application\/([a-z0-9.+-]*\+)?json\b/i.test((typeContenu ?? '').trim())
}

// ---------------------------------------------------------------------------
// Les outils : ce que ChatGPT voit
// ---------------------------------------------------------------------------

const LECTURE = { readOnlyHint: true, openWorldHint: false }
const ECRITURE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }

export const INSTRUCTIONS = [
  'Ce serveur donne accès au jeu Belrive de Brice, et à lui seul : ses documents (scénario de référence, histoire et vue d\'ensemble de chaque arc, plans d\'arc, file des lots, ETAT.md) et les notes du projet Belrive.',
  'L\'histoire décrit aussi ce qui n\'est pas encore codé : avant d\'affirmer qu\'une chose existe dans le jeu (personnage, quête, lieu, mécanique), vérifie dans ETAT.md (l\'état réel du code) et dans la file des lots (FILE-DES-LOTS.md).',
  'Écris tes décisions, consignes et questions en note avec ecrire_note : les instances Claude Code de Brice (Sora, Yume, Sekai) les lisent au démarrage de leur session, Tab (l\'assistant de Brice) les reçoit par email.',
  'Pour une version complète d\'un texte, utilise deposer_document : elle est rangée à part et ne remplace jamais un document existant.',
  'Pour une image (visuel, décor, leurre, personnage), utilise deposer_image en joignant le fichier dans le champ image : elle est rangée à part, puis cite son id (img:...) dans ta note pour dire à quoi elle sert. lister_documents montre aussi les images déposées.',
].join(' ')

export const OUTILS = [
  {
    name: 'search',
    title: 'Chercher dans Belrive',
    description: 'Cherche dans les documents du jeu Belrive (scénario de référence, histoire et vue d\'ensemble de chaque arc, plans d\'arc, file des lots, et ETAT.md, l\'état réel du jeu : ce qui est codé et jouable) et dans les notes du projet Belrive échangées entre Brice, Tab, ChatGPT et les instances Claude Code. Rend au plus 10 résultats : id, titre, extrait. Lis un résultat en entier avec fetch et son id. Une requête vide rend les plus récents.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Les mots à chercher, en français de préférence (personnage, lieu, quête, arc, mécanique). Vide = les plus récents.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { title: 'Chercher dans Belrive', ...LECTURE },
  },
  {
    name: 'fetch',
    title: 'Lire un document ou une note',
    description: 'Lit un document ou une note de Belrive, par l\'id rendu par search, lister_documents ou lister_notes (doc:... ou note:...). Accepte aussi le chemin d\'un document (par exemple ETAT.md ou Lots/FILE-DES-LOTS.md). Rend au plus 120 000 caractères par appel : si metadata.suite vaut true, rappelle fetch avec debut = metadata.fin pour lire la suite (le scénario de référence fait près de 500 000 caractères).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'L\'id d\'un résultat (doc:... ou note:...), ou le chemin d\'un document (ETAT.md, Lots/FILE-DES-LOTS.md...).' },
        debut: { type: 'integer', minimum: 0, description: 'Facultatif : premier caractère à lire (0 par défaut).' },
        longueur: { type: 'integer', minimum: 1, description: 'Facultatif : nombre de caractères à lire (120 000 par défaut).' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { title: 'Lire un document ou une note', ...LECTURE },
  },
  {
    name: 'lister_documents',
    title: 'Lister les documents de Belrive',
    description: 'Liste les documents de Belrive disponibles : id, titre, chemin, taille en octets, source (disque = fichiers de Brice, synchronisés chaque heure ; gpt = documents déposés par ChatGPT), version et date de mise à jour. ETAT.md dit ce qui existe vraiment dans le jeu. Liste aussi les images déposées avec deposer_image (id img:..., titre, rôle, nom de fichier, type, taille, date).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Lister les documents de Belrive', ...LECTURE },
  },
  {
    name: 'lister_notes',
    title: 'Lister les notes du projet Belrive',
    description: 'Liste les notes du projet Belrive, les plus récentes d\'abord : qui écrit à qui (Brice, Tab, ChatGPT, les instances Claude Code Sora, Yume et Sekai), sujet, début du texte, statut (nouvelle, lue, traitee). Lis une note en entier avec fetch.',
    inputSchema: {
      type: 'object',
      properties: {
        statut: { type: 'string', enum: ['nouvelle', 'lue', 'traitee', 'toutes'], description: 'Facultatif : nouvelle, lue, traitee ou toutes (par défaut toutes).' },
        limite: { type: 'integer', minimum: 1, maximum: NOTES_MAX, description: 'Facultatif : nombre de notes (30 par défaut, 100 au plus).' },
      },
      additionalProperties: false,
    },
    annotations: { title: 'Lister les notes du projet Belrive', ...LECTURE },
  },
  {
    name: 'ecrire_note',
    title: 'Écrire une note',
    description: 'Écrit une note du projet Belrive pour une instance Claude Code de Brice (sora, yume ou sekai), pour les trois (toutes), ou pour Tab, l\'assistant de Brice (tab). Sers-t\'en pour transmettre une décision, une consigne ou une question sur le jeu. Les instances la lisent au démarrage de leur session, Brice est prévenu (Telegram pour une note aux instances, email à Tab pour une note à Tab). Une note ne modifie aucun document.',
    inputSchema: {
      type: 'object',
      properties: {
        pour: { type: 'string', enum: ['sora', 'yume', 'sekai', 'toutes', 'tab'], description: 'À qui : sora, yume ou sekai (une instance Claude Code), toutes (les trois), ou tab (l\'assistant de Brice).' },
        sujet: { type: 'string', maxLength: SUJET_MAX, description: 'Le sujet, une ligne (200 caractères au plus).' },
        texte: { type: 'string', maxLength: TEXTE_MAX, description: 'Le texte de la note (20 000 caractères au plus).' },
        liens: { type: 'array', items: { type: 'string' }, maxItems: LIENS_MAX, description: 'Facultatif : des liens utiles (20 au plus).' },
      },
      required: ['pour', 'sujet', 'texte'],
      additionalProperties: false,
    },
    annotations: { title: 'Écrire une note', ...ECRITURE },
  },
  {
    name: 'deposer_document',
    title: 'Déposer un document',
    description: 'Dépose un document Belrive écrit par toi (une version de l\'histoire, un plan d\'arc, une fiche de personnage). Il est rangé à part, dans Scenario/De-GPT/ (rapatrié sur le PC de Brice dans l\'heure), et ne remplace jamais un document existant : redéposer le même titre crée une nouvelle version. 300 000 octets au plus.',
    inputSchema: {
      type: 'object',
      properties: {
        titre: { type: 'string', maxLength: TITRE_MAX, description: 'Le titre du document (200 caractères au plus). Le même titre = une nouvelle version.' },
        contenu: { type: 'string', description: 'Le texte complet, en Markdown de préférence (300 000 octets au plus).' },
      },
      required: ['titre', 'contenu'],
      additionalProperties: false,
    },
    annotations: { title: 'Déposer un document', ...ECRITURE },
  },
  {
    name: 'deposer_image',
    title: 'Déposer une image',
    description: 'Dépose une image pour Belrive (un visuel, un décor, un leurre, un personnage), générée dans la conversation ou envoyée par Brice. Joins le fichier dans le champ image : c\'est la voie normale. À défaut, url (une adresse https publique de l\'image), ou donnees_base64 pour une petite image (600 000 octets au plus). png, jpeg, webp ou gif, 8 Mo au plus. L\'image est rangée à part (rapatriée sur le PC de Brice dans l\'heure, dans Scenario/De-GPT/images/), ne remplace jamais rien, et la même image déposée deux fois n\'en fait qu\'une. Rend son id (img:...) : cite-le dans ta note (ecrire_note) avec ce qu\'elle représente et à quoi elle sert.',
    inputSchema: {
      type: 'object',
      properties: {
        titre: { type: 'string', maxLength: TITRE_IMAGE_MAX, description: 'Le titre de l\'image (200 caractères au plus), par exemple « Leurre 1, Arc 07 ».' },
        role: { type: 'string', maxLength: ROLE_MAX, description: 'Son rôle ou sa légende, courte (300 caractères au plus), par exemple « leurre 1 : hirondelle au poignet droit ».' },
        image: {
          type: 'object',
          description: 'Le fichier image de la conversation (généré ou envoyé). ChatGPT le transmet avec un lien de téléchargement temporaire.',
          properties: {
            download_url: { type: 'string' },
            file_id: { type: 'string' },
            mime_type: { type: 'string' },
            file_name: { type: 'string' },
          },
          required: ['download_url', 'file_id'],
        },
        nom_fichier: { type: 'string', maxLength: 120, description: 'Facultatif : le nom de fichier souhaité (par exemple leurre-1-hirondelle). Il est nettoyé, l\'extension suit le vrai type de l\'image.' },
        url: { type: 'string', description: 'Facultatif, à défaut du champ image : une adresse https publique de l\'image.' },
        donnees_base64: { type: 'string', description: 'Facultatif, en dernier recours : l\'image en base64 (600 000 octets décodés au plus).' },
      },
      required: ['titre', 'role'],
      additionalProperties: false,
    },
    // OpenAI Apps SDK : ChatGPT remplace le fichier de la conversation par { download_url, file_id, mime_type?, file_name? }.
    _meta: { 'openai/fileParams': ['image'] },
    annotations: { title: 'Déposer une image', ...ECRITURE },
  },
]

const NOMS_OUTILS = new Set(OUTILS.map((o) => o.name))

// ---------------------------------------------------------------------------
// L'execution des outils
// ---------------------------------------------------------------------------

type ResultatOutil = { texte: string; erreur: boolean; lignes: number | null; raison: string | null }

function ok(donnees: unknown, lignes: number | null): ResultatOutil {
  return { texte: JSON.stringify(donnees), erreur: false, lignes, raison: null }
}

function refus(message: string): ResultatOutil {
  return { texte: message, erreur: true, lignes: null, raison: message.slice(0, 300) }
}

function chaine(a: Record<string, unknown>, ...cles: string[]): string | undefined {
  for (const c of cles) {
    const v = a[c]
    if (typeof v === 'string') return v
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return undefined
}

/** Un entier facultatif : null si absent, 'invalide' sinon. */
function entier(v: unknown): number | null | 'invalide' {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) ? n : 'invalide'
}

function urlDocument(chemin: string): string {
  return `${URL_PERSO}&doc=${encodeURIComponent(chemin)}`
}

function urlNote(id: string): string {
  return `${URL_PERSO}&note=${id}`
}

/** Un chemin de document tel que ChatGPT peut l'ecrire (antislash, ./, prefixe Belrive/). null si douteux. */
export function normaliserChemin(v: string): string | null {
  let c = v.trim().replace(/\\/g, '/')
  const i = c.toLowerCase().lastIndexOf('belrive/')
  if (i >= 0) c = c.slice(i + 'belrive/'.length)
  c = c.replace(/^(\.\/)+/, '').replace(/^\/+/, '')
  if (!c || c.length > 300 || c.includes('..') || /^[a-z]:/i.test(c)) return null
  return c
}

function noteEnClair(n: NoteBelrive) {
  const { de, pour } = deEtPour(n)
  return { de, pour, statut: n.statut, cree_le: n.cree_le }
}

async function search(a: Record<string, unknown>, base: Base): Promise<ResultatOutil> {
  const r = preparerRecherche(chaine(a, 'query', 'requete', 'q') ?? '')
  const t = await base.chercher(r)
  return ok({
    results: t.map((x) => ({
      id: `${x.genre}:${x.id}`,
      title: x.genre === 'note' ? `Note : ${x.titre}` : x.titre,
      url: x.genre === 'doc' && x.chemin ? urlDocument(x.chemin) : urlNote(x.id),
      text: x.extrait,
      metadata: { genre: x.genre === 'doc' ? 'document' : 'note', chemin: x.chemin, date: x.date },
    })),
  }, t.length)
}

async function fetchOutil(a: Record<string, unknown>, base: Base): Promise<ResultatOutil> {
  const id = (chaine(a, 'id') ?? '').trim()
  if (!id) return refus('id manquant : donne l\'id d\'un résultat de search (doc:... ou note:...) ou le chemin d\'un document.')
  const debut = entier(a.debut)
  const longueur = entier(a.longueur)
  if (debut === 'invalide' || (debut !== null && debut < 0)) return refus('debut : un entier positif ou nul.')
  if (longueur === 'invalide' || (longueur !== null && longueur < 1)) return refus('longueur : un entier positif.')

  const introuvable = refus(`Rien trouvé pour « ${id.slice(0, 120)} ». Les ids viennent de search, lister_documents ou lister_notes.`)
  let doc: Document | null = null
  let note: NoteBelrive | null = null
  if (/^img:/i.test(id)) return refus('Une image ne se lit pas avec fetch : ses informations (titre, rôle, nom de fichier, type, taille) sont dans lister_documents, rubrique images.')
  const m = /^(doc|note):(.+)$/i.exec(id)
  if (m) {
    if (!UUID.test(m[2])) return introuvable
    if (m[1].toLowerCase() === 'doc') doc = await base.lireDocument(m[2].toLowerCase())
    else note = await base.lireNote(m[2].toLowerCase())
  } else if (UUID.test(id)) {
    doc = await base.lireDocument(id.toLowerCase())
    if (!doc) note = await base.lireNote(id.toLowerCase())
  } else {
    const chemin = normaliserChemin(id)
    if (!chemin) return introuvable
    doc = await base.lireDocumentParChemin(chemin)
  }

  if (doc) {
    const total = doc.contenu.length
    const d0 = debut ?? 0
    if (d0 > total) return refus(`debut dépasse la fin du document (${total} caractères).`)
    const fin = Math.min(total, d0 + (longueur ?? LONGUEUR_FETCH_DEFAUT))
    return ok({
      id: `doc:${doc.document_id}`,
      title: doc.titre,
      text: doc.contenu.slice(d0, fin),
      url: urlDocument(doc.chemin),
      metadata: {
        genre: 'document', chemin: doc.chemin, source: doc.source, version: doc.version, taille_octets: doc.taille,
        caracteres: total, debut: d0, fin, suite: fin < total, maj_le: doc.maj_le,
      },
    }, 1)
  }
  if (note) {
    const texte = note.liens.length ? `${note.texte}\n\nLiens :\n${note.liens.join('\n')}` : note.texte
    return ok({
      id: `note:${note.note_id}`,
      title: note.sujet,
      text: texte,
      url: urlNote(note.note_id),
      metadata: { genre: 'note', ...noteEnClair(note) },
    }, 1)
  }
  return introuvable
}

async function listerDocumentsOutil(_a: Record<string, unknown>, base: Base): Promise<ResultatOutil> {
  const docs = await base.listerDocuments()
  const images = await base.listerImages()
  return ok({
    documents: docs.map((d) => ({
      id: `doc:${d.document_id}`, titre: d.titre, chemin: d.chemin, taille_octets: d.taille,
      source: d.source, version: d.version, maj_le: d.maj_le,
    })),
    images: images.map(imageEnClair),
  }, docs.length + images.length)
}

function imageEnClair(i: ImageBelrive) {
  return {
    id: `img:${i.image_id}`, titre: i.titre, role: i.role, nom_fichier: i.nom_fichier, type: i.mime,
    taille_octets: i.taille, depose_le: i.depose_le,
  }
}

async function deposerImageOutil(a: Record<string, unknown>, base: Base): Promise<ResultatOutil> {
  const titre = (chaine(a, 'titre', 'title') ?? '').replace(/\s+/g, ' ').trim()
  const role = (chaine(a, 'role', 'legende', 'légende', 'caption') ?? '').replace(/\s+/g, ' ').trim()
  if (!titre) return refus('titre manquant.')
  if (titre.length > TITRE_IMAGE_MAX) return refus(`titre trop long : ${TITRE_IMAGE_MAX} caractères au plus.`)
  if (!role) return refus('role manquant : une légende courte qui dit ce que montre l\'image et à quoi elle sert.')
  if (role.length > ROLE_MAX) return refus(`role trop long : ${ROLE_MAX} caractères au plus.`)
  const nomSouhaite = chaine(a, 'nom_fichier', 'nom')
  if (nomSouhaite !== undefined && nomSouhaite.length > 120) return refus('nom_fichier trop long : 120 caractères au plus.')

  const s = lireSourceImage(a)
  if (!s.ok) return refus(s.raison)
  const source = s.source
  let octets: Buffer
  if (source.genre === 'base64') {
    octets = source.octets
  } else {
    const v = verifierUrl(source.url)
    if (!v.ok) return refus(`${source.genre === 'fichier' ? 'image' : 'url'} : ${v.raison}`)
    const t = await base.telechargerImage(source.url)
    if (!t.ok) return refus(`Téléchargement de l'image impossible : ${t.raison}`)
    octets = t.octets
  }
  const v = validerOctets(octets)
  if (!v.ok) return refus(v.raison)

  const empreinte = empreinteOctets(octets)
  const nomFichier = assainirNomFichier([nomSouhaite, source.nom, source.genre === 'url' ? nomDansUrl(source.url) : null, titre], v.type.ext)
  const r = await base.enregistrerImage({
    titre, role, nomFichier, chemin: cheminStockage(empreinte, v.type.ext), mime: v.type.mime, octets, empreinte, origine: source.genre,
  })
  return ok({
    ok: true,
    ...imageEnClair(r.image),
    deja_deposee: r.deja,
    note: r.deja
      ? 'Cette image (mêmes octets) était déjà déposée : rien de neuf n\'est écrit, voici son id. Cite-le dans ta note.'
      : 'Rangée à part, rapatriée sur le PC de Brice dans l\'heure (Scenario/De-GPT/images/). Cite son id dans ta note (ecrire_note) avec ce qu\'elle représente.',
  }, 1)
}

async function listerNotesOutil(a: Record<string, unknown>, base: Base): Promise<ResultatOutil> {
  const brut = (chaine(a, 'statut') ?? 'toutes').trim().toLowerCase().replace('traitée', 'traitee')
  if (!['nouvelle', 'lue', 'traitee', 'toutes'].includes(brut)) return refus('statut : nouvelle, lue, traitee ou toutes.')
  const lim = entier(a.limite)
  if (lim === 'invalide' || (lim !== null && (lim < 1 || lim > NOTES_MAX))) return refus(`limite : un entier de 1 à ${NOTES_MAX}.`)
  const notes = await base.listerNotes(brut as FiltreStatut, lim ?? 30)
  return ok({
    notes: notes.map((n) => ({
      id: `note:${n.note_id}`, ...noteEnClair(n), sujet: n.sujet,
      extrait: n.texte.length > 400 ? `${n.texte.slice(0, 400)}...` : n.texte,
    })),
  }, notes.length)
}

async function ecrireNoteOutil(a: Record<string, unknown>, base: Base): Promise<ResultatOutil> {
  const destinataire = lireDestinataire(a.pour)
  if (!destinataire) return refus('pour : sora, yume, sekai, toutes ou tab.')
  const sujet = (chaine(a, 'sujet') ?? '').trim()
  const texte = (chaine(a, 'texte') ?? '').trim()
  if (!sujet) return refus('sujet manquant (une ligne, 200 caractères au plus).')
  if (sujet.length > SUJET_MAX) return refus(`sujet trop long : ${SUJET_MAX} caractères au plus.`)
  if (!texte) return refus('texte manquant.')
  if (texte.length > TEXTE_MAX) return refus(`texte trop long : ${TEXTE_MAX} caractères au plus (reçu ${texte.length}).`)
  let liens: string[] = []
  if (a.liens !== undefined && a.liens !== null) {
    const brut = Array.isArray(a.liens) ? a.liens : typeof a.liens === 'string' ? [a.liens] : null
    if (!brut || brut.some((l) => typeof l !== 'string')) return refus('liens : une liste d\'adresses.')
    liens = (brut as string[]).map((l) => l.trim()).filter(Boolean)
    if (liens.length > LIENS_MAX) return refus(`liens : ${LIENS_MAX} au plus.`)
    if (liens.some((l) => l.length > 2000)) return refus('liens : 2 000 caractères au plus par lien.')
  }
  const r = await base.ecrireNote({ destinataire, sujet, texte, liens })
  return ok({
    ok: true,
    id: `note:${r.note.note_id}`,
    ...noteEnClair(r.note),
    prevenu: r.prevenu,
  }, 1)
}

async function deposerDocumentOutil(a: Record<string, unknown>, base: Base): Promise<ResultatOutil> {
  const titre = (chaine(a, 'titre', 'title') ?? '').replace(/\s+/g, ' ').trim()
  const contenu = (chaine(a, 'contenu', 'content', 'texte') ?? '').replace(/\u0000/g, '')
  if (!titre) return refus('titre manquant.')
  if (titre.length > TITRE_MAX) return refus(`titre trop long : ${TITRE_MAX} caractères au plus.`)
  if (!contenu.trim()) return refus('contenu manquant.')
  const octets = Buffer.byteLength(contenu, 'utf8')
  if (octets > DEPOT_MAX_OCTETS) return refus(`contenu trop long : ${DEPOT_MAX_OCTETS} octets au plus (reçu ${octets}). Découpe-le en plusieurs documents.`)
  const d = await base.deposerDocument({ titre, contenu, famille: familleDe(titre), empreinte: empreinteContenu(contenu) })
  if (!d) return { texte: ERREUR_INTERNE, erreur: true, lignes: null, raison: 'depot : conflit de version deux fois de suite' }
  return ok({
    ok: true,
    id: `doc:${d.document_id}`,
    titre: d.titre,
    chemin: d.chemin,
    version: d.version,
    taille_octets: d.taille,
    note: 'Rangé à part (Scenario/De-GPT/), rapatrié sur le PC de Brice dans l\'heure. Il ne remplace aucun document existant.',
  }, 1)
}

const EXECUTION: Record<string, (a: Record<string, unknown>, base: Base) => Promise<ResultatOutil>> = {
  search,
  fetch: fetchOutil,
  lister_documents: listerDocumentsOutil,
  lister_notes: listerNotesOutil,
  ecrire_note: ecrireNoteOutil,
  deposer_document: deposerDocumentOutil,
  deposer_image: deposerImageOutil,
}

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

type AppelJournal = { methode: string; outil?: string; args?: Record<string, unknown> }
type Traite = {
  reponse: Record<string, unknown> | null
  appel: AppelJournal | null
  lignes: number | null
  erreur: string | null
  /** Requete mal formee : HTTP 400 quand elle est seule. */
  invalide?: boolean
}

export function erreurRpc(id: string | number | null, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function succes(id: string | number, result: Record<string, unknown>): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result }
}

async function traiterMessage(m: unknown, base: Base): Promise<Traite> {
  const invalide = (id: string | number | null): Traite => ({
    reponse: erreurRpc(id, -32600, 'Requête invalide : un message JSON-RPC 2.0 est attendu.'),
    appel: null, lignes: null, erreur: 'requete invalide', invalide: true,
  })
  if (!estObjet(m) || m.jsonrpc !== '2.0') return invalide(estObjet(m) && idValide(m.id) ? m.id : null)
  const methode = m.method
  if (typeof methode !== 'string') {
    // Une reponse du client a une demande du serveur : ce serveur n'en fait jamais, on l'ignore.
    if (('result' in m || 'error' in m) && 'id' in m) return { reponse: null, appel: { methode: 'reponse' }, lignes: null, erreur: null }
    return invalide(idValide(m.id) ? m.id : null)
  }
  const nomMethode = methode.slice(0, 60)
  // Une notification (sans id) : rien a repondre (notifications/initialized, notifications/cancelled...).
  if (!('id' in m) || m.id === undefined) return { reponse: null, appel: { methode: nomMethode }, lignes: null, erreur: null }
  if (!idValide(m.id)) return invalide(null)
  const id = m.id
  const params = estObjet(m.params) ? m.params : {}
  const rendre = (result: Record<string, unknown>): Traite => ({ reponse: succes(id, result), appel: { methode: nomMethode }, lignes: null, erreur: null })

  switch (methode) {
    case 'initialize':
      return rendre({
        protocolVersion: choisirVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVEUR,
        instructions: INSTRUCTIONS,
      })
    case 'ping':
      return rendre({})
    case 'tools/list':
      return rendre({ tools: OUTILS })
    // Pas de ressources ni de prompts : des listes vides plutot qu'une erreur pour un client qui demande quand meme.
    case 'resources/list':
      return rendre({ resources: [] })
    case 'resources/templates/list':
      return rendre({ resourceTemplates: [] })
    case 'prompts/list':
      return rendre({ prompts: [] })
    case 'logging/setLevel':
      return rendre({})
    case 'tools/call': {
      const nom = typeof params.name === 'string' ? params.name : ''
      if (!NOMS_OUTILS.has(nom)) {
        return {
          reponse: erreurRpc(id, -32602, `Outil inconnu : ${nom.slice(0, 60) || '(aucun)'}. Outils : ${[...NOMS_OUTILS].join(', ')}.`),
          appel: { methode: nomMethode, outil: nom.slice(0, 40) || '(aucun)' }, lignes: null, erreur: 'outil inconnu',
        }
      }
      if (params.arguments !== undefined && params.arguments !== null && !estObjet(params.arguments)) {
        return {
          reponse: erreurRpc(id, -32602, 'arguments : un objet JSON est attendu.'),
          appel: { methode: nomMethode, outil: nom }, lignes: null, erreur: 'arguments invalides',
        }
      }
      const args = estObjet(params.arguments) ? params.arguments : {}
      let r: ResultatOutil
      try {
        r = await EXECUTION[nom](args, base)
      } catch (err) {
        // Jamais le detail a ChatGPT : il reste dans le journal d'acces.
        r = { texte: ERREUR_INTERNE, erreur: true, lignes: null, raison: raisonDe(err) }
      }
      return {
        reponse: succes(id, { content: [{ type: 'text', text: r.texte }], isError: r.erreur }),
        appel: { methode: nomMethode, outil: nom, args: resumeArgs(args) },
        lignes: r.lignes,
        erreur: r.raison,
      }
    }
    default:
      return { reponse: erreurRpc(id, -32601, `Méthode inconnue : ${nomMethode}.`), appel: { methode: nomMethode }, lignes: null, erreur: 'methode inconnue' }
  }
}

function routeDe(a: AppelJournal | null): string {
  if (!a) return 'mcp'
  return `mcp/${a.methode}${a.outil ? `/${a.outil}` : ''}`.slice(0, 120)
}

export const INTROUVABLE = { erreur: 'Introuvable.' }

/**
 * Un POST sur /api/mcp/<secret> : la cle, puis le corps JSON-RPC (un message
 * ou un lot). La cle passe AVANT tout le reste : sans elle, la reponse est la
 * meme 404 neutre, que le secret soit absent, inconnu ou coupe.
 */
export async function traiterPost(e: EntreePost, d: Dependances): Promise<SortieHttp> {
  if (!SECRET_GPT.test(e.secret)) return { status: 404, corps: INTROUVABLE, journal: null }
  const v = await d.verifierCle(e.secret)
  if (!v.ok) {
    if (v.raison === 'base') return { status: 503, corps: { erreur: 'Service indisponible, réessaie dans un instant.' }, journal: null }
    if (v.raison === 'debit') {
      return {
        status: 429,
        corps: erreurRpc(null, -32000, `Trop d'appels : ${DEBIT_PAR_MINUTE_GPT} par minute au plus. Réessaie dans une minute.`),
        journal: { cleId: v.cleId, route: 'mcp', parametres: {}, lignes: null, erreur: 'debit depasse' },
      }
    }
    return { status: 404, corps: INTROUVABLE, journal: { cleId: null, route: 'mcp', parametres: {}, lignes: null, erreur: 'cle inconnue ou coupee' } }
  }

  const cleId = v.cleId
  const versionEntete = e.versionProtocole?.trim() || null
  const parametres: Record<string, unknown> = versionEntete ? { protocole: versionEntete.slice(0, 40) } : {}
  const refusHttp = (status: number, code: number, message: string, erreur: string): SortieHttp => ({
    status, corps: erreurRpc(null, code, message), journal: { cleId, route: 'mcp', parametres, lignes: null, erreur },
  })

  if (e.brut.length > CORPS_MAX) return refusHttp(413, -32600, 'Requête trop grosse (1 Mo au plus).', 'corps trop gros')
  if (!estJson(e.typeContenu)) return refusHttp(415, -32600, 'Content-Type: application/json attendu.', 'content-type')
  let corps: unknown
  try {
    corps = JSON.parse(e.brut)
  } catch {
    return refusHttp(400, -32700, 'JSON illisible.', 'json illisible')
  }
  // (23/10) initialize negocie la version dans son corps (versionNegociee) : un en-tete plus recent que les
  // notres ne le bloque pas. ChatGPT envoyait 2026-07-28 et n'aboutissait qu'au 2e essai.
  const estInitialize = (m: unknown) => !!m && typeof m === 'object' && (m as { method?: unknown }).method === 'initialize'
  const initialise = Array.isArray(corps) ? corps.some(estInitialize) : estInitialize(corps)
  if (versionEntete && !versionAcceptee(versionEntete) && !initialise) {
    return refusHttp(400, -32600, `Version du protocole MCP non prise en charge : ${versionEntete.slice(0, 40)}. Versions : ${VERSIONS_PROTOCOLE.join(', ')}.`, 'version du protocole')
  }

  if (Array.isArray(corps)) {
    if (corps.length === 0 || corps.length > LOT_MAX) return refusHttp(400, -32600, `Lot vide ou trop long (${LOT_MAX} messages au plus).`, 'lot')
    const reponses: Record<string, unknown>[] = []
    const appels: AppelJournal[] = []
    const erreurs: string[] = []
    let lignes: number | null = null
    for (const m of corps) {
      const r = await traiterMessage(m, d.base)
      if (r.reponse) reponses.push(r.reponse)
      if (r.appel) appels.push(r.appel)
      if (r.erreur) erreurs.push(r.erreur)
      if (r.lignes !== null) lignes = (lignes ?? 0) + r.lignes
    }
    const journal: JournalAppel = {
      cleId, route: `mcp/lot/${corps.length}`, parametres: { ...parametres, appels: appels.slice(0, LOT_MAX) },
      lignes, erreur: erreurs.length ? erreurs.join(' | ').slice(0, 300) : null,
    }
    return reponses.length ? { status: 200, corps: reponses, journal } : { status: 202, corps: null, journal }
  }

  const r = await traiterMessage(corps, d.base)
  const journal: JournalAppel = {
    cleId, route: routeDe(r.appel), parametres: r.appel?.args ? { ...parametres, args: r.appel.args } : parametres,
    lignes: r.lignes, erreur: r.erreur,
  }
  if (!r.reponse) return { status: 202, corps: null, journal }
  return { status: r.invalide ? 400 : 200, corps: r.reponse, journal }
}
