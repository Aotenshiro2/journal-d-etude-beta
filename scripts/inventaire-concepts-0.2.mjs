/**
 * Inventaire LECTURE SEULE — de quoi la page concept peut-elle être faite ? (0.2)
 *
 * Brice veut un écran où un élève étudie UN concept : toutes ses notes, tous ses
 * screenshots de séance, et des stats sur le résultat d'usage du concept et sa
 * notation. Avant de dessiner, trois questions, et les réponses sont en base :
 *
 *   1. LES LIENS EXISTENT-ILS ? La page vit de `MessageTag` (bloc ↔ concept) et
 *      `NoteTag` (note ↔ concept). Si ces tables sont quasi vides, l'écran naîtra
 *      vide quoi qu'on dessine — et le vrai chantier est alors de PRODUIRE les
 *      liens, pas de les afficher.
 *
 *   2. LA CHAÎNE VERS LE RÉSULTAT TIENT-ELLE ? `Note.trades` est du JSON, pas une
 *      table : concept → MessageTag → Message.tradeRef → segment dans le JSON →
 *      outcome. Chaque maillon peut être absent. On compte combien de fois la
 *      chaîne va jusqu'au bout.
 *
 *   3. OÙ SONT LES SCREENSHOTS ? On mesure `Message.type` et la présence d'images
 *      dans le contenu, au lieu de supposer.
 *
 * Précédent qui justifie de mesurer : le 31/08, `Tag.color` semblait porter la
 * couleur des concepts. Les 126 valaient le même bleu par défaut, et la variante
 * de rendu qu'on allait coder rendait exactement le témoin.
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/inventaire-concepts-0.2.mjs
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
const messages = await prisma.message.findMany({
  select: { id: true, noteId: true, type: true, tradeRef: true, content: true },
})
const notes = await prisma.note.findMany({
  select: { id: true, title: true, userId: true, trades: true, concepts: true, deletedAt: true },
})
const annotations = await prisma.annotation.findMany({
  select: { id: true, noteId: true, messageRef: true, tradeRef: true, grade: true, causeCategory: true },
})

console.log('\n═══ 1. LES LIENS — la matière première de la page ═══')
const avecNote = tags.filter(t => t.notes.length > 0).length
const avecBloc = tags.filter(t => t.messages.length > 0).length
console.table([{
  'concepts (Tag)': tags.length,
  'liens note↔concept (NoteTag)': tags.reduce((n, t) => n + t.notes.length, 0),
  'liens bloc↔concept (MessageTag)': tags.reduce((n, t) => n + t.messages.length, 0),
  'concepts ayant ≥1 note': avecNote,
  'concepts ayant ≥1 bloc': avecBloc,
  'concepts ORPHELINS': tags.filter(t => !t.notes.length && !t.messages.length).length,
}])

const top = tags
  .map(t => ({ concept: t.name, notes: t.notes.length, blocs: t.messages.length, total: t.notes.length + t.messages.length }))
  .sort((a, b) => b.total - a.total)
  .slice(0, 12)
console.log('Les 12 concepts les mieux fournis :')
console.table(top)

console.log('\n═══ 2. LES SCREENSHOTS — où sont-ils ? ═══')
const parType = new Map()
for (const m of messages) parType.set(m.type, (parType.get(m.type) ?? 0) + 1)
console.table([...parType.entries()].map(([type, n]) => ({ 'Message.type': type, nombre: n })))
const avecImg = messages.filter(m => /<img\b/i.test(m.content)).length
const imgSeule = messages.filter(m => /<img\b/i.test(m.content) && m.content.replace(/<[^>]+>/g, '').trim().length === 0).length
console.log(`Blocs contenant une <img> : ${avecImg} / ${messages.length}  (dont ${imgSeule} sans aucun texte = capture nue)`)
const imgTaguees = messages.filter(m => /<img\b/i.test(m.content)).filter(m => tags.some(t => t.messages.some(x => x.messageId === m.id))).length
console.log(`Blocs-image DÉJÀ reliés à un concept : ${imgTaguees}`)

console.log('\n═══ 3. LA CHAÎNE VERS LE RÉSULTAT ═══')
// Segments de trade déclarés dans le JSON des notes, et leur outcome.
const segmentsParNote = new Map()
let segments = 0, segmentsAvecOutcome = 0
const outcomes = new Map()
for (const n of notes) {
  const t = Array.isArray(n.trades) ? n.trades : []
  const m = new Map()
  for (const s of t) {
    if (!s || typeof s !== 'object' || !s.id) continue
    segments++
    m.set(s.id, s)
    if (s.outcome) { segmentsAvecOutcome++; outcomes.set(s.outcome, (outcomes.get(s.outcome) ?? 0) + 1) }
  }
  segmentsParNote.set(n.id, m)
}
console.log(`Notes portant des segments de trade : ${notes.filter(n => Array.isArray(n.trades) && n.trades.length).length} / ${notes.length}`)
console.log(`Segments de trade : ${segments}, dont ${segmentsAvecOutcome} avec un outcome renseigné`)
console.table([...outcomes.entries()].map(([outcome, n]) => ({ outcome, segments: n })))

const blocsAvecTradeRef = messages.filter(m => m.tradeRef).length
console.log(`Blocs rattachés à un segment (tradeRef) : ${blocsAvecTradeRef} / ${messages.length}`)

// LE TEST QUI COMPTE : concept → bloc → segment → outcome, jusqu'au bout.
const msgById = new Map(messages.map(m => [m.id, m]))
let chainesCompletes = 0
const conceptsAvecResultat = new Set()
for (const t of tags) {
  for (const { messageId } of t.messages) {
    const m = msgById.get(messageId)
    if (!m?.tradeRef || !m.noteId) continue
    const seg = segmentsParNote.get(m.noteId)?.get(m.tradeRef)
    if (seg?.outcome) { chainesCompletes++; conceptsAvecResultat.add(t.name) }
  }
}
console.log(`\n>>> CHAÎNES COMPLÈTES concept → bloc → segment → outcome : ${chainesCompletes}`)
console.log(`>>> Concepts pour lesquels un résultat de trade est calculable : ${conceptsAvecResultat.size} / ${tags.length}`)
if (conceptsAvecResultat.size) console.log('    ' + [...conceptsAvecResultat].join(' · '))

console.log('\n═══ 4. LA NOTATION (Annotation) ═══')
const parGrade = new Map()
for (const a of annotations) parGrade.set(a.grade, (parGrade.get(a.grade) ?? 0) + 1)
console.table([{
  annotations: annotations.length,
  'ciblant un trade (tradeRef)': annotations.filter(a => a.tradeRef).length,
  'ciblant un bloc (messageRef)': annotations.filter(a => a.messageRef).length,
  'ciblant une note seule': annotations.filter(a => !a.tradeRef && !a.messageRef && a.noteId).length,
  'avec une cause': annotations.filter(a => a.causeCategory).length,
}])
console.table([...parGrade.entries()].map(([grade, n]) => ({ grade, nombre: n })))

// Notation atteignable depuis un concept, par les deux chemins possibles.
const notesParTag = new Map()
for (const t of tags) {
  const s = new Set(t.notes.map(n => n.noteId))
  for (const { messageId } of t.messages) {
    const m = msgById.get(messageId)
    if (m?.noteId) s.add(m.noteId)
  }
  notesParTag.set(t.id, s)
}
let notationParNote = 0
const conceptsAvecNotation = new Set()
for (const t of tags) {
  const ns = notesParTag.get(t.id)
  const n = annotations.filter(a => a.noteId && ns.has(a.noteId)).length
  notationParNote += n
  if (n) conceptsAvecNotation.add(t.name)
}
console.log(`Notation atteignable par la note du concept : ${notationParNote} couples (concept, annotation)`)
console.log(`Concepts ayant au moins une notation : ${conceptsAvecNotation.size} / ${tags.length}`)

console.log('\n═══ 5. LE GISEMENT NON EXPLOITÉ — Note.concepts[] (smart capture) ═══')
const notesAvecConcepts = notes.filter(n => (n.concepts ?? []).length > 0)
const auto = new Map()
for (const n of notesAvecConcepts) for (const c of n.concepts) auto.set(c.toLowerCase(), (auto.get(c.toLowerCase()) ?? 0) + 1)
console.log(`Notes portant des concepts auto-extraits : ${notesAvecConcepts.length} / ${notes.length}`)
console.log(`Concepts auto-extraits distincts : ${auto.size}`)
const nomsTags = new Set(tags.map(t => t.name.trim().toLowerCase()))
const dejaTaxonomie = [...auto.keys()].filter(c => nomsTags.has(c)).length
console.log(`Dont déjà présents dans la taxonomie Tag : ${dejaTaxonomie} — les autres sont des candidats à lier`)
console.table([...auto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([concept, n]) => ({
  'concept auto-extrait': concept, notes: n, 'dans la taxonomie ?': nomsTags.has(concept) ? 'oui' : '—',
})))

await prisma.$disconnect()
