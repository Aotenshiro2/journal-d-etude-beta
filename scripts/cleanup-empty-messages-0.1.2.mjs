// Nettoyage one-shot 0.1.2 : supprime les blocs texte VIDES (HTML sans texte).
// L'audit du 17/07/2026 en comptait 59. Lecture puis suppression ciblée par id.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const strip = (html) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()

const texts = await prisma.message.findMany({
  where: { type: 'text' },
  select: { id: true, content: true },
})
const emptyIds = texts.filter(m => strip(m.content).length === 0).map(m => m.id)
console.log(`Blocs texte vides trouvés : ${emptyIds.length}`)

if (emptyIds.length > 0) {
  const res = await prisma.message.deleteMany({ where: { id: { in: emptyIds } } })
  console.log(`Supprimés : ${res.count}`)
}

await prisma.$disconnect()
