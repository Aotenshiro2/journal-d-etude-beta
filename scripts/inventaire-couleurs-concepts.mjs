/**
 * LECTURE SEULE — de quelle couleur sont les concepts, en vrai ?
 *
 * La variante C fait porter au trait d'appartenance la couleur du concept
 * qu'il touche (`Tag.color`). Ça ne tient que si les concepts ont des couleurs
 * DIFFÉRENTES. Si la plupart gardent le défaut du schéma (#3b82f6, le même bleu
 * que le trait d'association), alors « la couleur dit le type » est vrai dans
 * le labo et faux à l'écran : tous les traits redeviennent bleus.
 */

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const tags = await prisma.tag.findMany({ select: { name: true, color: true, category: true } })
const parCouleur = new Map()
for (const t of tags) parCouleur.set(t.color, (parCouleur.get(t.color) ?? 0) + 1)

console.log(`\nConcepts (Tag) en base : ${tags.length}`)
console.table(
  [...parCouleur.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([couleur, n]) => ({
      couleur,
      concepts: n,
      'défaut du schéma ?': couleur === '#3b82f6' ? 'OUI — même bleu que le trait actuel' : '',
    })),
)
console.log('\nDétail :')
console.table(tags.map(t => ({ concept: t.name, couleur: t.color, catégorie: t.category ?? '—' })))

await prisma.$disconnect()
