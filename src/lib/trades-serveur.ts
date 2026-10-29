// Les trades importés côté base (brief A, 29/10/2026) : insertion, regroupement
// en positions, rapprochement avec le Carnet, suppression ; le jugement du
// Carnet sur les positions (brief A2, 30/10/2026). Les décisions sont dans les
// modules purs (positions.ts, correspondances-carnet.ts, carnet-sur-positions.ts) ;
// ici on lit et on écrit, TOUJOURS borné au userId du jeton. La table est
// fermée (RLS + revoke, 30/09) : le journal y accède en postgres.
//
// Utilisé par /api/pilotage/trades/... (Pilotage) et /api/imports-trades
// (l'écran du journal) : un import se regroupe et se rapproche pareil des deux côtés.

import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { TradeNormalise } from '@/lib/imports-trades'
import { liensAHarmoniser, positionDe, positionsRecalculees, vuePositions, type Execution, type VuePosition } from '@/lib/positions'
import { proposerLiens, segmentsDesNotes, type SegmentCarnet } from '@/lib/correspondances-carnet'
import { ajouterCarnet, compterSegmentsNonLies, type PeriodeCarnet } from '@/lib/carnet-sur-positions'

const CHAMPS_EXECUTION = {
  id: true, compteId: true, symbole: true, direction: true, devise: true, entreLe: true, sortiLe: true,
  quantite: true, pnl: true, frais: true, prixEntree: true, prixSortie: true, stopPrix: true,
  positionId: true, positionManuelle: true, segmentRef: true, fuseau: true,
} satisfies Prisma.TradeImportSelect

/** Les exécutions d'un membre, filtrées si besoin. Le userId passe après le filtre : il ne se contourne pas. */
export function executionsDuMembre(userId: string, filtre: Prisma.TradeImportWhereInput = {}): Promise<Execution[]> {
  return prisma.tradeImport.findMany({ where: { ...filtre, userId }, select: CHAMPS_EXECUTION })
}

/** Les exécutions d'une position, y compris l'exécution seule importée avant le regroupement (positionId vide). */
export const dansLesPositions = (ids: string[]): Prisma.TradeImportWhereInput => ({
  OR: [{ positionId: { in: ids } }, { id: { in: ids }, positionId: null }],
})

/** Les segments du Carnet du membre (notes non supprimées). */
export async function segmentsDuMembre(userId: string): Promise<SegmentCarnet[]> {
  const notes = await prisma.note.findMany({ where: { userId, deletedAt: null }, select: { id: true, title: true, trades: true } })
  return segmentsDesNotes(notes)
}

/**
 * Le Carnet sur les positions rendues à Pilotage (brief A2, 30/10/2026) :
 * chaque position gagne `carnet` (dernier jugement, émotion au départ,
 * cooldown du segment lié, null sans segment), et on compte les segments de
 * la période qu'aucune position ne porte. Une requête Annotation, une lecture
 * des notes du membre (non supprimées, comme segmentsDuMembre), le calcul dans
 * carnet-sur-positions.ts. Borné au userId : un segmentRef ne lit jamais les
 * jugements ni les notes d'un autre membre.
 * @param executions TOUTES les exécutions du membre : un segment lié à une
 *   position hors de la période (ou d'un autre compte) reste lié.
 */
export async function positionsAvecCarnet<P extends VuePosition>(
  userId: string,
  positions: P[],
  executions: Pick<Execution, 'segmentRef'>[],
  periode: PeriodeCarnet,
) {
  const refs = [...new Set(positions.map(p => p.segmentRef).filter((r): r is string => r !== null))]
  const [notes, jugements] = await Promise.all([
    prisma.note.findMany({ where: { userId, deletedAt: null }, select: { id: true, title: true, trades: true, warmups: true } }),
    refs.length === 0 ? [] : prisma.annotation.findMany({
      where: { userId, tradeRef: { in: refs } },
      orderBy: { createdAt: 'asc' },
      select: { tradeRef: true, grade: true, causeCategory: true, phrase: true, createdAt: true },
    }),
  ])
  return {
    positions: ajouterCarnet(positions, notes, jugements),
    segmentsNonLies: compterSegmentsNonLies(notes, executions.map(e => e.segmentRef), periode),
  }
}

