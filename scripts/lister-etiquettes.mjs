/**
 * LECTURE SEULE — la liste complète des étiquettes, pour la passe de classement
 * du lot 0 (`Tag.category` est vide sur les 129).
 *
 * Sort une ligne par étiquette avec son usage, afin que le classement se décide
 * sur des faits : une étiquette à 8 liens et une étiquette à 0 ne méritent pas la
 * même attention, et les doublons de casse (« TP » / « tp ») se voient ici.
 */

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const tags = await prisma.tag.findMany({
  select: {
    id: true, name: true, userId: true,
    notes: { select: { noteId: true } },
    messages: { select: { messageId: true } },
  },
})

const lignes = tags
  .map(t => ({ nom: t.name, usage: t.notes.length + t.messages.length, notes: t.notes.length, blocs: t.messages.length, u: t.userId.slice(0, 8) }))
  .sort((a, b) => b.usage - a.usage || a.nom.localeCompare(b.nom))

console.log(`${lignes.length} étiquettes\n`)
console.log('nom | usage | notes | blocs | membre')
for (const l of lignes) console.log(`${l.nom} | ${l.usage} | ${l.notes} | ${l.blocs} | ${l.u}`)

// Doublons de casse / d'espaces : ils se classeront pareil, autant les voir.
const parNorme = new Map()
for (const t of tags) {
  const k = t.name.trim().toLowerCase()
  if (!parNorme.has(k)) parNorme.set(k, [])
  parNorme.get(k).push(t.name)
}
const doublons = [...parNorme.entries()].filter(([, v]) => v.length > 1)
console.log(`\nDoublons à la casse/espace près : ${doublons.length}`)
for (const [k, v] of doublons) console.log(`  ${k} → ${v.join(' / ')}`)

await prisma.$disconnect()
