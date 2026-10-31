// LA TRANSCRIPTION D'UN FICHIER AUDIO (31/10/2026, Brice : Agent AOK doit
// comprendre les messages vocaux).
//
// Module PUR : aucun import (scripts/verifier-vocaux.mjs le charge tel quel).
// Le reseau passe par un fetch DONNE par l'appelant (le vrai au serveur, un
// faux dans le verificateur), la cle aussi : rien ici ne lit l'environnement
// de lui-meme, rien n'ecrit de log.
//
// CHANGER DE FOURNISSEUR. Tout service compatible OpenAI (POST multipart sur
// .../audio/transcriptions, champs file, model, language, response_format,
// reponse { "text": ... }) se branche en changeant FOURNISSEUR_TRANSCRIPTION
// ci-dessous (URL, modele, nom de la variable de la cle, prix, delai), et rien
// d'autre : le canal Telegram (agent-cockpit-telegram.ts) et le cout
// (transcription.ts) lisent tout ici.
//
// Groq, whisper-large-v3-turbo (choix de Brice, 31/10) : 0,04 USD par heure
// d'audio, 10 s facturees au minimum par requete ; l'OGG/Opus des vocaux
// Telegram passe tel quel.

export type FournisseurTranscription = {
  /** Pour les logs et les messages (« Groq »). */
  nom: string
  /** POST multipart, compatible OpenAI. */
  url: string
  modele: string
  /** Le NOM de la variable d'environnement qui porte la cle (un produit = une cle). */
  variableCle: string
  /** Code ISO 639-1 : l'equipe parle francais. */
  langue: string
  /** Delai maximum d'une transcription (AbortSignal). */
  delaiMs: number
  usdParHeure: number
  /** Duree facturee au minimum par requete, en secondes. */
  minimumFactureS: number
  /** Poids maximal d'un fichier accepte par le service. */
  maxOctets: number
}

export const GROQ_WHISPER: FournisseurTranscription = {
  nom: 'Groq',
  url: 'https://api.groq.com/openai/v1/audio/transcriptions',
  modele: 'whisper-large-v3-turbo',
  variableCle: 'GROQ_API_KEY_COCKPIT',
  langue: 'fr',
  delaiMs: 30_000,
  usdParHeure: 0.04,
  minimumFactureS: 10,
  // Offre gratuite de Groq : 25 Mo par fichier (100 Mo en offre payante).
  maxOctets: 25_000_000,
}

/** Le fournisseur en service. */
export const FOURNISSEUR_TRANSCRIPTION: FournisseurTranscription = GROQ_WHISPER

