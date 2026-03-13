import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import WorkspaceCard from '@/components/WorkspaceCard'
import UserMenu from '@/components/UserMenu'
import ThemeToggle from '@/components/ThemeToggle'
import Link from 'next/link'

const workspaces = [
  {
    id: 'study',
    icon: '📘',
    title: 'Étudier mes notes',
    description: 'Organise tes blocs sur un canvas, tague les concepts clés.',
    href: '/study',
    available: true,
  },
  {
    id: 'market',
    icon: '🔎',
    title: 'Observer le marché',
    description: "Suivi des actifs, flux d'actualités, analyse technique.",
    href: '/market',
    available: false,
  },
  {
    id: 'review',
    icon: '📊',
    title: 'Revoir ma session',
    description: 'Debriefing post-session, stats de performance.',
    href: '/review',
    available: false,
  },
  {
    id: 'journal',
    icon: '📈',
    title: 'Journal de trading',
    description: 'Trades, émotions, règles respectées ou non.',
    href: '/journal',
    available: false,
  },
  {
    id: 'analytics',
    icon: '📉',
    title: 'Analyser mes données',
    description: 'Statistiques avancées, patterns, edge identification.',
    href: '/analytics',
    available: false,
  },
]

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <span className="text-xl">📚</span>
          <span className="font-semibold text-white">AOKnowledge</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/guide"
            className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
          >
            <span className="text-xs border border-gray-600 rounded-full w-4 h-4 flex items-center justify-center">?</span>
            <span>Guide</span>
          </Link>
          <ThemeToggle />
          <UserMenu user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }} />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-12 text-center">
          <h1 className="text-3xl font-bold text-white mb-3">
            Que veux-tu faire aujourd&apos;hui&nbsp;?
          </h1>
          <p className="text-gray-400">Choisis ton espace de travail</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {workspaces.map((ws) => (
            <WorkspaceCard key={ws.id} workspace={ws} />
          ))}
        </div>
      </main>
    </div>
  )
}
