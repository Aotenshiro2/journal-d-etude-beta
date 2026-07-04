import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import AppHeader from '@/components/AppHeader'
import ReviewDeck, { ReviewNote } from '@/components/ReviewDeck'
import { MessageData, AnnotationData, CanvasNodeData } from '@/types'

// La relecture : une carte = une note réorganisée. On relit la réorganisation
// (structure + blocs + images) ; le verdict A/B/C n'est central que pour un trade.
export default async function ReviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  // Toutes les notes réorganisées (canvas d'étude) de l'utilisateur, avec leur contenu.
  const canvases = await prisma.canvas.findMany({
    where: { userId: user.id, type: 'note-study', noteId: { not: null } },
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

  const built = canvases
    .filter(c => c.note && c.nodes.length > 0)
    .map(c => {
      const note = c.note!
      const verdicts = (note.annotations ?? []) as unknown as AnnotationData[]
      const tradesArr = Array.isArray(note.trades) ? note.trades : []
      const isTradeMaterial = tradesArr.length > 0 || verdicts.some(v => v.tradeRef != null)
      const hasDue = verdicts.some(v => v.reviewDueAt != null && new Date(v.reviewDueAt).getTime() <= now)
      const item: ReviewNote = {
        note: { id: note.id, title: note.title ?? 'Sans titre', favicon: note.favicon },
        isTradeMaterial,
        nodes: c.nodes.map(mapNode),
        messages: note.messages as unknown as MessageData[],
        verdicts,
      }
      return { item, hasDue }
    })

  // Les notes portant un verdict échu passent en tête (elles « appellent » la relecture).
  built.sort((a, b) => Number(b.hasDue) - Number(a.hasDue))
  const items = built.map(b => b.item)

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--canvas-bg)' }}>
      <AppHeader
        user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}
        backHref="/"
        backLabel="Accueil"
        title="Relecture"
      />
      <ReviewDeck items={items} />
    </div>
  )
}
