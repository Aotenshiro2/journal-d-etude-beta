import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import Link from 'next/link'
import NoteCard from '@/components/NoteCard'
import AppHeader from '@/components/AppHeader'
import EmptyNotesState from '@/components/EmptyNotesState'

export default async function StudyPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const [rawNotes, folders] = await Promise.all([
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
  ])

  const folderNames = new Map(folders.map(f => [f.id, f.name]))
  const notes = rawNotes.map(({ canvas, trades, ...n }) => ({
    ...n,
    trades: (trades as unknown as import('@/types').TradeSegmentData[] | null) ?? undefined,
    folderName: n.folderId ? folderNames.get(n.folderId) ?? null : null,
    worked: (canvas?._count.nodes ?? 0) > 0,
  }))

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--canvas-bg)', color: 'var(--node-title)' }}>
      <AppHeader
        user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}
        backHref="/"
        backLabel="Carte"
        title="Notes"
      />

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--node-title)' }}>Mes notes</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--node-meta)' }}>
              {notes.length} note{notes.length !== 1 ? 's' : ''} capturée{notes.length !== 1 ? 's' : ''}
            </p>
          </div>
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
      </main>
    </div>
  )
}
