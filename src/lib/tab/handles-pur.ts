// LES @HANDLES DES RESEAUX (13/11/2026) : les regles pures du lot que Tab
// pousse par POST /api/tab/v1/handles. Aucun import : le script de
// verification les fait tourner sans base (scripts/verifier-handles-sociaux.mjs).
//
// Demande de Brice (10/11, note de Tab 50cdb878) : chaque @handle qui interagit
// avec nous remonte dans le cockpit, rapproche de la fiche client. INTERNE :
// le membre ne voit jamais qu'on l'a. Table cockpit_handles_sociaux (migration
// 20261113235500 du workspace), ecrite par le serveur seulement.
//
// Le format du lot (une ligne par handle) : plateforme, handle, statut, qui,
// preuve, source, interactions, dernier_echange. JAMAIS D'EMAIL : une ligne
// qui en porte un est refusee, et l'erreur ne le recopie pas.
//
// Les deux regles d'ecriture (decider()) :
// - IDEMPOTENT : le meme handle (plateforme + handle normalise) met a jour sa
//   ligne, il n'en cree jamais une deuxieme ; renvoyer le meme lot ne change
//   rien (interactions = le nombre du dernier lot, pas une somme).
// - Un statut « sur » POSE A LA MAIN (pose_par main:...) n'est jamais
//   retrograde par un lot : ni le statut, ni la personne, ni la preuve ne
//   bougent ; seules les observations (interactions, source, dates) suivent.
// Et une precaution de plus : une ligne sans « qui » n'efface jamais une
// identification deja posee (Tab qui ne se souvient pas d'un rapprochement ne
// le defait pas).

export const STATUTS = ['sur', 'probable', 'a_identifier'] as const
export type Statut = (typeof STATUTS)[number]
const RANG: Record<Statut, number> = { a_identifier: 0, probable: 1, sur: 2 }

export const MAX_LIGNES = 200
export const MAX_PREUVE = 300
export const MAX_SOURCE = 200
export const MAX_NOTE = 500
export const MAX_INTERACTIONS = 1_000_000
export const CHAMPS_LIGNE = ['plateforme', 'handle', 'statut', 'qui', 'preuve', 'source', 'interactions', 'dernier_echange'] as const
export const CHAMPS_LOT = ['lignes', 'a_blanc'] as const

/** Les natures du fonds (cockpit_arch_personnes.nature) qui comptent comme l'equipe pour « equipe : prenom ». */
export const NATURES_EQUIPE = ['equipe', 'associee-principale', 'associee', 'associe', 'eleve-equipe', 'ancien-equipe'] as const

const ALIAS_PLATEFORME: Record<string, string> = {
  twitter: 'x', 'x.com': 'x', ig: 'instagram', insta: 'instagram', yt: 'youtube', tt: 'tiktok', fb: 'facebook', tg: 'telegram',
}

export type Qui =
  | { type: 'vide' }
  | { type: 'numero'; numero: number }
  | { type: 'equipe'; prenom: string }
  | { type: 'membre'; membreId: string }
  | { type: 'personne'; personneId: string }

export type LigneLot = {
  /** Sa place dans le lot, a partir de 1 (pour que Tab retrouve la ligne). */
  rang: number
  plateforme: string
  handle: string
  statut: Statut
  qui: Qui
  preuve: string | null
  source: string | null
  /** null = le lot ne le donne pas (la valeur en base ne bouge pas). */
  interactions: number | null
  /** AAAA-MM-JJ, ou null. */
  dernierEchange: string | null
}

export type LigneRefusee = { rang: number; plateforme: string | null; handle: string | null; erreur: string }

export type Lot = { lignes: LigneLot[]; refusees: LigneRefusee[]; aBlanc: boolean }

/** Qui est derriere un handle. Toutes les valeurs peuvent etre vides. */
export type Identite = { membreId: string | null; personneId: string | null; numeroMembre: number | null; equipe: string | null }

