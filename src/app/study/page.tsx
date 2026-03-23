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

  const notes = await prisma.note.findMany({
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
      messages: {
        where: { type: 'image' },
        take: 1,
        select: { id: true, content: true, type: true, order: true, noteId: true },
      },
    },
  })

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <AppHeader
        user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}
        backHref="/"
        backLabel="Accueil"
        title="Étudier mes notes"
      />

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Mes notes</h1>
            <p className="text-sm text-gray-400 mt-1">
              {notes.length} note{notes.length !== 1 ? 's' : ''} capturée{notes.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Link
            href="/study/canvas"
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-gray-300 hover:bg-white/10 hover:border-white/20 transition-all"
          >
            Lier les notes →
          </Link>
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
