import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import AppHeader from '@/components/AppHeader'
import ReviewDeck, { ReviewNote, ReorganizeItem } from '@/components/ReviewDeck'
import { MessageData, AnnotationData, CanvasNodeData } from '@/types'

// La relecture, dans l'ordre du parcours de l'élève :
//   1. « À réorganiser » — les notes de cours pas encore triées (le travail d'ancrage à faire).
//   2. « À relire » — les notes réorganisées, non relues (relue = mémorisée → sort de la file).
export default async function ReviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')
  const userId = user.id
  const now = Date.now()

  const mapNode = (n: {
    id: string; canvasId: string; messageId: string | null; noteId: string | null
    kind: string; content: string | null; label: string | null; color: string | null
    parentId: string | null; orderInParent: number | null
    x: number; y: number; width: number; height: number
  }): CanvasNodeData => ({
    id: n.id, canvasId: n.canvasId, messageId: n.messageId, noteId: n.noteId,
    kind: n.kind, content: n.content, label: n.label, color: n.color,
    parentId: n.parentId, orderInParent: n.orderInParent,
    x: n.x, y: n.y, width: n.width, height: n.height,
  })

  // ── À relire : notes réorganisées (canvas d'étude non vide) non relues ──
  const canvases = await prisma.canvas.findMany({
    where: { userId, type: 'note-study', noteId: { not: null } },
    include: {
      nodes: true,
      note: {
        select: {
          id: true, title: true, favicon: true, trades: true,
          messages: { orderBy: { order: 'asc' } },
          annotations: { where: { reviewedAt: null } },
        },
      },
    },
  })

  const toRelireBuilt = canvases
    .filter(c => c.note && c.nodes.length > 0)
    .filter(c => {
      const relue = c.reviewedAt != null
      const reminderDue = c.reviewReminderAt != null && new Date(c.reviewReminderAt).getTime() <= now
      return !relue || reminderDue // relue et sans rappel échu → sort de la file
    })
    .map(c => {
      const note = c.note!
      const anns = (note.annotations ?? []) as unknown as AnnotationData[]
      const tradesArr = Array.isArray(note.trades) ? note.trades : []
      const tradeV = anns.some(a => a.tradeRef != null)
      const globalV = anns.some(a => a.tradeRef == null && a.messageRef == null)
      // 3 niveaux : positions/trades → journée notée globalement → note de cours (aucune note)
      const type: ReviewNote['type'] = (tradesArr.length > 0 || tradeV) ? 'trade' : globalV ? 'day' : 'course'
      const hasDue = anns.some(a => a.reviewDueAt != null && new Date(a.reviewDueAt).getTime() <= now)
      const item: ReviewNote = {
        canvasId: c.id,
        note: { id: note.id, title: note.title ?? 'Sans titre', favicon: note.favicon },
        type,
        nodes: c.nodes.map(mapNode),
        messages: note.messages as unknown as MessageData[],
        verdicts: anns,
      }
      return { item, hasDue }
    })

  // Verdict échu en tête (il « appelle » la relecture), le reste ensuite.
  toRelireBuilt.sort((a, b) => Number(b.hasDue) - Number(a.hasDue))
  const toRelire = toRelireBuilt.map(b => b.item)

  // ── À réorganiser : notes de cours (aucune note A/B/C) avec du contenu mais pas encore triées ──
  const unorganized = await prisma.note.findMany({
    where: {
      userId, deletedAt: null,
      annotations: { none: {} },
      messages: { some: {} },
      OR: [{ canvas: { is: null } }, { canvas: { nodes: { none: {} } } }],
    },
    select: { id: true, title: true, favicon: true },
    orderBy: { lastModifiedAt: 'desc' },
    take: 12,
  })
  const toReorganize: ReorganizeItem[] = unorganized.map(n => ({
    id: n.id, title: n.title ?? 'Sans titre', favicon: n.favicon,
  }))

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--canvas-bg)' }}>
      <AppHeader
        user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}
        backHref="/"
        backLabel="Accueil"
        title="Relecture"
      />
      <ReviewDeck toRelire={toRelire} toReorganize={toReorganize} />
    </div>
  )
}
