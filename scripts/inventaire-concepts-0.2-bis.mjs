/**
 * LECTURE SEULE — suite de `inventaire-concepts-0.2.mjs`.
 *
 * Le premier passage a rendu 0 chaîne complète concept → bloc → segment →
 * outcome. Avant d'en conclure que les stats de résultat sont impossibles, on
 * teste le CHEMIN DE REPLI, plus lâche mais peut-être suffisant : attribuer le
 * résultat au niveau de la NOTE (la séance) et non du bloc. Et on regarde sur
 * QUOI portent les 122 liens existants — un lien sur un bloc de métadonnées ne
 * vaut pas un lien sur un screenshot.
 */

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const tags = await prisma.tag.findMany({
  select: {
    id: true, name: true, category: true,
    notes: { select: { noteId: true } },
    messages: { select: { message: { select: { id: true, noteId: true, type: true } } } },
  },
})
const notes = await prisma.note.findMany({ select: { id: true, trades: true } })
const annotations = await prisma.annotation.findMany({ select: { noteId: true, tradeRef: true, grade: true } })

console.log('\n═══ A. SUR QUOI PORTENT LES 122 LIENS BLOC↔CONCEPT ═══')
const parType = new Map()
for (const t of tags) for (const { message: m } of t.messages) parType.set(m.type, (parType.get(m.type) ?? 0) + 1)
console.table([...parType.entries()].map(([type, n]) => ({ 'type du bloc lié': type, liens: n })))

console.log('\n═══ B. LES CONCEPTS SONT-ILS CLASSÉS ? ═══')
const parCat = new Map()
for (const t of tags) parCat.set(t.category ?? '(aucune)', (parCat.get(t.category ?? '(aucune)') ?? 0) + 1)
console.table([...parCat.entries()].map(([categorie, n]) => ({ 'Tag.category': categorie, concepts: n })))

console.log('\n═══ C. CHEMIN DE REPLI — le résultat attribué à la SÉANCE ═══')
const segParNote = new Map()
for (const n of notes) {
  const arr = Array.isArray(n.trades) ? n.trades : []
  segParNote.set(n.id, arr.filter(s => s && s.id && s.outcome))
}
const lignes = []
for (const t of tags) {
  const ns = new Set(t.notes.map(x => x.noteId))
  for (const { message: m } of t.messages) if (m.noteId) ns.add(m.noteId)
  let gain = 0, perte = 0, be = 0
  for (const nid of ns) for (const s of segParNote.get(nid) ?? []) {
    if (s.outcome === 'gain') gain++
    else if (s.outcome === 'perte') perte++
    else be++
  }
  const notation = { A: 0, B: 0, C: 0 }
  for (const a of annotations) if (a.noteId && ns.has(a.noteId) && notation[a.grade] !== undefined) notation[a.grade]++
  const trades = gain + perte + be
  const notes_ = notation.A + notation.B + notation.C
  if (trades || notes_) lignes.push({ concept: t.name, séances: ns.size, gain, perte, be, A: notation.A, B: notation.B, C: notation.C })
}
lignes.sort((a, b) => (b.gain + b.perte + b.be + b.A + b.B + b.C) - (a.gain + a.perte + a.be + a.A + a.B + a.C))
console.log(`Concepts pour lesquels au moins UN chiffre est calculable par ce chemin : ${lignes.length} / ${tags.length}`)
console.table(lignes.slice(0, 15))

console.log('\n═══ D. CE QU\'IL FAUDRAIT POUR QUE LE CHEMIN PRÉCIS MARCHE ═══')
const blocsTagues = new Set()
for (const t of tags) for (const { message: m } of t.messages) blocsTagues.add(m.id)
const avecTradeRef = await prisma.message.count({ where: { tradeRef: { not: null } } })
const tagesEtTradeRef = await prisma.message.count({ where: { tradeRef: { not: null }, id: { in: [...blocsTagues] } } })
console.log(`Blocs avec un tradeRef : ${avecTradeRef}`)
console.log(`Blocs à la fois TAGUÉS et rattachés à un trade : ${tagesEtTradeRef}`)
console.log('→ c\'est ce nombre qui doit monter pour que « ce concept dans un trade perdant » devienne calculable au bloc.')

await prisma.$disconnect()
