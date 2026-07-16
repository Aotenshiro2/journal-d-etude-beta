import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { BookOpen } from 'lucide-react'
import NoteCard from '@/components/NoteCard'
import CanvasShell from '@/components/CanvasShell'
import EmptyNotesState from '@/components/EmptyNotesState'

export default async function StudyPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const [rawNotes, folders, dueCount] = await Promise.all([
    prisma.note.findMany({
      where: { userId: user.id },
      orderBy: { lastModifiedAt: 'desc' },
      select: {
        id: true,
        title: true,
        content: true,
        contentHash: true,
        favicon: true,
        sourceUrl: true,
        source: true,
        lastSyncAt: true,
        createdAt: true,
        firstSyncAt: true,
        lastModifiedAt: true,
        userId: true,
        concepts: true,
        folderId: true,
        trades: true,
        tags: { select: { tag: true } },
        annotations: true,
        canvas: { select: { _count: { select: { nodes: true } } } },
        messages: {
          where: { type: 'image' },
          take: 1,
          select: { id: true, content: true, type: true, order: true, noteId: true },
        },
      },
    }),
    prisma.folder.findMany({ where: { userId: user.id }, select: { id: true, name: true } }),
    // Notes réorganisées mais pas encore relues — même badge « Relire » que l'accueil
    prisma.canvas.count({ where: { userId: user.id, type: 'note-study', reviewedAt: null, nodes: { some: {} } } }),
  ])

  const folderNames = new Map(folders.map(f => [f.id, f.name]))
  const notes = rawNotes.map(({ canvas, trades, ...n }) => ({
    ...n,
    trades: (trades as unknown as import('@/types').TradeSegmentData[] | null) ?? undefined,
    folderName: n.folderId ? folderNames.get(n.folderId) ?? null : null,
    worked: (canvas?._count.nodes ?? 0) > 0,
  }))

  return (
    <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }} dueCount={dueCount}>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto w-full px-6 py-8">
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-1">
              <BookOpen size={18} style={{ color: 'var(--node-title)' }} />
              <h1 className="text-xl font-bold" style={{ color: 'var(--node-title)' }}>Tout ce que tu as capturé</h1>
            </div>
            <p className="text-sm" style={{ color: 'var(--node-meta)' }}>
              {notes.length} note{notes.length !== 1 ? 's' : ''} capturée{notes.length !== 1 ? 's' : ''}. La carte les met en relation ; ici tu les retrouves à plat.
            </p>
          </div>

          {notes.length === 0 ? (
            <EmptyNotesState />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {notes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </CanvasShell>
  )
}
