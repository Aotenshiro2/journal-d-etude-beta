// Regles pures de la page Support du site (/mon-espace/support, Brice
// 18/10/2026, lot 1 « ce que Skool a et que nous n'avons pas »). Aucun import :
// le corps de la requete est relu ici, strictement, avant toute base.

export const ESPACES_SUPPORT = ['live_club', 'academie', 'achat', 'journal', 'extension', 'autre'] as const
export type EspaceSupport = (typeof ESPACES_SUPPORT)[number]

export const LIBELLE_ESPACE: Record<EspaceSupport, string> = {
  live_club: 'Live Club',
  academie: 'Académie',
  achat: 'Un achat',
  journal: "Journal d'études",
  extension: 'Extension (Carnet du Trader)',
  autre: 'Autre chose',
}

export const MAX_MESSAGE_SUPPORT = 1000
export const MAX_CAPTURES_SUPPORT = 3
/** Demandes par compte sur 24 heures glissantes. */
export const MAX_DEMANDES_JOUR = 5
export const BUCKET_CAPTURES = 'support-captures'
/** Prefixe du file_id d'une capture du site dans un message de fil (au lieu d'une reference Telegram). */
export const PREFIXE_STOCKAGE = 'stockage:'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export type DemandeSupport = {
  espace: EspaceSupport
  message: string
  captures: string[]
  paiementId: string | null
}

/**
 * Le corps de la requete, relu pour le compte `userId` (celui du jeton). Une
 * capture n'est acceptee que dans le dossier de ce compte. Chaine = refus.
 */
export function lireDemandeSupport(corps: unknown, userId: string): DemandeSupport | string {
  if (!corps || typeof corps !== 'object') return 'demande'
  const c = corps as Record<string, unknown>
  const espace = typeof c.espace === 'string' && (ESPACES_SUPPORT as readonly string[]).includes(c.espace)
    ? (c.espace as EspaceSupport) : null
  if (!espace) return 'espace'
  const message = typeof c.message === 'string' ? c.message.replace(/\r\n?/g, '\n').trim() : ''
  if (!message || [...message].length > MAX_MESSAGE_SUPPORT) return 'message'
  const brutes = Array.isArray(c.captures) ? c.captures : []
  if (brutes.length > MAX_CAPTURES_SUPPORT) return 'captures'
  const motif = new RegExp(`^${userId.toLowerCase()}/${UUID}\\.(webp|jpg)$`)
  const captures: string[] = []
  for (const x of brutes) {
    if (typeof x !== 'string' || !motif.test(x) || captures.includes(x)) return 'captures'
    captures.push(x)
  }
  let paiementId: string | null = null
  if (c.paiement_id != null && c.paiement_id !== '') {
    if (typeof c.paiement_id !== 'string' || c.paiement_id.length > 120 || !/^[a-z]+:[A-Za-z0-9_-]+$/.test(c.paiement_id)) return 'paiement'
    paiementId = c.paiement_id
  }
  if (paiementId && espace !== 'achat' && espace !== 'live_club') return 'paiement'
  return { espace, message, captures, paiementId }
}

/** Le premier message du fil Support : d'ou vient la demande, puis le texte du membre. */
export function texteDuFil(d: DemandeSupport, achat: string | null): string {
  const tete = `Demande depuis la page Support du site, ${LIBELLE_ESPACE[d.espace]}${achat ? ` (${achat})` : ''}.`
  return `${tete}\n\n${d.message}`
}

/** Le chemin de stockage d'une capture, lu dans le file_id d'un message de fil. null si ce n'en est pas une. */
export function cheminCapture(fileId: string): string | null {
  if (!fileId.startsWith(PREFIXE_STOCKAGE)) return null
  const chemin = fileId.slice(PREFIXE_STOCKAGE.length)
  return new RegExp(`^${UUID}/${UUID}\\.(webp|jpg)$`).test(chemin) ? chemin : null
}
