import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import AppHeader from '@/components/AppHeader'
import ConceptGroup from '@/components/ConceptGroup'

export default async function ConceptsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const tags = await prisma.tag.findMany({
    where: { userId: user.id },
    include: {
      messages: {
        include: {
          message: {
            include: {
              note: { select: { id: true, title: true, favicon: true } },
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <AppHeader
        user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}
        backHref="/"
        backLabel="Accueil"
        title="Concepts"
      />
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Concepts</h1>
          <p className="text-sm text-gray-400 mt-1">
            {tags.length} tag{tags.length !== 1 ? 's' : ''} · tous tes blocs tagués
          </p>
        </div>

        {tags.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-4xl mb-4">🏷</div>
            <h2 className="text-lg font-semibold text-white mb-2">Aucun concept pour l&apos;instant</h2>
            <p className="text-sm text-gray-500 max-w-sm">
              Ouvre une note, place des blocs sur le canvas et ajoute des tags.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {tags.map((tag) => (
              <ConceptGroup key={tag.id} tag={tag} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
