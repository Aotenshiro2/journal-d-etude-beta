/**
 * Inventaire LECTURE SEULE des traits du canvas — préparation de la grammaire (0.1.7).
 *
 * Pourquoi ce script existe : avant de décider « 3 types de trait, chacun sa
 * forme », il faut savoir ce que la base contient VRAIMENT. Deux questions, une
 * seule réponse possible et elle est en base :
 *
 *   1. Le type d'un trait est-il DÉDUCTIBLE de ce qu'il relie ? Si chaque paire
 *      (kind de départ → kind d'arrivée) correspond à une seule intention, la
 *      grammaire devient un pur changement de rendu : zéro migration, zéro UI,
 *      zéro reprise des traits existants. Si la même paire porte des intentions
 *      différentes, il faut un type explicite — et alors la colonne
 *      `CanvasEdge.style` est déjà là, écrite une fois à 'curved' et lue nulle
 *      part (voir le tableau 5).
 *
 *   2. Quels mots les élèves posent-ils au double-clic ? Ces libellés sont la
 *      taxonomie du terrain. Une grammaire inventée à la table contre eux
 *      serait jolie et fausse.
 *
 * Précédent qui justifie de regarder au lieu de croire : le 24/07, on pensait
 * les traits note↔concept écrits en base. Il y en avait ZÉRO (collision d'ids,
 * la FK partait en 409 silencieux).
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/inventaire-traits-0.1.7.mjs
 *
 * N'écrit rien. Ne juge rien. Compte.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** Nomme un nœud comme on le voit à l'écran, pas comme la colonne l'appelle.
 *  `kind` seul ne suffit pas : une carte de note et un bloc de note sont deux
 *  objets différents pour l'élève, et c'est cette différence qui porterait un
 *  type de trait. */
function role(n) {
  if (!n) return '(nœud absent)'
  if (n.kind === 'concept') return 'concept'
  if (n.kind === 'group') return n.tagId ? 'groupe vivant' : 'groupe'
  if (n.noteId) return 'note'
  if (n.kind === 'text') return 'bloc libre'
  if (n.messageId) return 'bloc'
  return n.kind ?? '(kind vide)'
}

const edges = await prisma.canvasEdge.findMany({
  include: {
    canvas: { select: { type: true, title: true, noteId: true, sourceGroupId: true } },
    from: { select: { kind: true, noteId: true, messageId: true, tagId: true, label: true } },
    to: { select: { kind: true, noteId: true, messageId: true, tagId: true, label: true } },
  },
})

const nodes = await prisma.canvasNode.groupBy({ by: ['kind'], _count: { _all: true } })
const canvases = await prisma.canvas.groupBy({ by: ['type'], _count: { _all: true } })

console.log('\n═══ 1. VOLUME ═══')
console.log(`Traits (CanvasEdge) : ${edges.length}`)
console.table(canvases.map(c => ({ 'type de canvas': c.type, nombre: c._count._all })))
console.table(nodes.map(n => ({ 'kind de nœud': n.kind, nombre: n._count._all })))

console.log('\n═══ 2. LA MATRICE — un trait relie quoi à quoi ═══')
console.log("(la question : une paire = une intention, ou plusieurs ?)")
const parPaire = new Map()
for (const e of edges) {
  const paire = `${role(e.from)} → ${role(e.to)}`
  const acc = parPaire.get(paire) ?? { paire, total: 0, nommés: 0, libellés: [] }
  acc.total++
  if (e.label?.trim()) {
    acc.nommés++
    acc.libellés.push(e.label.trim())
  }
  parPaire.set(paire, acc)
}
console.table(
  [...parPaire.values()]
    .sort((a, b) => b.total - a.total)
    .map(p => ({
      'relie': p.paire,
      'traits': p.total,
      'dont nommés': p.nommés,
      'libellés observés': p.libellés.length ? [...new Set(p.libellés)].join(' · ') : '—',
    })),
)

console.log('\n═══ 3. LES MOTS DU TERRAIN — tous les libellés, verbatim ═══')
const libellés = new Map()
for (const e of edges) {
  const l = e.label?.trim()
  if (!l) continue
  libellés.set(l, (libellés.get(l) ?? 0) + 1)
}
if (libellés.size === 0) {
  console.log('AUCUN trait nommé. La taxonomie du terrain est vide : la grammaire')
  console.log("ne peut pas s'appuyer sur ce que les élèves ont écrit, seulement sur")
  console.log('ce que les traits relient (tableau 2).')
} else {
  console.table(
    [...libellés.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([libellé, n]) => ({ libellé, occurrences: n })),
  )
}
const nommés = edges.filter(e => e.label?.trim()).length
console.log(`Nommés : ${nommés}/${edges.length}`)

console.log('\n═══ 4. OÙ VIVENT LES TRAITS ═══')
const parContexte = new Map()
for (const e of edges) {
  const c = e.canvas
  const contexte = c?.sourceGroupId ? 'collection' : c?.noteId ? "étude d'une note" : (c?.type ?? '(canvas absent)')
  parContexte.set(contexte, (parContexte.get(contexte) ?? 0) + 1)
}
console.table([...parContexte.entries()].map(([contexte, n]) => ({ contexte, traits: n })))

console.log('\n═══ 5. LA COLONNE `style` — est-elle libre ? ═══')
const styles = await prisma.canvasEdge.groupBy({ by: ['style'], _count: { _all: true } })
console.table(styles.map(s => ({ style: s.style, nombre: s._count._all })))
console.log("Écrite une seule fois dans le code (`body.style ?? 'curved'`, POST des")
console.log("edges) et lue nulle part au rendu. Si tout est 'curved', elle peut")
console.log('porter le type sans migration.')

console.log('\n═══ 6. CE QUI TOUCHE UN CONCEPT (le futur backlink) ═══')
const versConcept = edges.filter(e => role(e.from) === 'concept' || role(e.to) === 'concept')
console.log(`${versConcept.length} trait(s) touchent un nœud-concept.`)
const groupesVivants = edges.filter(e => role(e.from).startsWith('groupe vivant') || role(e.to).startsWith('groupe vivant'))
console.log(`${groupesVivants.length} trait(s) touchent un groupe VIVANT (groupe lié à un tag).`)

console.log('\n═══ 7. LA CONTRAINTE À CONNAÎTRE ═══')
console.log('`@@unique([fromId, toId])` : UN SEUL trait par couple de nœuds.')
console.log("Deux liens de types différents entre les deux mêmes objets sont donc")
console.log('impossibles aujourd\'hui, quelle que soit la grammaire choisie.')

await prisma.$disconnect()
