import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import CanvasShell from '@/components/CanvasShell'
import ReviewDeck, { ReviewNote, ReorganizeItem, LibraryItem } from '@/components/ReviewDeck'
import { MessageData, AnnotationData, CanvasNodeData } from '@/types'

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

// Construit un élément de relecture depuis un canvas d'étude (+ sa note chargée).
type CanvasWithNote = {
  id: string
  nodes: Parameters<typeof mapNode>[0][]
  note: {
    id: string; title: string | null; favicon: string | null; trades: unknown
    messages: unknown[]; annotations: unknown[]
  } | null
}
function buildItem(c: CanvasWithNote): ReviewNote {
  const note = c.note!
  const anns = (note.annotations ?? []) as unknown as AnnotationData[]
  const tradesRaw = Array.isArray(note.trades) ? (note.trades as { id: string; outcome?: string | null; startedAt?: number | null }[]) : []
  const tradeV = anns.some(a => a.tradeRef != null)
  const globalV = anns.some(a => a.tradeRef == null && a.messageRef == null)
  const type: ReviewNote['type'] = (tradesRaw.length > 0 || tradeV) ? 'trade' : globalV ? 'day' : 'course'
  return {
    canvasId: c.id,
    note: { id: note.id, title: note.title ?? 'Sans titre', favicon: note.favicon },
    type,
    nodes: c.nodes.map(mapNode),
    messages: note.messages as unknown as MessageData[],
    verdicts: anns,
    trades: tradesRaw.map(t => ({ id: t.id, outcome: t.outcome ?? null, startedAt: t.startedAt ?? null })),
  }
}

const noteSelect = {
  id: true, title: true, favicon: true, trades: true,
  messages: { orderBy: { order: 'asc' as const } },
  annotations: true, // toutes (relues incluses) — pour VOIR les trades notés en contexte
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ note?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')
  const userId = user.id
  const now = Date.now()
  const { note: focusNoteId } = await searchParams

  // ── Mode focus : relire UNE note précise (même déjà relue) via ?note=<noteId> ──
  if (focusNoteId) {
    const c = await prisma.canvas.findFirst({
      where: { userId, type: 'note-study', noteId: focusNoteId },
      include: { nodes: true, note: { select: noteSelect } },
    })
    const items = c && c.note && c.nodes.length > 0 ? [buildItem(c as CanvasWithNote)] : []
    return (
      <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}>
        <ReviewDeck toRelire={items} toReorganize={[]} focus />
      </CanvasShell>
    )
  }

  // ── À relire : notes réorganisées non relues (relue et sans rappel échu → hors file) ──
  const canvases = await prisma.canvas.findMany({
    where: { userId, type: 'note-study', noteId: { not: null } },
    include: { nodes: true, note: { select: noteSelect } },
  })

  const toRelireBuilt = canvases
    .filter(c => c.note && c.nodes.length > 0)
    .filter(c => {
      const relue = c.reviewedAt != null
      const reminderDue = c.reviewReminderAt != null && new Date(c.reviewReminderAt).getTime() <= now
      return !relue || reminderDue
    })
    .map(c => {
      const item = buildItem(c as CanvasWithNote)
      const hasDue = item.verdicts.some(a => !a.reviewedAt && a.reviewDueAt != null && new Date(a.reviewDueAt).getTime() <= now)
      return { item, hasDue }
    })
  toRelireBuilt.sort((a, b) => Number(b.hasDue) - Number(a.hasDue))
  const toRelire = toRelireBuilt.map(b => b.item)

  // ── À réorganiser : notes de cours (aucune note A/B/C) avec du contenu mais pas triées ──
  const [unorganized, folders] = await Promise.all([
    prisma.note.findMany({
      where: {
        userId, deletedAt: null,
        annotations: { none: {} },
        messages: { some: {} },
        OR: [{ canvas: { is: null } }, { canvas: { nodes: { none: {} } } }],
      },
      select: { id: true, title: true, favicon: true, folderId: true },
      orderBy: { lastModifiedAt: 'desc' },
    }),
    prisma.folder.findMany({ where: { userId }, select: { id: true, name: true } }),
  ])

  // ── Bibliothèque (décision Brice 19/07) : l'inventaire PERMANENT de tout ce
  // qui a un canvas travaillé — notes (relues OU non) + collections — pour
  // voir/revoir à volonté sans devoir réorganiser pour retrouver.
  const collectionCanvases = await prisma.canvas.findMany({
    where: { userId, type: 'collection' },
    select: {
      id: true, sourceGroupId: true, title: true, reviewedAt: true, updatedAt: true,
      _count: { select: { nodes: true, memberNotes: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })
  const library: LibraryItem[] = [
    // Notes travaillées — depuis les canvases déjà chargés pour la file
    ...canvases
      .filter(c => c.note && c.nodes.length > 0)
      .map(c => ({
        kind: 'note' as const,
        targetId: c.note!.id,
        title: c.note!.title ?? 'Sans titre',
        favicon: c.note!.favicon,
        reviewed: c.reviewedAt != null,
        updatedAt: c.updatedAt,
      })),
    // Collections mappées — même dissoutes de l'accueil
    ...collectionCanvases
      .filter(c => c._count.nodes > 0 || c._count.memberNotes > 0)
      .map(c => ({
        kind: 'collection' as const,
        targetId: c.sourceGroupId as string,
        title: c.title ?? 'Collection',
        noteCount: c._count.memberNotes,
        reviewed: c.reviewedAt != null,
        updatedAt: c.updatedAt,
      })),
  ]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map(({ updatedAt: _u, ...item }) => item)

  const folderName = new Map(folders.map(f => [f.id, f.name]))
  const toReorganize: ReorganizeItem[] = unorganized.map(n => ({
    id: n.id, title: n.title ?? 'Sans titre', favicon: n.favicon,
    folder: n.folderId ? folderName.get(n.folderId) ?? null : null,
  }))

  // Même définition que le badge « Relire » de l'accueil (canvas d'étude non relus),
  // recalculée depuis les canvas déjà chargés plutôt qu'avec une requête de plus.
  const dueCount = canvases.filter(c => c.reviewedAt == null && c.nodes.length > 0).length

  return (
    <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }} dueCount={dueCount}>
      <ReviewDeck toRelire={toRelire} toReorganize={toReorganize} library={library} />
    </CanvasShell>
  )
}
