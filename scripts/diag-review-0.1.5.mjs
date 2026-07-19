// Diagnostic LECTURE SEULE du bug relecture (19/07) : simule les requêtes de /review
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const canvases = await prisma.canvas.findMany({
  where: { type: 'note-study', noteId: { not: null } },
  include: { nodes: { select: { id: true, messageId: true, kind: true } }, note: { select: { id: true, title: true, deletedAt: true } } },
})
const now = Date.now()
const summary = canvases.map(c => ({
  title: c.note?.title?.slice(0, 30) ?? '(note absente)',
  noteDeleted: !!c.note?.deletedAt,
  nodes: c.nodes.length,
  msgNodes: c.nodes.filter(n => n.messageId).length,
  reviewedAt: c.reviewedAt ? 'relue' : null,
  reminder: c.reviewReminderAt ? (new Date(c.reviewReminderAt).getTime() <= now ? 'échu' : 'futur') : null,
}))
console.log('== Canvas note-study ==')
console.table(summary)

const toRelire = canvases.filter(c => c.note && c.nodes.length > 0)
  .filter(c => c.reviewedAt == null || (c.reviewReminderAt != null && new Date(c.reviewReminderAt).getTime() <= now))
console.log('À relire (deck):', toRelire.length)

// Orphelins : nodes dont le message n'existe plus (purge blocs vides / meta ?)
const allMsgIds = [...new Set(canvases.flatMap(c => c.nodes.filter(n => n.messageId).map(n => n.messageId)))]
const existing = new Set((await prisma.message.findMany({ where: { id: { in: allMsgIds } }, select: { id: true } })).map(m => m.id))
const orphans = allMsgIds.filter(id => !existing.has(id))
console.log(`Nodes → messages orphelins : ${orphans.length}/${allMsgIds.length}`)

await prisma.$disconnect()