/** Ce que le serveur a trouve pour le « qui » d'une ligne. */
export type Resolution = {
  identite: Identite
  /** Le plafond du statut (probable quand plusieurs fiches sont possibles). */
  statutMax: Statut
  note: string | null
}

/** Une ligne de cockpit_handles_sociaux, telle que decider() la lit et la rend. */
export type EtatHandle = Identite & {
  statut: Statut
  preuve: string | null
  source: string | null
  note: string | null
  interactions: number
  premierVu: string | null
  dernierVu: string | null
  posePar: string
}

export type Decision = { action: 'cree' | 'mis_a_jour' | 'inchange'; etat: EtatHandle; remarques: string[] }

const EMAIL = /[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[a-z]{2,}/i

/** Vrai si le texte porte une adresse email (jamais acceptee dans un lot). */
export function contientEmail(v: unknown): boolean {
  return typeof v === 'string' && EMAIL.test(v)
}

/** Une copie sans aucune adresse email (pour le journal d'acces de l'API). */
export function masquerEmails<T>(v: T): T {
  return JSON.parse(JSON.stringify(v ?? null, (_k, x) => (typeof x === 'string'
    ? x.replace(new RegExp(EMAIL.source, 'gi'), '[email]')
    : x))) as T
}

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

export function normaliserPlateforme(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = sansAccents(v.trim().toLowerCase())
  const p = ALIAS_PLATEFORME[s] ?? s
  return /^[a-z][a-z0-9_-]{0,29}$/.test(p) ? p : null
}

/**
 * Le handle sans « @ », en minuscules. Une adresse de profil est acceptee
 * (https://www.tiktok.com/@alextraderft -> alextraderft) : le segment qui
 * commence par @, sinon le premier segment du chemin.
 */
export function normaliserHandle(v: unknown): string | null {
  if (typeof v !== 'string') return null
  let s = v.trim()
  if (s.includes('/')) {
    const sansSchema = s.replace(/^[a-z]+:\/\//i, '').split(/[?#]/)[0]
    const segments = sansSchema.split('/').slice(1).filter(Boolean)
    s = segments.find((x) => x.startsWith('@')) ?? segments[0] ?? ''
  }
  s = s.replace(/^@+/, '').toLowerCase()
  return /^[a-z0-9._-]{1,100}$/.test(s) ? s : null
}

export function lireStatut(v: unknown): Statut | null {
  if (typeof v !== 'string') return null
  const s = sansAccents(v.trim().toLowerCase()).replace(/[\s-]+/g, '_')
  if (s === 'sur' || s === 'sure') return 'sur'
  if (s === 'probable') return 'probable'
  if (s === 'a_identifier') return 'a_identifier'
  return null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * « qui » : un numero de membre (248, n°248, #248), « equipe : prenom »,
 * membre:<uuid> (l'identifiant de fiche que rend /personne), p-... (une
 * personne du fonds), ou vide. Rend un texte d'erreur sinon (sans recopier
 * une adresse email).
 */
export function lireQui(v: unknown): Qui | string {
  if (v === undefined || v === null) return { type: 'vide' }
  if (typeof v === 'number') {
    return Number.isInteger(v) && v > 0 && v < 1e9 ? { type: 'numero', numero: v } : 'qui : numéro de membre invalide.'
  }
  if (typeof v !== 'string') return 'qui : un texte attendu (numéro de membre, « équipe : prénom », membre:<uuid>, p-... ou vide).'
  const s = v.trim()
  if (s === '' || s === '-' || sansAccents(s.toLowerCase()) === 'vide') return { type: 'vide' }
  if (contientEmail(s)) return 'qui : jamais d\'email. Donne le numéro de membre, « équipe : prénom » ou laisse vide.'
  const n = /^(?:n\s*[°o]\.?\s*|#\s*)?(\d{1,9})$/i.exec(s)
  if (n) {
    const numero = Number(n[1])
    return numero > 0 ? { type: 'numero', numero } : 'qui : numéro de membre invalide.'
  }
  const e = /^[eé]quipe\s*[:-]\s*(.+)$/iu.exec(s)
  if (e) {
    const prenom = e[1].trim().replace(/\s+/g, ' ')
    return /^\p{L}[\p{L}' .-]{0,59}$/u.test(prenom) ? { type: 'equipe', prenom } : 'qui : « équipe : prénom » attend un prénom (60 caractères au plus).'
  }
  const m = /^membre:(.+)$/i.exec(s)
  if (m) return UUID.test(m[1].trim()) ? { type: 'membre', membreId: m[1].trim().toLowerCase() } : 'qui : membre:<uuid> attend l\'identifiant complet de la fiche.'
  if (/^p-[a-z0-9][a-z0-9-]{0,99}$/.test(s)) return { type: 'personne', personneId: s }
  return 'qui : numéro de membre, « équipe : prénom », membre:<uuid>, p-... ou vide.'
}

/** Un texte d'une ligne : espaces resserres, vide = null. Rend une erreur (sans recopier d'email). */
export function lireTexteLigne(v: unknown, max: number, champ: string): string | null | { erreur: string } {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') return { erreur: `${champ} : un texte attendu.` }
  const s = v.replace(/\s+/g, ' ').trim()
  if (!s) return null
  if (contientEmail(s)) return { erreur: `${champ} : jamais d'email (retire l'adresse).` }
  if (s.length > max) return { erreur: `${champ} : ${max} caractères au plus (rien n'est coupé).` }
  return s
}

export function lireInteractions(v: unknown): number | null | { erreur: string } {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN
  if (!Number.isInteger(n) || n < 0 || n > MAX_INTERACTIONS) return { erreur: `interactions : un nombre entier de 0 à ${MAX_INTERACTIONS}.` }
  return n
}

function jourValide(j: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(j)) return false
  const d = new Date(`${j}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === j
}

/** La date du dernier echange : AAAA-MM-JJ (ou un horodatage ISO) ou JJ/MM/AAAA, jamais apres aujourd'hui. */
export function lireDate(v: unknown, aujourdhui: string): string | null | { erreur: string } {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') return { erreur: 'dernier_echange : une date AAAA-MM-JJ attendue.' }
  const s = v.trim()
  let j: string | null = null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) j = s.slice(0, 10)
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (fr) j = `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
  if (!j || !jourValide(j)) return { erreur: 'dernier_echange : une date AAAA-MM-JJ attendue.' }
  if (j > aujourdhui) return { erreur: 'dernier_echange : la date est dans le futur.' }
  if (j < '2015-01-01') return { erreur: 'dernier_echange : date trop ancienne.' }
  return j
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Lit le corps de POST /handles : { lignes: [...], a_blanc?: true }. Rend un
 * texte d'erreur quand le lot entier est illisible ; sinon les lignes valides
 * et les lignes refusees (chacune avec sa raison), sans rien ecrire.
 */
export function lireLot(corps: unknown, aujourdhui: string): Lot | string {
  if (!estObjet(corps)) return 'Corps JSON attendu : { "lignes": [ { "plateforme", "handle", "statut", "qui", "preuve", "source", "interactions", "dernier_echange" } ] }.'
  const inconnus = Object.keys(corps).filter((k) => !(CHAMPS_LOT as readonly string[]).includes(k))
  if (inconnus.length) return `Champ inconnu dans le lot : ${inconnus.slice(0, 5).join(', ')} (le lot prend lignes et a_blanc).`
  const aBlanc = corps.a_blanc === undefined ? false : corps.a_blanc
  if (typeof aBlanc !== 'boolean') return 'a_blanc : true ou false.'
  const brutes = corps.lignes
  if (!Array.isArray(brutes) || brutes.length === 0) return 'lignes : une liste d\'au moins une ligne.'
  if (brutes.length > MAX_LIGNES) return `lignes : ${MAX_LIGNES} lignes au plus par lot (en a ${brutes.length}).`

  const lignes: LigneLot[] = []
  const refusees: LigneRefusee[] = []
  const vues = new Map<string, number>()
  brutes.forEach((b, i) => {
    const rang = i + 1
    if (!estObjet(b)) { refusees.push({ rang, plateforme: null, handle: null, erreur: 'Une ligne est un objet JSON.' }); return }
    const plateforme = normaliserPlateforme(b.plateforme)
    const handle = normaliserHandle(b.handle)
    const refuser = (erreur: string) => refusees.push({ rang, plateforme, handle, erreur })
    const inconnusLigne = Object.keys(b).filter((k) => !(CHAMPS_LIGNE as readonly string[]).includes(k))
    if (inconnusLigne.length) return refuser(`Champ inconnu : ${inconnusLigne.slice(0, 5).map((k) => (contientEmail(k) ? '[email]' : k.slice(0, 40))).join(', ')} (les champs : ${CHAMPS_LIGNE.join(', ')}).`)
    // Aucune erreur ci-dessous ne recopie la valeur recue : une adresse email n'y repasse jamais.
    if (!plateforme) return refuser('plateforme : tiktok, instagram, youtube, x... (lettres minuscules).')
    if (!handle) return refuser(contientEmail(b.handle) ? 'handle : jamais d\'email.' : 'handle : lettres, chiffres, point, tiret ou tiret bas, avec ou sans @ (100 caractères au plus).')
    const statut = lireStatut(b.statut)
    if (!statut) return refuser('statut : sur, probable ou a_identifier.')
    const qui = lireQui(b.qui)
    if (typeof qui === 'string') return refuser(qui)
    if (statut === 'a_identifier' && qui.type !== 'vide') return refuser('statut a_identifier : qui reste vide (sinon, mets probable).')
    if (statut !== 'a_identifier' && qui.type === 'vide') return refuser(`statut ${statut} : qui est obligatoire (numéro de membre, « équipe : prénom », membre:<uuid> ou p-...).`)
    const preuve = lireTexteLigne(b.preuve, MAX_PREUVE, 'preuve')
    if (preuve && typeof preuve === 'object') return refuser(preuve.erreur)
    const source = lireTexteLigne(b.source, MAX_SOURCE, 'source')
    if (source && typeof source === 'object') return refuser(source.erreur)
    const interactions = lireInteractions(b.interactions)
    if (interactions !== null && typeof interactions === 'object') return refuser(interactions.erreur)
    const dernierEchange = lireDate(b.dernier_echange, aujourdhui)
    if (dernierEchange && typeof dernierEchange === 'object') return refuser(dernierEchange.erreur)
    const cle = `${plateforme}\u0000${handle}`
    const deja = vues.get(cle)
    if (deja) return refuser(`Doublon de la ligne ${deja} (même plateforme, même handle) : une seule ligne par handle.`)
    vues.set(cle, rang)
    lignes.push({ rang, plateforme, handle, statut, qui, preuve, source, interactions, dernierEchange })
  })
  return { lignes, refusees, aBlanc }
}

/** La personne du fonds qui porte ce prenom dans l'equipe : une seule, sinon aucune (jamais de choix au hasard). */
export function personneEquipe(
  prenom: string, candidats: { personne_id: string; nom: string | null; alias: string | null }[],
): { trouvee: string | null; nombre: number } {
  const cle = sansAccents(prenom).toLowerCase().trim()
  const ok = candidats.filter((c) => {
    const premier = sansAccents((c.nom ?? '').trim().split(/\s+/)[0] ?? '').toLowerCase()
    const alias = (c.alias ?? '').split(',').map((a) => sansAccents(a).toLowerCase().trim()).filter(Boolean)
    return premier === cle || alias.includes(cle)
  })
  return { trouvee: ok.length === 1 ? ok[0].personne_id : null, nombre: ok.length }
}

export function aUneIdentite(i: Identite): boolean {
  return i.membreId !== null || i.personneId !== null || i.numeroMembre !== null || i.equipe !== null
}

function memeIdentite(a: Identite, b: Identite): boolean {
  return a.membreId === b.membreId && a.personneId === b.personneId && a.numeroMembre === b.numeroMembre && a.equipe === b.equipe
}

const VIDE: Identite = { membreId: null, personneId: null, numeroMembre: null, equipe: null }

export function plafonner(statut: Statut, max: Statut): Statut {
  return RANG[statut] <= RANG[max] ? statut : max
}

const minJour = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a < b ? a : b)
const maxJour = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b)

/** Le statut « sur » pose a la main : un lot ne le change jamais. */
export function estFige(e: EtatHandle | null): boolean {
  return !!e && e.statut === 'sur' && e.posePar.startsWith('main:')
}

/**
 * Ce qu'une ligne du lot fait d'une ligne existante (ou de rien). Pur : le
 * serveur lit la ligne existante sous verrou, appelle decider(), ecrit
 * l'etat rendu tel quel (ou rien si inchange).
 */
export function decider(
  existant: EtatHandle | null, ligne: LigneLot, resolution: Resolution, posePar: string, aujourdhui: string,
): Decision {
  const remarques: string[] = []
  const interactions = ligne.interactions ?? existant?.interactions ?? 0
  const source = ligne.source ?? existant?.source ?? null
  const premierVu = existant ? minJour(existant.premierVu, ligne.dernierEchange) : (ligne.dernierEchange ?? aujourdhui)
  const dernierVu = existant ? maxJour(existant.dernierVu, ligne.dernierEchange) : ligne.dernierEchange
  const observations = { interactions, source, premierVu, dernierVu }

  let etat: EtatHandle
  if (existant && estFige(existant)) {
    // Le « sur » pose a la main : personne, statut, preuve et note restent.
    etat = { ...existant, ...observations }
    remarques.push(`Statut « sûr » posé à la main (${existant.posePar.slice(5)}) : le lot ne le change pas, seules les observations suivent.`)
    if (ligne.qui.type !== 'vide' && !memeIdentite(existant, resolution.identite)) {
      remarques.push('Le lot rattachait ce handle à une autre personne : à regarder dans le cockpit, rien n\'a bougé.')
    }
  } else if (existant && ligne.qui.type === 'vide' && aUneIdentite(existant)) {
    // Une ligne sans « qui » n'efface jamais une identification deja posee.
    etat = { ...existant, ...observations, preuve: existant.preuve }
    remarques.push(`Identification gardée (${existant.statut}) : le lot n'en donnait pas.`)
  } else {
    const identite = ligne.qui.type === 'vide' ? VIDE : resolution.identite
    const statut = plafonner(ligne.statut, resolution.statutMax)
    if (statut !== ligne.statut) remarques.push(`Statut ramené à ${statut} : ${resolution.note ?? 'rapprochement incertain'}.`)
    const garde = existant && memeIdentite(existant, identite)
    const preuve = ligne.preuve ?? (garde ? existant!.preuve : null)
    const note = ligne.qui.type === 'vide' ? null : resolution.note
    const changeStatut = !existant || existant.statut !== statut || !garde || existant.preuve !== preuve || existant.note !== note
    etat = {
      ...identite, statut, preuve, note, ...observations,
      posePar: changeStatut ? posePar : existant!.posePar,
    }
  }

  if (!existant) return { action: 'cree', etat, remarques }
  const pareil = (Object.keys(etat) as (keyof EtatHandle)[]).every((k) => etat[k] === existant[k])
  return { action: pareil ? 'inchange' : 'mis_a_jour', etat, remarques }
}

/** Le libelle de « qui » pour la reponse (jamais d'email : prenom et nom de la fiche, nom du fonds, numero, equipe). */
export function libelleIdentite(i: Identite, noms: { fiche?: string | null; personne?: string | null }): string | null {
  const morceaux: string[] = []
  if (i.membreId) morceaux.push(`fiche ${noms.fiche ?? i.membreId}`)
  if (i.numeroMembre !== null) morceaux.push(`membre n° ${i.numeroMembre}`)
  if (i.equipe) morceaux.push(`équipe : ${i.equipe}`)
  if (i.personneId) morceaux.push(`fonds ${noms.personne ?? i.personneId}`)
  return morceaux.length ? morceaux.join(' · ') : null
}
