// Regroupement des exécutions en POSITIONS (brief A, 29/10/2026) : fonctions
// PURES, aucune base, aucun import : src/lib/trades-serveur.ts lit et écrit,
// ici on décide. scripts/verifier-imports-trades.mjs les charge telles quelles.
//
// Une exécution = une ligne de TradeImport, un aller-retour déjà apparié par
// la plateforme. Les partiels et les ajouts d'une même idée sortent en
// plusieurs lignes qui se CHEVAUCHENT : même sens, et la suivante entre avant
// que la position en cours ne soit entièrement sortie. Elles forment une
// position, nommée par l'id de sa première exécution. Le membre peut fusionner
// ou séparer à la main (positionManuelle) : ce choix n'est jamais recalculé.

export interface Execution {
  id: string
  compteId: string | null
  symbole: string
  direction: string | null
  devise: string
  entreLe: Date
  sortiLe: Date | null
  quantite: number
  pnl: number
  frais: number | null
  prixEntree: number | null
  prixSortie: number | null
  stopPrix: number | null
  positionId: string | null
  positionManuelle: boolean
  segmentRef: string | null
  fuseau: string | null
}

/** Ce que Pilotage lit : une position agrégée (il calcule lui-même ses ratios). */
export interface VuePosition {
  positionId: string
  compteId: string | null
  symbole: string
  direction: string | null
  devise: string
  entreLe: string
  sortiLe: string | null
  quantite: number
  pnl: number
  frais: number | null
  prixEntree: number | null
  prixSortie: number | null
  stopPrix: number | null
  executions: number
  segmentRef: string | null
  fuseau: string | null
  /** Fusionnée ou séparée à la main : un réimport ne la touche pas. */
  manuelle: boolean
}

type Datee = Pick<Execution, 'id' | 'entreLe'>

/** Par instant d'entrée, puis par id : l'ordre ne dépend jamais de la lecture en base. */
const parEntree = (a: Datee, b: Datee) =>
  a.entreLe.getTime() - b.entreLe.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** La position d'une exécution, y compris celles d'avant le regroupement (positionId vide). */
export const positionDe = (e: Pick<Execution, 'id' | 'positionId'>) => e.positionId ?? e.id

// Les sommes de flottants laissent des traînes (0.1 + 0.2) : on les coupe à 1e-8,
// bien en deçà de ce qu'un prix ou un montant porte.
const arrondi = (x: number) => Math.round(x * 1e8) / 1e8

/**
 * Le regroupement d'UN (compteId, symbole) : id d'exécution -> positionId, pour
 * les exécutions non manuelles seulement. Une exécution rejoint la dernière
 * position de même sens si elle entre avant (ou à l'instant où) celle-ci est
 * entièrement sortie ; sinon elle ouvre une position. Sans heure de sortie,
 * une exécution compte comme sortie à son entrée.
 */
export function regrouperEnPositions(
  executions: Pick<Execution, 'id' | 'direction' | 'entreLe' | 'sortiLe' | 'positionManuelle'>[],
): Map<string, string> {
  const resultat = new Map<string, string>()
  const enCours = new Map<string, { positionId: string; finMax: number }>() // par sens
  for (const e of executions.filter(x => !x.positionManuelle).sort(parEntree)) {
    const sens = e.direction ?? '?'
    const fin = (e.sortiLe ?? e.entreLe).getTime()
    const p = enCours.get(sens)
    if (p && e.entreLe.getTime() <= p.finMax) {
      resultat.set(e.id, p.positionId)
      p.finMax = Math.max(p.finMax, fin)
    } else {
      enCours.set(sens, { positionId: e.id, finMax: fin })
      resultat.set(e.id, e.id)
    }
  }
  return resultat
}

/** Le regroupement de toutes les exécutions données, (compteId, symbole) par (compteId, symbole). */
export function positionsRecalculees(
  executions: Pick<Execution, 'id' | 'compteId' | 'symbole' | 'direction' | 'entreLe' | 'sortiLe' | 'positionManuelle'>[],
): Map<string, string> {
  const paquets = new Map<string, typeof executions>()
  for (const e of executions) {
    const cle = JSON.stringify([e.compteId, e.symbole])
    const p = paquets.get(cle)
    if (p) p.push(e)
    else paquets.set(cle, [e])
  }
  const resultat = new Map<string, string>()
  for (const p of paquets.values()) for (const [id, pos] of regrouperEnPositions(p)) resultat.set(id, pos)
  return resultat
}

/**
 * Un lien au Carnet vaut pour toute la position, et un segment ne se lie qu'à
 * UNE position. L'exécution qui rejoint une position liée hérite du lien ; si
 * deux positions liées se rejoignent, le lien de la plus ancienne exécution
 * l'emporte ; si une position liée se coupe en deux (séparation, exécution
 * retirée), la partie la plus ancienne garde le lien et les autres le perdent.
 * id -> segmentRef (null = délier), pour les exécutions qui changent.
 */
export function liensAHarmoniser(
  executions: Pick<Execution, 'id' | 'entreLe' | 'positionId' | 'segmentRef'>[],
): Map<string, string | null> {
  const groupes = new Map<string, typeof executions>()
  for (const e of executions) {
    const g = groupes.get(positionDe(e))
    if (g) g.push(e)
    else groupes.set(positionDe(e), [e])
  }
  const positions = [...groupes.values()].map(g => {
    const triees = [...g].sort(parEntree)
    return { g, premiere: triees[0], ref: triees.find(e => e.segmentRef)?.segmentRef ?? null }
  }).sort((a, b) => parEntree(a.premiere, b.premiere))

  const pris = new Set<string>()
  const resultat = new Map<string, string | null>()
  for (const p of positions) {
    const ref = p.ref && !pris.has(p.ref) ? p.ref : null
    if (ref) pris.add(ref)
    for (const e of p.g) if ((e.segmentRef ?? null) !== ref) resultat.set(e.id, ref)
  }
  return resultat
}

