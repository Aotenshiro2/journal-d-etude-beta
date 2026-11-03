// Reconnaitre un REVENANT par l'ontologie des membres (Brice, 03/11) : regles
// PURES, aucune base. La lecture vit dans reconnaissance.ts.
//
// Le cas : Benoit Richard (fiche f6a1feb5, entre le 16/09/2025 par Skool, un
// abonnement Stripe a 99 EUR annule le 16/08/2026) revient le 03/11 avec un
// NOUVEAU compte Telegram et un nouveau client Stripe. L'accueil ne lisait que
// la ligne du compte Telegram dans cockpit_telegram_membres : jamais vue,
// donc « nouveau », et le bot a poste « vient d'arriver dans le Live Club ».
// Brice : « c'est l'exemple typique du mec qui change de mail ou qui ne se
// reinscrit pas par le meme compte, mais qui devrait etre capte par notre
// travail d'ontologie ».
//
// La regle : une personne est un REVENANT si l'une de ses traces passees est
// trouvee par un identifiant (une adresse rattachee a sa fiche, son client
// Stripe, son compte Telegram, sa fiche elle-meme) :
// - un abonnement plus ancien que l'arrivee (Stripe, PayPal, Skool), hors
//   l'abonnement qui la fait entrer et hors tentative sans paiement ;
// - un paiement plus ancien ;
// - une fiche entree au moins JOURS_FICHE_ANCIENNE jours avant (les fiches
//   ne naissent que de paiements ou de Skool : une fiche ancienne, c'est un
//   ancien membre) ;
// - un AUTRE compte Telegram de la meme fiche, deja vu dans le groupe ;
// - un acces broker ou une exemption plus anciens.
// Rien par un identifiant : le NOM, seulement s'il est sans ambiguite (un
// prenom et un nom, une seule fiche qui le porte). Plusieurs fiches de ce nom
// : 'incertain', le message reste neutre (jamais « bon retour » sur une
// simple homonymie, jamais « vient d'arriver » non plus).

/** Une trace est « ancienne » si elle precede l'arrivee d'au moins ce delai (une tentative de paiement de la veille n'en est pas une). */
export const JOURS_TRACE_ANCIENNE = 2
/** Une fiche entree au moins 30 jours avant l'arrivee : un ancien membre. */
export const JOURS_FICHE_ANCIENNE = 30

export type Reconnaissance = 'nouveau' | 'retour' | 'incertain'

/** Ce qui a fait le verdict (logs et tests), jamais une donnee personnelle. */
export type Indice =
  | 'abonnement' | 'paiement' | 'fiche_ancienne' | 'autre_compte_telegram' | 'acces' | 'nom' | 'nom_ambigu' | 'fiche_recente' | 'rien'

/** Les traces d'une ou plusieurs fiches (comptes, deja filtres sur l'anciennete par la lecture). */
export type Traces = {
  abonnementsAnciens: number
  paiementsAnciens: number
  ficheAncienne: boolean
  autresComptesVus: number
  accesAnciens: number
}

export const AUCUNE_TRACE: Traces = { abonnementsAnciens: 0, paiementsAnciens: 0, ficheAncienne: false, autresComptesVus: 0, accesAnciens: 0 }

export type FaitsReconnaissance = {
  /** Fiches trouvees par un identifiant (rattachement, email, client Stripe, exemption, fiche donnee). */
  fiches: number
  /** Les traces trouvees par ces identifiants (fiches, clients Stripe, emails, compte Telegram). */
  traces: Traces
  /** Rien par un identifiant : les fiches qui portent le meme nom complet (cleNom), et leurs traces si une seule. */
  homonymes?: { fiches: number; traces: Traces } | null
}

/** Le premier indice d'un passe de membre dans des traces, ou null. */
export function indicePasse(t: Traces): Indice | null {
  if (t.abonnementsAnciens > 0) return 'abonnement'
  if (t.paiementsAnciens > 0) return 'paiement'
  if (t.ficheAncienne) return 'fiche_ancienne'
  if (t.autresComptesVus > 0) return 'autre_compte_telegram'
  if (t.accesAnciens > 0) return 'acces'
  return null
}

/** Le verdict, et ce qui l'a fait. */
export function reconnaitre(f: FaitsReconnaissance): { verdict: Reconnaissance; indice: Indice } {
  const parIdentifiant = indicePasse(f.traces)
  if (parIdentifiant) return { verdict: 'retour', indice: parIdentifiant }
  if (f.fiches > 0) return { verdict: 'nouveau', indice: 'fiche_recente' }
  const h = f.homonymes
  if (h && h.fiches > 1) return { verdict: 'incertain', indice: 'nom_ambigu' }
  if (h && h.fiches === 1 && indicePasse(h.traces)) return { verdict: 'retour', indice: 'nom' }
  return { verdict: 'nouveau', indice: 'rien' }
}

/**
 * La cle de comparaison d'un nom complet : sans accents ni casse, mots tries
 * (« RICHARD Benoît » et « Benoit Richard » donnent la meme cle). null si le
 * nom n'a pas au moins deux mots de deux lettres : un prenom seul, un pseudo
 * ou une initiale ne suffisent jamais a reconnaitre quelqu'un.
 */
export function cleNom(nom: string | null | undefined): string | null {
  if (typeof nom !== 'string') return null
  const mots = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z]+/).filter(m => m.length >= 2)
  if (mots.length < 2) return null
  return [...new Set(mots)].sort().join(' ')
}
