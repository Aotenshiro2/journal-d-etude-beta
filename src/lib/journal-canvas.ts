// Famille « maison » qui LIT le journal (correction Brice 01/09, livrée 02/09) :
// quand l'élève capture son canvas, l'extension envoie les ids des cartes
// visibles, et ce module les résout en NOTES RÉELLES — de ce compte uniquement,
// jamais d'un autre. Le modèle lit alors le corps des notes et les liens tracés
// au lieu d'un DOM de titres tronqués qui produisait un sommaire.
import { prisma } from './db'

const MAX_NOTES = 40
const MAX_PAR_NOTE = 1200
const MAX_TOTAL = 24000
const MAX_LIENS = 40

function texteDe(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function resoudreCanvasJournal(
  userId: string,
  noteIds: string[],
  liens: [string, string][]
): Promise<string | null> {
  const ids = [...new Set(noteIds)].slice(0, MAX_NOTES)
  if (ids.length === 0) return null

  const notes = await prisma.note.findMany({
    where: { userId, deletedAt: null, id: { in: ids } },
    select: {
      id: true,
      title: true,
      content: true,
      messages: {
        where: { type: 'text' },
        select: { content: true },
        orderBy: { order: 'asc' },
        take: 12,
      },
    },
  })
  if (notes.length === 0) return null

  const parId = new Map(notes.map(n => [n.id, n]))
  const morceaux: string[] = [
    'CANVAS DU JOURNAL — contenu réel des notes visibles, résolu depuis la base (pas depuis l’écran) :',
  ]
  let total = 0
  for (const n of notes) {
    const corps = texteDe([n.content ?? '', ...n.messages.map(m => m.content)].join('\n')).slice(0, MAX_PAR_NOTE)
    const bloc = `\n### ${n.title ?? 'Sans titre'}\n${corps || '(note sans texte)'}`
    if (total + bloc.length > MAX_TOTAL) break
    morceaux.push(bloc)
    total += bloc.length
  }

  const nomme = (id: string) => parId.get(id)?.title ?? null
  const liensNommes = liens
    .map(([a, b]) => [nomme(a), nomme(b)] as const)
    .filter((l): l is readonly [string, string] => Boolean(l[0] && l[1]))
    .slice(0, MAX_LIENS)
  if (liensNommes.length > 0) {
    morceaux.push('\nLIENS TRACÉS PAR L’ÉLÈVE ENTRE CES NOTES (sa structuration, elle compte autant que le contenu) :')
    for (const [a, b] of liensNommes) morceaux.push(`- « ${a} » ↔ « ${b} »`)
  }

  if (notes.length < ids.length) {
    morceaux.push(`\n(${ids.length - notes.length} carte(s) du canvas non résolue(s) en note.)`)
  }
  return morceaux.join('\n')
}
