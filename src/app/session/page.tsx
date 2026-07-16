import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import CanvasShell from '@/components/CanvasShell'
import RitualBoard, { RitualData } from '@/components/RitualBoard'

export const dynamic = 'force-dynamic'

// Rituel de séance (Tendler / masterclass perte) : warmup avant, cooldown après.
export default async function SessionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')
  const userId = user.id

  const [rituals, dueCount] = await Promise.all([
    prisma.ritual.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    // Notes réorganisées mais pas encore relues — même badge « Relire » que l'accueil
    prisma.canvas.count({ where: { userId, type: 'note-study', reviewedAt: null, nodes: { some: {} } } }),
  ])

  return (
    <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }} dueCount={dueCount}>
      <RitualBoard initial={rituals as unknown as RitualData[]} />
    </CanvasShell>
  )
}
