// Catalogue des modèles proposés pour l'ÉTUDE, et ce que chaque palier
// débloque (demande Brice, 30/08/2026).
//
// La CAPTURE n'est pas concernée : elle tourne sur Haiku pour tout le monde,
// parce que c'est le bon outil pour extraire et trier, pas un modèle au rabais.
// Il n'y a rien à y choisir.
//
// Le sélecteur a deux fonctions, et la seconde est la plus importante :
//  1. montrer d'un coup d'œil ce que débloque le palier supérieur (les modèles
//     hors palier restent visibles, avec un cadenas) ;
//  2. permettre de DESCENDRE volontairement. C'est ce qui rend le sélecteur
//     honnête plutôt que décoratif : l'écart de qualité entre Opus et Sonnet
//     sur une étude est mince (mesuré au banc du 30/08, chacun a trouvé ce que
//     l'autre a raté), alors que l'écart de COÛT est d'un facteur trois. Un
//     membre du Club qui préfère Sonnet triple le nombre d'études qui tiennent
//     dans son budget. C'est un arbitrage réel, pas une punition.
import type { NiveauIA } from './ia-niveau'

export interface ModeleEtude {
  id: string
  nom: string
  /** ce que le modèle apporte, en une phrase, sans superlatif */
  detail: string
  /** palier minimum qui le débloque */
  requis: Exclude<NiveauIA, 'aucun'>
  /** coût observé d'une étude, en micro-euros — sert à afficher « ≈ N études
   *  restantes ». Relevés au banc du 30/08 ; approximatif par construction,
   *  une page avec capture d'écran coûte plus qu'un article court. */
  coutEtudeMicros: number
}

export const MODELES_ETUDE: ModeleEtude[] = [
  {
    id: 'claude-opus-5',
    nom: 'Opus 5',
    detail: 'Le plus fin sur un graphique : il lit tes niveaux et tes outils, et repère ce qui manque au raisonnement.',
    requis: 'club',
    coutEtudeMicros: 34_000,
  },
  {
    id: 'claude-sonnet-5',
    nom: 'Sonnet 5',
    detail: 'Presque aussi juste sur du texte, trois fois moins cher : trois fois plus d’études dans le même budget.',
    requis: 'premium',
    coutEtudeMicros: 12_000,
  },
  {
    id: 'claude-haiku-4-5',
    nom: 'Haiku 4.5',
    detail: 'Le plus rapide et le plus économique. Fiable pour résumer, moins à l’aise pour lire un graphique.',
    requis: 'premium',
    coutEtudeMicros: 7_000,
  },
]

const RANG: Record<Exclude<NiveauIA, 'aucun'>, number> = { libre: 0, premium: 1, club: 2 }

export function modeleAutorise(id: string, niveau: NiveauIA): boolean {
  if (niveau === 'aucun') return false
  const m = MODELES_ETUDE.find(x => x.id === id)
  return Boolean(m && RANG[niveau] >= RANG[m.requis])
}

/** Le modèle par défaut d'un palier : le meilleur qu'il débloque. */
export function modeleParDefaut(niveau: NiveauIA): string {
  if (niveau === 'aucun') return MODELES_ETUDE[MODELES_ETUDE.length - 1].id
  const debloques = MODELES_ETUDE.filter(m => RANG[niveau] >= RANG[m.requis])
  return (debloques[0] ?? MODELES_ETUDE[MODELES_ETUDE.length - 1]).id
}

/**
 * Le modèle réellement employé : la préférence de l'élève si son palier la
 * couvre, le défaut du palier sinon. Le client PROPOSE, le serveur DISPOSE —
 * une préférence bidouillée ne débloque rien.
 */
export function resoudreModeleEtude(prefere: string | null | undefined, niveau: NiveauIA): string {
  if (prefere && modeleAutorise(prefere, niveau)) return prefere
  return modeleParDefaut(niveau)
}

export interface ModeleAffiche extends Omit<ModeleEtude, 'coutEtudeMicros'> {
  debloque: boolean
  /** ordre de grandeur d'études restantes dans le budget ; null si sans plafond */
  etudesRestantes: number | null
}

/** Le catalogue tel que l'interface doit le montrer, pour un palier et un
 *  reste de budget donnés. */
export function catalogueAffiche(
  niveau: NiveauIA,
  restantMicros: number,
  sansPlafond: boolean
): ModeleAffiche[] {
  return MODELES_ETUDE.map(({ coutEtudeMicros, ...m }) => ({
    ...m,
    debloque: modeleAutorise(m.id, niveau),
    etudesRestantes: sansPlafond || !Number.isFinite(restantMicros)
      ? null
      : Math.max(0, Math.floor(restantMicros / coutEtudeMicros)),
  }))
}
