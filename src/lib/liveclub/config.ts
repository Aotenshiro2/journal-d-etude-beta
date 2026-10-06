// Configuration du Live Club (29/09) : ce que le bot, la page de bienvenue,
// le passage quotidien et l'agent du cockpit lisent tous au meme endroit.
// Module PUR, sans import : scripts/verifier-liveclub.mjs le charge tel quel.
//
// Les deux produits Stripe sont LA MEME offre (compte melanie). Ils vivent
// dans le code SERVEUR du journal, jamais dans le navigateur.

export const PRODUITS_LIVECLUB = ['prod_UcOraPncQlbrW4', 'prod_UynMpOvBtGTsIw'] as const

/**
 * Les DEUX portes d'abonnement (Brice, 29/09) : tout message « abonne-toi »
 * propose les deux. Meme offre, meme compte Stripe (melanie).
 */
export const URLS_ABONNEMENT = ['https://aoknowledge.com/live-club', 'https://melaniechart.com'] as const
/** Premiere porte seule, gardee pour les appelants d'avant le 29/09. Preferer texteAbonnement(). */
export const URL_ABONNEMENT = URLS_ABONNEMENT[0]
/** Portail client Stripe du compte melanie : le membre y met sa carte a jour (connexion par son email). */
export const URL_PORTAIL_CARTE = 'https://billing.stripe.com/p/login/bJecN48kK4Vc4vr70Sbsc00'
export const SUPPORT = 'support@aoknowledge.com'

/**
 * La phrase « abonne-toi », avec les deux adresses, reprise partout (bot,
 * agent, emails). Pas de ponctuation apres la derniere adresse : Telegram et
 * les clients mail l'avaleraient dans le lien.
 */
export function texteAbonnement(): string {
  return `Pour t'abonner, c'est au choix sur ${URLS_ABONNEMENT[0]} ou sur ${URLS_ABONNEMENT[1]}`
}

/**
 * L'argument de la pause face a un arret (Brice, 30/09) : un nouvel
 * abonnement se prend au prix du moment, la pause garde le tarif actuel.
 * Une phrase, au tutoiement : reprise telle quelle par le bot (boutons), par
 * l'agent (prompt-membre.ts) et par le texte ci-dessous.
 */
export const ARGUMENT_TARIF_PAUSE = `Si le prix augmente entre-temps, un nouvel abonnement pris plus tard se fera au prix du moment, sans garantie de retrouver ton tarif actuel. La pause, elle, garde ton abonnement, donc ton tarif.`

/**
 * La proposition de pause faite UNE fois avant l'arret (Brice, 30/09), par le
 * bouton « Arreter » comme par l'agent : envoyee avec clavierPauseAvantArret()
 * (actions-membre.ts). Elle contient « pause » et « tarif » : c'est ce que
 * pauseDejaProposee() (pur.ts) reconnait dans l'historique.
 */
export const TEXTE_PAUSE_AVANT_ARRET = `Avant d'arrêter : si c'est pour un temps, quelle qu'en soit la raison, tu peux plutôt te mettre en pause, de 1 à 6 mois. Elle démarre à la fin de ta période déjà payée.\n\n`
  + `${ARGUMENT_TARIF_PAUSE}\n\n`
  + `Tu préfères une pause, ou tu arrêtes quand même ?`

/**
 * La raison d'une sortie du groupe (Brice, 06/10), donnee UNE fois par sortie
 * a un compte Telegram non rattache qui ecrit au bot dans les 60 jours
 * (sortieAExpliquer, pur.ts). L'equipe a sorti, sans ban, des comptes relies
 * a aucun abonnement, sans pouvoir les prevenir : ni email, et un bot ne peut
 * pas ecrire le premier. Le texte enchaine sur la verification par code
 * (« envoie-moi l'email ») : il remplace TEXTE_NON_RATTACHE la ou il est dit.
 */
export function texteRaisonSortie(): string {
  return `Tu as été sorti du groupe Live Club parce qu'on n'a pas pu relier ton compte Telegram à un abonnement actif : `
    + `soit l'email de ton paiement n'est pas renseigné chez nous, soit ton abonnement est impayé ou terminé.\n\n`
    + `Tu as un abonnement ? Envoie-moi ici l'email utilisé pour le paiement : je t'envoie un code à 6 chiffres, `
    + `et dès que c'est vérifié, je te redonne l'accès au groupe.\n\n`
    + `Pas d'abonnement en cours ? ${texteAbonnement()}`
}

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

/** Lien vers le bot, sans jeton : pour « ecris au bot » dans un email. */
export function lienBotAccueil(): string {
  return `https://t.me/${nomBot()}`
}

/**
 * Un maitre par geste : tant que Metricgram tourne, le passage quotidien
 * SIMULE la sortie des desabonnes. '1' seulement pour agir pour de vrai.
 */
export function sortiesActives(): boolean {
  return process.env.LIVECLUB_SORTIES_ACTIVES?.trim() === '1'
}

/**
 * Interrupteur SEPARE de la sortie des impayes a 5 jours (Brice, 30/09) :
 * Metricgram ne sort pas un abonnement past_due (il n'agit qu'une fois
 * l'abonnement non actif, apres environ 14 jours de relances et 7 jours de
 * grace), donc ce geste peut s'activer avant la bascule sans conflit.
 * LIVECLUB_SORTIES_IMPAYES === '1', ou la bascule complete. Il ne commande
 * QUE la sortie reelle des impayes et son message : la fenetre de 30 jours,
 * le rattrapage des emails de bienvenue et les desabonnes restent sous
 * sortiesActives(). Sans lui, la sortie est SIMULEE (regle 'impaye_5j').
 */
export function sortiesImpayesActives(): boolean {
  return process.env.LIVECLUB_SORTIES_IMPAYES?.trim() === '1' || sortiesActives()
}

/**
 * Plafond de resiliations REELLES par passage (fenetre de 30 jours) : un
 * garde-fou si une lecture fausse faisait croire a une serie d'impayes.
 */
export const PLAFOND_RESILIATIONS_PASSAGE = 10

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
