// Audit 0.1.2 (lecture seule) : que contiennent réellement les blocs Message ?
// Objectif : distinguer contenu réel vs métadonnées déguisées en blocs (ex. « NQ1 »).
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const strip = (html) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()

const total = await prisma.message.count()
const byType = await prisma.message.groupBy({ by: ['type'], _count: { _all: true } })

// Blocs texte très courts = suspects métadonnées
const texts = await prisma.message.findMany({
  where: { type: 'text' },
  select: { id: true, content: true, order: true, noteId: true },
})
const short = texts.filter(m => strip(m.content).length > 0 && strip(m.content).length <= 12)
const empty = texts.filter(m => strip(m.content).length === 0)

// Fréquence des contenus courts (un même libellé répété = signature de métadonnée)
const freq = new Map()
for (const m of short) {
  const key = strip(m.content)
  freq.set(key, (freq.get(key) ?? 0) + 1)
}
const topShort = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)

// Les blocs courts sont-ils en tête de note (order 0/1) ?
const shortOrder0 = short.filter(m => m.order <= 1).length

console.log(JSON.stringify({
  total,
  byType: byType.map(t => ({ type: t.type, count: t._count._all })),
  textCount: texts.length,
  shortCount: short.length,
  emptyCount: empty.length,
  shortEnTeteDeNote: shortOrder0,
  topShort,
}, null, 2))

await prisma.$disconnect()