/** La cle du fournisseur, lue dans `env` (process.env au serveur), ou null. Jamais affichee. */
export function cleTranscription(env: Record<string, string | undefined>, f: FournisseurTranscription = FOURNISSEUR_TRANSCRIPTION): string | null {
  const v = env[f.variableCle]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** La duree facturee (secondes entieres), avec le minimum par requete. Duree inconnue = le minimum. */
export function dureeFacturee(dureeS: number | null | undefined, f: FournisseurTranscription = FOURNISSEUR_TRANSCRIPTION): number {
  const d = typeof dureeS === 'number' && Number.isFinite(dureeS) && dureeS > 0 ? Math.ceil(dureeS) : 0
  return Math.max(f.minimumFactureS, d)
}

/**
 * Le cout d'une transcription en MICRO-euros (meme unite que AiUsage.costMicros,
 * fige a l'ecriture). `usdVersEur` : le taux de ia-prix.ts (USD_VERS_EUR), passe
 * par l'appelant pour garder ce module sans import.
 */
export function coutTranscriptionMicroEuros(
  dureeS: number | null | undefined, usdVersEur: number, f: FournisseurTranscription = FOURNISSEUR_TRANSCRIPTION,
): number {
  return Math.round((dureeFacturee(dureeS, f) / 3600) * f.usdParHeure * usdVersEur * 1_000_000)
}

/**
 * Ce qu'il faut laisser au tour de l'agent apres la transcription : le webhook
 * a une limite (limiteDuTour), la transcription ne la mange pas.
 */
export const RESERVE_APRES_TRANSCRIPTION_MS = 90_000

/**
 * Le delai laisse a la transcription : celui du fournisseur, sans entamer la
 * reserve du tour avant `limite`. 0 = plus le temps (on ne l'appelle pas).
 */
export function delaiTranscription(limite: number, maintenant: number, f: FournisseurTranscription = FOURNISSEUR_TRANSCRIPTION): number {
  const d = Math.min(f.delaiMs, limite - maintenant - RESERVE_APRES_TRANSCRIPTION_MS)
  return Number.isFinite(d) && d >= 1000 ? Math.floor(d) : 0
}

/** Le corps multipart : file (avec un nom dont l'extension dit le format), model, language, response_format json. */
export function corpsTranscription(
  octets: Uint8Array, nomFichier: string, mime: string, f: FournisseurTranscription = FOURNISSEUR_TRANSCRIPTION,
): FormData {
  const corps = new FormData()
  corps.append('file', new Blob([octets as BlobPart], { type: mime || 'application/octet-stream' }), nomFichier)
  corps.append('model', f.modele)
  corps.append('language', f.langue)
  corps.append('response_format', 'json')
  return corps
}

/** Le texte d'une reponse { "text": ... }, ou null si la reponse n'a pas cette forme. */
export function lireTexteTranscription(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const t = (json as { text?: unknown }).text
  return typeof t === 'string' ? t : null
}

/** Une transcription sur une ligne (Whisper commence souvent par une espace, et coupe en lignes). */
export function nettoyerTranscription(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim()
}

// Ce que Whisper ecrit sur un enregistrement SANS parole (sous-titres appris
// sur des videos) : une transcription faite uniquement de cela est vide.
// L'apostrophe typographique et les points de suspension en un caractere, que
// Whisper ecrit parfois, sont construits par leur code pour qu'aucun ne figure
// en clair dans ce fichier.
const APOSTROPHE_TYPO = String.fromCharCode(0x2019)
const POINTS_SUSPENSION = String.fromCharCode(0x2026)
const HALLUCINATIONS_SILENCE = [
  new RegExp(`^sous-titr(es|age)( r[ée]alis[ée]s)? par (la communaut[ée] d['${APOSTROPHE_TYPO}]?)?amara[.]org$`, 'i'),
  new RegExp(`^sous-titrage (st['${APOSTROPHE_TYPO}] ?501|soci[ée]t[ée] radio-canada)$`, 'i'),
]
// La ponctuation autour d'une transcription deja nettoyee (une ligne, espaces simples).
const PONCTUATION_AUTOUR = new RegExp(`^[ .!?${POINTS_SUSPENSION}]+|[ .!?${POINTS_SUSPENSION}]+$`, 'gu')

/** (31/10) Rien a dire : vide, sans une lettre ni un chiffre (« ... »), ou un sous-titre fantome de Whisper sur un silence. */
export function transcriptionVide(texte: string): boolean {
  const t = nettoyerTranscription(texte)
  if (!/[\p{L}\p{N}]/u.test(t)) return true
  const net = t.replace(PONCTUATION_AUTOUR, '')
  return HALLUCINATIONS_SILENCE.some(r => r.test(net))
}

export type EchecTranscription = 'sans_cle' | 'trop_gros' | 'illisible' | 'delai' | 'echec' | 'cle_refusee' | 'vide'

export type IssueTranscription =
  | { ok: true; texte: string }
  | { ok: false; raison: EchecTranscription; taille?: number; statut?: number | null }

/**
 * Envoie un fichier audio au fournisseur et rend son texte (nettoye). Ne jette
 * pas. 401 ou 403 : cle refusee ; 413 : fichier trop lourd ; delai depasse :
 * 'delai' ; tout le reste : 'echec', avec le statut HTTP pour le log de
 * l'appelant. Le texte peut etre vide : c'est a l'appelant d'en juger (il est
 * facture quand meme).
 */
export async function transcrire(o: {
  octets: Uint8Array
  nomFichier: string
  mime: string
  cle: string
  delaiMs: number
  fetch: typeof fetch
  fournisseur?: FournisseurTranscription
}): Promise<{ ok: true; texte: string } | { ok: false; raison: 'delai' | 'echec' | 'cle_refusee' | 'trop_gros'; statut: number | null }> {
  const f = o.fournisseur ?? FOURNISSEUR_TRANSCRIPTION
  try {
    const reponse = await o.fetch(f.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${o.cle}` },
      body: corpsTranscription(o.octets, o.nomFichier, o.mime, f),
      signal: AbortSignal.timeout(o.delaiMs),
    })
    if (reponse.status === 401 || reponse.status === 403) return { ok: false, raison: 'cle_refusee', statut: reponse.status }
    if (reponse.status === 413) return { ok: false, raison: 'trop_gros', statut: 413 }
    if (!reponse.ok) return { ok: false, raison: 'echec', statut: reponse.status }
    const texte = lireTexteTranscription(await reponse.json().catch(() => null))
    if (texte === null) return { ok: false, raison: 'echec', statut: reponse.status }
    return { ok: true, texte: nettoyerTranscription(texte) }
  } catch (err) {
    const nom = err && typeof err === 'object' ? (err as { name?: unknown }).name : null
    if (nom === 'TimeoutError' || nom === 'AbortError') return { ok: false, raison: 'delai', statut: null }
    return { ok: false, raison: 'echec', statut: null }
  }
}

/** Le telechargement d'un fichier (Telegram au serveur : telechargerFichierTelegram), meme forme. */
export type IssueFichier =
  | { ok: true; octets: Uint8Array }
  | { ok: false; raison: 'trop_gros'; taille: number }
  | { ok: false; raison: 'illisible' }

/**
 * Le chemin complet d'un fichier audio : cle, temps, telechargement (au plus
 * le plus petit des deux poids maximaux), transcription, puis `facturer` des
 * que le fournisseur a rendu un texte (vide compris : il est facture). Sans
 * cle ou sans temps, rien n'est telecharge. Ne jette pas, sauf si `facturer`
 * jette (il ne doit pas).
 */
export async function telechargerEtTranscrire(
  fichier: { fileId: string; taille: number | null; nomFichier: string; mime: string },
  d: {
    cle: string | null
    maxOctets: number
    telecharger: (fileId: string, max: number, taille: number | null) => Promise<IssueFichier>
    fetch: typeof fetch
    delaiMs: number
    fournisseur?: FournisseurTranscription
    facturer?: () => Promise<void>
  },
): Promise<IssueTranscription> {
  const f = d.fournisseur ?? FOURNISSEUR_TRANSCRIPTION
  if (!d.cle) return { ok: false, raison: 'sans_cle' }
  if (!(d.delaiMs >= 1000)) return { ok: false, raison: 'delai' }
  const max = Math.min(d.maxOctets, f.maxOctets)
  if (fichier.taille !== null && fichier.taille > max) return { ok: false, raison: 'trop_gros', taille: fichier.taille }
  const telecharge = await d.telecharger(fichier.fileId, max, fichier.taille)
  if (!telecharge.ok) {
    return telecharge.raison === 'trop_gros' ? { ok: false, raison: 'trop_gros', taille: telecharge.taille } : { ok: false, raison: 'illisible' }
  }
  if (telecharge.octets.byteLength === 0) return { ok: false, raison: 'illisible' }
  const issue = await transcrire({
    octets: telecharge.octets, nomFichier: fichier.nomFichier, mime: fichier.mime, cle: d.cle, delaiMs: d.delaiMs, fetch: d.fetch, fournisseur: f,
  })
  if (!issue.ok) {
    return issue.raison === 'trop_gros'
      ? { ok: false, raison: 'trop_gros', taille: telecharge.octets.byteLength, statut: issue.statut }
      : { ok: false, raison: issue.raison, statut: issue.statut }
  }
  if (d.facturer) await d.facturer()
  if (transcriptionVide(issue.texte)) return { ok: false, raison: 'vide' }
  return { ok: true, texte: issue.texte }
}
