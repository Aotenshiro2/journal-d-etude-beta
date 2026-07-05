import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import AppHeader from '@/components/AppHeader'
import PatternBoard, { PatternData } from '@/components/PatternBoard'

export const dynamic = 'force-dynamic'

// Fiches « Pattern Map » (Tendler) — cartographier l'escalade des problèmes récurrents.
export default async function PatternsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const patterns = await prisma.pattern.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
  })

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--canvas-bg)' }}>
      <AppHeader user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }} backHref="/" backLabel="Accueil" title="Pattern Maps" />
      <PatternBoard initial={patterns as unknown as PatternData[]} />
    </div>
  )
}