interface Changements { positions: Map<string, string>; liens: Map<string, string | null> }

/**
 * Regroupe en mémoire (les exécutions sont mises à jour sur place) et rend ce
 * qu'il faudra écrire pour celles déjà en base. Une exécution seule dont le
 * positionId est vide est déjà « sa propre position » : rien à écrire.
 */
function regrouperEnMemoire(executions: Execution[], pasEnBase: Set<string>): Changements {
  const parId = new Map(executions.map(e => [e.id, e]))
  const cible = positionsRecalculees(executions)
  const positions = new Map<string, string>()
  for (const e of executions) {
    const p = cible.get(e.id)
    if (p === undefined || positionDe(e) === p) continue
    e.positionId = p
    if (!pasEnBase.has(e.id)) positions.set(e.id, p)
  }
  const liens = new Map<string, string | null>()
  for (const [id, ref] of liensAHarmoniser(executions)) {
    parId.get(id)!.segmentRef = ref
    if (!pasEnBase.has(id)) liens.set(id, ref)
  }
  return { positions, liens }
}

/** Un updateMany par valeur cible : peu de requêtes, même pour beaucoup d'exécutions. */
function ecrituresDesChangements(userId: string, { positions, liens }: Changements): Prisma.PrismaPromise<unknown>[] {
  const ecritures: Prisma.PrismaPromise<unknown>[] = []
  const parValeur = <V,>(changements: Map<string, V>) => {
    const groupes = new Map<V, string[]>()
    for (const [id, valeur] of changements) {
      const ids = groupes.get(valeur)
      if (ids) ids.push(id)
      else groupes.set(valeur, [id])
    }
    return groupes
  }
  for (const [positionId, ids] of parValeur(positions)) {
    ecritures.push(prisma.tradeImport.updateMany({ where: { userId, id: { in: ids } }, data: { positionId } }))
  }
  for (const [segmentRef, ids] of parValeur(liens)) {
    ecritures.push(prisma.tradeImport.updateMany({ where: { userId, id: { in: ids } }, data: { segmentRef } }))
  }
  return ecritures
}

/** Recalcule les positions des (compteId, symbole) donnés et écrit ce qui change. Rend leurs exécutions à jour. */
export async function recalculerPositions(userId: string, paires: { compteId: string | null; symbole: string }[]): Promise<Execution[]> {
  if (paires.length === 0) return []
  const executions = await executionsDuMembre(userId, { OR: paires.map(p => ({ compteId: p.compteId, symbole: p.symbole })) })
  const ecritures = ecrituresDesChangements(userId, regrouperEnMemoire(executions, new Set()))
  if (ecritures.length > 0) await prisma.$transaction(ecritures)
  return executions
}

/**
 * Insère des exécutions NOUVELLES (déjà dédoublonnées par l'appelant) et les
 * regroupe avec celles du même (compteId, symbole). Les ids sont tirés ici :
 * le regroupement se calcule avant l'écriture, et une exécution neuve naît
 * avec sa position. L'insertion (createMany + skipDuplicates sur (userId,
 * source, idExterne)) et la réécriture des exécutions déjà en base qui
 * changent de position partent dans UNE transaction : tout ou rien.
 */
