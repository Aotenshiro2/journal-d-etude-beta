import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import CanvasShell from '@/components/CanvasShell'
import PatternBoard, { PatternData } from '@/components/PatternBoard'

export const dynamic = 'force-dynamic'

// Fiches « Pattern Map » (Tendler) — cartographier l'escalade des problèmes récurrents.
export default async function PatternsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')
  const userId = user.id

  const [patterns, dueCount] = await Promise.all([
    prisma.pattern.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
    // Notes réorganisées mais pas encore relues — même badge « Relire » que l'accueil
    prisma.canvas.count({ where: { userId, type: 'note-study', reviewedAt: null, nodes: { some: {} } } }),
  ])

  return (
    <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }} dueCount={dueCount}>
      <PatternBoard initial={patterns as unknown as PatternData[]} />
    </CanvasShell>
  )
}
