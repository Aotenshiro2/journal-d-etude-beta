/**
 * LECTURE SEULE — les 128 étiquettes viennent de QUI ?
 *
 * Question de Brice (31/08) : le classement de la taxonomie est-il basé sur lui
 * seul, ou sur tous les membres qui ont essayé de s'en servir ? L'inventaire
 * précédent ne filtrait aucun utilisateur, mais compter toute la base ne dit pas
 * si elle est l'œuvre d'une personne. Si 95 % des étiquettes sont les siennes,
 * les catégories qu'on va poser sont les SIENNES — ce qui reste utile, mais doit
 * être dit, parce que d'autres catégories émergeront avec les élèves.
 *
 * Ventile donc tout par membre, et nomme les membres (le journal n'a pas de
 * modèle User : l'identité vit dans `auth.users` / `profiles`, même base).
 */

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const tags = await prisma.tag.groupBy({ by: ['userId'], _count: { _all: true } })
const notes = await prisma.note.groupBy({ by: ['userId'], _count: { _all: true } })
const annos = await prisma.annotation.groupBy({ by: ['userId'], _count: { _all: true } })

// Liens et blocs par membre : on passe par la note, seule porteuse de userId.
const notesParUser = await prisma.note.findMany({ select: { id: true, userId: true } })
const userParNote = new Map(notesParUser.map(n => [n.id, n.userId]))

const messageTags = await prisma.messageTag.findMany({ select: { message: { select: { noteId: true, type: true } } } })
const noteTags = await prisma.noteTag.findMany({ select: { noteId: true } })

const compteur = (m, k) => m.set(k, (m.get(k) ?? 0) + 1)
const liensBloc = new Map(), liensImage = new Map(), liensNote = new Map()
for (const mt of messageTags) {
  const u = userParNote.get(mt.message.noteId)
  if (!u) continue
  compteur(liensBloc, u)
  if (mt.message.type === 'image' || mt.message.type === 'screenshot') compteur(liensImage, u)
}
for (const nt of noteTags) {
  const u = userParNote.get(nt.noteId)
  if (u) compteur(liensNote, u)
}

// Noms : on tente `profiles`, puis `auth.users`. Aucune écriture.
let identites = new Map()
try {
  const rows = await prisma.$queryRawUnsafe(
    `select u.id::text as id, u.email, coalesce(p.name, '') as nom
       from auth.users u left join public.profiles p on p.id = u.id`,
  )
  identites = new Map(rows.map(r => [r.id, r.nom?.trim() ? `${r.nom} <${r.email}>` : r.email]))
} catch (e) {
  console.log(`(identités non résolues : ${e.message.split('\n')[0]})`)
}

const users = new Set([
  ...tags.map(t => t.userId), ...notes.map(n => n.userId), ...annos.map(a => a.userId),
  ...liensBloc.keys(), ...liensNote.keys(),
])

const lignes = [...users].map(u => ({
  membre: identites.get(u) ?? u.slice(0, 8) + '…',
  étiquettes: tags.find(t => t.userId === u)?._count._all ?? 0,
  notes: notes.find(n => n.userId === u)?._count._all ?? 0,
  'liens note': liensNote.get(u) ?? 0,
  'liens bloc': liensBloc.get(u) ?? 0,
  'dont captures': liensImage.get(u) ?? 0,
  notations: annos.find(a => a.userId === u)?._count._all ?? 0,
}))
lignes.sort((a, b) => (b.étiquettes + b['liens bloc'] + b['liens note']) - (a.étiquettes + a['liens bloc'] + a['liens note']))

console.log('\n═══ QUI A PRODUIT LA MATIÈRE ? ═══')
console.table(lignes)

const total = lignes.reduce((n, l) => n + l.étiquettes, 0)
const premier = lignes[0]
if (premier && total) {
  console.log(`\nLe premier contributeur porte ${premier.étiquettes}/${total} étiquettes, soit ${Math.round((premier.étiquettes / total) * 100)} %.`)
  console.log(`Membres ayant posé au moins UNE étiquette : ${lignes.filter(l => l.étiquettes > 0).length}`)
  console.log(`Membres ayant posé au moins UN lien (note ou bloc) : ${lignes.filter(l => l['liens bloc'] + l['liens note'] > 0).length}`)
  console.log(`Membres ayant posé au moins UNE notation : ${lignes.filter(l => l.notations > 0).length}`)
}

await prisma.$disconnect()
