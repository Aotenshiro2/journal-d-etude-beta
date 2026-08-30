// Grille de prix des modèles Anthropic, et calcul du coût d'un appel.
//
// Pourquoi une grille en dur plutôt qu'un appel à une API de tarifs : le coût
// doit être calculé AU MOMENT de l'appel et STOCKÉ sur la ligne AiUsage. Si on
// recalculait l'historique avec la grille du jour, un changement de tarif ou un
// changement de modèle réécrirait rétroactivement la consommation des membres
// et les budgets se mettraient à mentir.
//
// Tarifs Anthropic en USD par million de jetons, relevés le 30/08/2026.
// Les jetons de cache ne sont PAS inclus dans input_tokens : l'API les renvoie
// dans deux champs séparés. Les oublier, c'est sous-compter sa propre dépense
// (ce que faisait logAiUsage jusqu'ici).

export interface PrixModele {
  /** entrée standard */
  in: number
  /** sortie (jetons de réflexion inclus) */
  out: number
  /** écriture de cache — 1,25x l'entrée */
  cacheWrite: number
  /** lecture de cache — 0,1x l'entrée */
  cacheRead: number
}

const USD_PAR_MTOK: Record<string, PrixModele> = {
  'claude-opus-5': { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-sonnet-5': { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  // Modèles encore susceptibles d'être posés par une variable d'env
  'claude-opus-4-8': { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-sonnet-4-6': { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 },
}

/** Modèle inconnu : on facture au tarif le plus cher connu plutôt que zéro.
 *  Un budget qui ignore un modèle non répertorié est un budget contournable. */
const PRIX_PAR_DEFAUT: PrixModele = { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 }

/** Taux de conversion. Les budgets sont posés en euros parce que c'est la
 *  devise dans laquelle Brice raisonne ; les tarifs Anthropic sont en dollars. */
export const USD_VERS_EUR = 0.92

export interface JetonsUtilises {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/**
 * Coût d'un appel en MICRO-euros (millionièmes d'euro), en entier.
 * Les centimes sont trop gros : une capture Haiku coûte 0,4 centime, donc
 * arrondir au centime revient à facturer zéro ou le double.
 */
export function coutMicroEuros(modele: string, usage: JetonsUtilises): number {
  const p = USD_PAR_MTOK[modele] ?? PRIX_PAR_DEFAUT
  const usd =
    ((usage.input_tokens ?? 0) * p.in +
      (usage.output_tokens ?? 0) * p.out +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead) /
    1_000_000
  return Math.round(usd * USD_VERS_EUR * 1_000_000)
}

/** Un modèle est-il dans la grille ? Sert aux garde-fous de démarrage. */
export function modeleConnu(modele: string): boolean {
  return modele in USD_PAR_MTOK
}

/** Rendu lisible d'un montant en micro-euros : « 1,40 € », « 0,004 € ». */
export function formaterEuros(micros: number): string {
  const euros = micros / 1_000_000
  const decimales = euros >= 0.1 ? 2 : euros >= 0.001 ? 3 : 4
  return `${euros.toFixed(decimales).replace('.', ',')} €`
}
