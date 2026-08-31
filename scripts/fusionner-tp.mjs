/**
 * Fusion des étiquettes `tp` et `TP` de brice.d — demandée le 31/08/2026.
 *
 * ⚠️ SEUL vrai doublon de la base. Les 9 autres repérés par
 * `lister-etiquettes.mjs` appartiennent à des membres DIFFÉRENTS (`Tag` est
 * unique par `(name, userId)`) : les fusionner détruirait la taxonomie de
 * quelqu'un. Ce script ne touche donc QUE les deux étiquettes d'un même membre.
 *
 * On garde `tp` en minuscules — c'est aussi la casse employée par l'autre membre
 * qui a une étiquette `tp`, donc la forme qui rend la comparaison inter-membres
 * possible plus tard.
 *
 * Les liens sont DÉPLACÉS, jamais dupliqués : un lien qui existe déjà sur la
 * cible est simplement abandonné (la clé primaire de `NoteTag`/`MessageTag` est
 * le couple, un insert en double échouerait).
 *
 *   Blanc :    node scripts/fusionner-tp.mjs
 *   Écriture : node scripts/fusionner-tp.mjs --appliquer
 */

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const appliquer = process.argv.includes('--appliquer')

const candidats = await prisma.tag.findMany({
  where: { name: { in: ['tp', 'TP'] } },
  select: {
    id: true, name: true, userId: true,
    notes: { select: { noteId: true } },
    messages: { select: { messageId: true } },
  },
})

// Regrouper par membre : on ne fusionne QUE deux étiquettes du même propriétaire.
const parMembre = new Map()
for (const t of candidats) {
  if (!parMembre.has(t.userId)) parMembre.set(t.userId, [])
  parMembre.get(t.userId).push(t)
}

for (const [userId, tags] of parMembre) {
  if (tags.length < 2) {
    console.log(`${userId.slice(0, 8)}… : une seule étiquette (${tags[0].name}) — rien à fusionner.`)
    continue
  }
  const garde = tags.find(t => t.name === 'tp') ?? tags[0]
  const absorbes = tags.filter(t => t.id !== garde.id)

  for (const a of absorbes) {
    const notesCible = new Set(garde.notes.map(n => n.noteId))
    const blocsCible = new Set(garde.messages.map(m => m.messageId))
    const notesADeplacer = a.notes.filter(n => !notesCible.has(n.noteId)).map(n => n.noteId)
    const blocsADeplacer = a.messages.filter(m => !blocsCible.has(m.messageId)).map(m => m.messageId)
    const notesAbandonnees = a.notes.length - notesADeplacer.length
    const blocsAbandonnes = a.messages.length - blocsADeplacer.length

    console.log(`${userId.slice(0, 8)}… : « ${a.name} » → « ${garde.name} »`)
    console.log(`   ${notesADeplacer.length} lien(s) note et ${blocsADeplacer.length} lien(s) bloc déplacés` +
      (notesAbandonnees + blocsAbandonnes > 0 ? `, ${notesAbandonnees + blocsAbandonnes} déjà présent(s) sur la cible et abandonné(s)` : ''))

    if (!appliquer) continue

    // Transaction : on ne veut pas d'un état où l'étiquette est supprimée mais
    // ses liens n'ont pas été déplacés — ce serait une perte sèche.
    await prisma.$transaction([
      ...notesADeplacer.map(noteId => prisma.noteTag.create({ data: { noteId, tagId: garde.id } })),
      ...blocsADeplacer.map(messageId => prisma.messageTag.create({ data: { messageId, tagId: garde.id } })),
      prisma.tag.delete({ where: { id: a.id } }), // cascade sur ses propres liens
    ])
    console.log(`   ✅ fusionnée et supprimée`)
  }
}

if (!appliquer) console.log('\nBlanc — relancer avec --appliquer pour écrire.')

await prisma.$disconnect()