/** Moyenne pondérée par la quantité, sur les exécutions qui ont ce prix. */
function moyennePonderee(g: Execution[], champ: 'prixEntree' | 'prixSortie'): number | null {
  let somme = 0, poids = 0
  for (const e of g) {
    const prix = e[champ]
    if (prix === null) continue
    somme += prix * e.quantite
    poids += e.quantite
  }
  return poids > 0 ? arrondi(somme / poids) : null
}

/** Les positions agrégées, de la plus récente à la plus ancienne. */
export function vuePositions(executions: Execution[]): VuePosition[] {
  const groupes = new Map<string, Execution[]>()
  for (const e of executions) {
    const g = groupes.get(positionDe(e))
    if (g) g.push(e)
    else groupes.set(positionDe(e), [e])
  }

  const vues: VuePosition[] = []
  for (const [positionId, brut] of groupes) {
    const g = [...brut].sort(parEntree)
    const premiere = g[0]
    const sorties = g.map(e => e.sortiLe?.getTime()).filter((t): t is number => t !== undefined)
    const frais = g.filter(e => e.frais !== null)
    vues.push({
      positionId,
      compteId: premiere.compteId,
      symbole: premiere.symbole,
      direction: premiere.direction,
      devise: premiere.devise,
      entreLe: premiere.entreLe.toISOString(),
      sortiLe: sorties.length > 0 ? new Date(Math.max(...sorties)).toISOString() : null,
      quantite: g.reduce((s, e) => s + e.quantite, 0),
      pnl: arrondi(g.reduce((s, e) => s + e.pnl, 0)),
      frais: frais.length > 0 ? arrondi(frais.reduce((s, e) => s + (e.frais ?? 0), 0)) : null,
      prixEntree: moyennePonderee(g, 'prixEntree'),
      prixSortie: moyennePonderee(g, 'prixSortie'),
      stopPrix: g.find(e => e.stopPrix !== null)?.stopPrix ?? null,
      executions: g.length,
      segmentRef: g.find(e => e.segmentRef)?.segmentRef ?? null,
      fuseau: g.find(e => e.fuseau)?.fuseau ?? null,
      manuelle: g.some(e => e.positionManuelle),
    })
  }
  return vues.sort((a, b) => b.entreLe.localeCompare(a.entreLe) || (a.positionId < b.positionId ? -1 : 1))
}

/** Les totaux d'un compte, pour la fiche de compte de Pilotage (résultats réels). */
export interface TotalCompte {
  compteId: string | null
  n: number
  pnl: number
  frais: number | null
  devise: string
  /** Entrée de la première position. */
  premierLe: string
  /** Entrée de la dernière position. */
  dernierLe: string
}

/**
 * Les totaux par compte, du plus fourni au moins fourni. Un compte en deux
 * monnaies donne deux lignes : on n'additionne pas des dollars et des euros.
 */
export function totauxParCompte(positions: VuePosition[]): TotalCompte[] {
  const totaux = new Map<string, TotalCompte>()
  for (const v of positions) {
    const cle = JSON.stringify([v.compteId, v.devise])
    const t = totaux.get(cle)
    if (!t) {
      totaux.set(cle, { compteId: v.compteId, n: 1, pnl: v.pnl, frais: v.frais, devise: v.devise, premierLe: v.entreLe, dernierLe: v.entreLe })
      continue
    }
    t.n++
    t.pnl += v.pnl
    if (v.frais !== null) t.frais = (t.frais ?? 0) + v.frais
    if (v.entreLe < t.premierLe) t.premierLe = v.entreLe
    if (v.entreLe > t.dernierLe) t.dernierLe = v.entreLe
  }
  return [...totaux.values()]
    .map(t => ({ ...t, pnl: arrondi(t.pnl), frais: t.frais === null ? null : arrondi(t.frais) }))
    .sort((a, b) => b.n - a.n || String(a.compteId).localeCompare(String(b.compteId)) || a.devise.localeCompare(b.devise))
}

/**
 * Fusion à la main : toutes les exécutions des positions choisies, même
 * compte, même symbole, même sens. Rend la position fusionnée (l'id de la
 * première exécution) et son lien au Carnet (celui de la plus ancienne), ou
 * la raison du refus.
 */
export function planFusion(
  executions: Pick<Execution, 'id' | 'compteId' | 'symbole' | 'direction' | 'entreLe' | 'positionId' | 'segmentRef'>[],
): { positionId: string; segmentRef: string | null } | { erreur: string } {
  if (new Set(executions.map(positionDe)).size < 2) return { erreur: 'Il faut au moins deux positions à fusionner.' }
  const premiere = executions[0]
  for (const e of executions) {
    if (e.compteId !== premiere.compteId) return { erreur: 'Ces positions ne sont pas sur le même compte.' }
    if (e.symbole !== premiere.symbole) return { erreur: 'Ces positions ne portent pas sur le même symbole.' }
    if (e.direction !== premiere.direction) return { erreur: 'Ces positions ne sont pas dans le même sens.' }
  }
  const triees = [...executions].sort(parEntree)
  return { positionId: triees[0].id, segmentRef: triees.find(e => e.segmentRef)?.segmentRef ?? null }
}
