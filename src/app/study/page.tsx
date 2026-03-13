import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import Link from 'next/link'
import NoteCard from '@/components/NoteCard'
import AppHeader from '@/components/AppHeader'

export default async function StudyPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const notes = await prisma.note.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      content: true,
      contentHash: true,
      favicon: true,
      sourceUrl: true,
      source: true,
      syncedAt: true,
      createdAt: true,
      updatedAt: true,
      userId: true,
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
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-4xl mb-4">📭</div>
            <h2 className="text-lg font-semibold text-white mb-2">Aucune note pour l&apos;instant</h2>
            <p className="text-sm text-gray-500 max-w-sm">
              Installe l&apos;extension Chrome AOKnowledge pour capturer tes premières notes depuis le web.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {notes.map((note) => (
              <NoteCard
                key={note.id}
                note={{
                  ...note,
                  messages: undefined,
                }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
