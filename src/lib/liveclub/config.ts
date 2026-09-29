// Configuration du Live Club (29/09) : ce que le bot, la page de bienvenue,
// le passage quotidien et l'agent du cockpit lisent tous au meme endroit.
//
// Les deux produits Stripe sont LA MEME offre (compte melanie). Ils vivent
// dans le code SERVEUR du journal, jamais dans le navigateur.

export const PRODUITS_LIVECLUB = ['prod_UcOraPncQlbrW4', 'prod_UynMpOvBtGTsIw'] as const

export const URL_ABONNEMENT = 'https://aoknowledge.com/live-club'
export const SUPPORT = 'support@aoknowledge.com'

/** Jours de grace apres la fin d'un abonnement, comme Metricgram. */
export const GRACE_JOURS = 7
/** Plafond de sorties REELLES par passage quotidien. */
export const PLAFOND_SORTIES_PASSAGE = 20
/** Plafond de messages IA par membre et par jour. */
export const PLAFOND_MESSAGES_IA_JOUR = 30
/** Duree d'un acces broker (RaiseFx), non renouvelable. */
export const MOIS_ACCES_BROKER = 6

export function estProduitLiveClub(produit: string | null | undefined): boolean {
  return Boolean(produit && (PRODUITS_LIVECLUB as readonly string[]).includes(produit))
}

/** chat_id du groupe (TELEGRAM_LIVECLUB_CHAT_ID), null s'il manque ou est illisible. */
export function chatId(): number | null {
  const brut = process.env.TELEGRAM_LIVECLUB_CHAT_ID?.trim()
  if (!brut) return null
  const n = Number(brut)
  return Number.isSafeInteger(n) ? n : null
}

export function nomBot(): string {
  return (process.env.TELEGRAM_LIVECLUB_BOT_USERNAME?.trim() || 'aok_liveclub_bot').replace(/^@/, '')
}

/** Lien personnel vers le bot : t.me/<bot>?start=<jeton> (jeton de 24 caracteres). */
export function lienBot(jeton: string): string {
  return `https://t.me/${nomBot()}?start=${encodeURIComponent(jeton)}`
}

/**
 * Un maitre par geste : tant que Metricgram tourne, le passage quotidien
 * SIMULE la sortie des desabonnes. '1' seulement pour agir pour de vrai.
 */
export function sortiesActives(): boolean {
  return process.env.LIVECLUB_SORTIES_ACTIVES?.trim() === '1'
}

/** Cle Stripe de LECTURE du compte melanie (repli sur la cle d'ecriture). */
export function cleStripeLecture(): string | null {
  return process.env.STRIPE_READ_KEY_MELANIE?.trim()
    || process.env.STRIPE_AGENT_KEY_MELANIE?.trim()
    || null
}

/** Cle Stripe d'ECRITURE du compte melanie (pause, arret). */
export function cleStripeEcriture(): string | null {
  return process.env.STRIPE_AGENT_KEY_MELANIE?.trim() || null
}
