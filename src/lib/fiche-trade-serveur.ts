// Côté serveur du lien vers la fiche d'un trade (brief J2, 05/11/2026) : quels
// trades du Carnet une position du broker porte, pour faire du badge « Trade N »
// un lien. Lecture seule, bornée au userId.

import { prisma } from '@/lib/db'

/** Parmi ces trades du Carnet (segmentRef), ceux qu'au moins une exécution du membre porte. */
export async function segmentsLiesAuBroker(userId: string, segmentRefs: string[]): Promise<Set<string>> {
  const refs = [...new Set(segmentRefs.filter(r => typeof r === 'string' && r))]
  if (refs.length === 0) return new Set()
  const lignes = await prisma.tradeImport.findMany({
    where: { userId, segmentRef: { in: refs } },
    select: { segmentRef: true },
    distinct: ['segmentRef'],
  })
  return new Set(lignes.map(l => l.segmentRef).filter((r): r is string => r !== null))
}