async function insererExecutions(userId: string, compteId: string | null, trades: TradeNormalise[], fichier: string | null) {
  const symboles = [...new Set(trades.map(t => t.symbole))]
  const existantes = await executionsDuMembre(userId, { compteId, symbole: { in: symboles } })
  const neuves: Execution[] = trades.map(t => ({
    id: randomUUID(), compteId, symbole: t.symbole, direction: t.direction, devise: t.devise,
    entreLe: t.entreLe, sortiLe: t.sortiLe, quantite: t.quantite, pnl: t.pnl, frais: t.frais,
    prixEntree: t.prixEntree, prixSortie: t.prixSortie, stopPrix: t.stopPrix ?? null,
    positionId: null, positionManuelle: false, segmentRef: null, fuseau: t.fuseau ?? null,
  }))
  const idsNeufs = new Set(neuves.map(e => e.id))
  const toutes = [...existantes, ...neuves]
  const changements = regrouperEnMemoire(toutes, idsNeufs)

  const [res] = await prisma.$transaction([
    prisma.tradeImport.createMany({
      data: neuves.map((e, i) => ({
        ...trades[i], id: e.id, userId, fichier, compteId, positionId: positionDe(e), segmentRef: e.segmentRef,
      })),
      skipDuplicates: true,
    }),
    ...ecrituresDesChangements(userId, changements),
  ])

  if (res.count < neuves.length) {
    // Une partie est arrivée entre-temps (le même fichier importé deux fois
    // en même temps) : on regroupe ce qui est vraiment en base.
    const executions = await recalculerPositions(userId, symboles.map(symbole => ({ compteId, symbole })))
    const presents = new Set(executions.map(e => e.id))
    return { importes: res.count, executions, idsNeufs: new Set([...idsNeufs].filter(id => presents.has(id))) }
  }
  return { importes: res.count, executions: toutes, idsNeufs }
}

/**
 * Rapproche du Carnet des positions encore sans lien : un seul candidat libre
 * = lié tout de suite (sur toutes les exécutions de la position), sinon les
 * candidats sont rendus pour que l'écran choisisse. `positions` est mis à jour.
 */
async function rapprocherDuCarnet(userId: string, positions: VuePosition[]) {
  const sansLien = positions.filter(p => !p.segmentRef)
  if (sansLien.length === 0) return { correspondances: [], liees: 0 }
  const [segments, lies] = await Promise.all([
    segmentsDuMembre(userId),
    prisma.tradeImport.findMany({ where: { userId, segmentRef: { not: null } }, distinct: ['segmentRef'], select: { segmentRef: true } }),
  ])
  const { liens, correspondances } = proposerLiens(sansLien, segments, lies.map(l => l.segmentRef!))
  if (liens.length > 0) {
    await prisma.$transaction(liens.map(l => prisma.tradeImport.updateMany({
      where: { userId, ...dansLesPositions([l.positionId]) },
      data: { segmentRef: l.segmentRef },
    })))
    for (const l of liens) {
      const p = positions.find(x => x.positionId === l.positionId)
      if (p) p.segmentRef = l.segmentRef
    }
  }
  return { correspondances, liees: liens.length }
}

/**
 * L'import confirmé : insertion des nouvelles exécutions, regroupement des
 * (compteId, symbole) touchés, rapprochement des positions touchées avec le
 * Carnet. Rend les positions touchées (vue agrégée).
 */
export async function confirmerImport(userId: string, compteId: string | null, nouveaux: TradeNormalise[], fichier: string | null) {
  if (nouveaux.length === 0) return { importes: 0, positions: [] as VuePosition[], correspondances: [], liees: 0 }
  const { importes, executions, idsNeufs } = await insererExecutions(userId, compteId, nouveaux, fichier)
  const touchees = new Set(executions.filter(e => idsNeufs.has(e.id)).map(positionDe))
  const positions = vuePositions(executions.filter(e => touchees.has(positionDe(e))))
  const { correspondances, liees } = await rapprocherDuCarnet(userId, positions)
  return { importes, positions, correspondances, liees }
}

/** Retire des exécutions du membre (fausse manip, fichier de test), puis regroupe ce qui reste à côté. */
export async function supprimerExecutions(userId: string, filtre: { compteId?: string | null; source?: string | null }) {
  const where: Prisma.TradeImportWhereInput = {
    userId,
    ...(filtre.compteId ? { compteId: filtre.compteId } : {}),
    ...(filtre.source ? { source: filtre.source } : {}),
  }
  const paires = await prisma.tradeImport.groupBy({ by: ['compteId', 'symbole'], where })
  const r = await prisma.tradeImport.deleteMany({ where })
  await recalculerPositions(userId, paires)
  return r.count
}
