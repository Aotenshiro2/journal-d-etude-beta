import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import AppHeader from '@/components/AppHeader'
import RitualBoard, { RitualData } from '@/components/RitualBoard'

export const dynamic = 'force-dynamic'

// Rituel de séance (Tendler / masterclass perte) : warmup avant, cooldown après.
export default async function SessionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const rituals = await prisma.ritual.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--canvas-bg)' }}>
      <AppHeader user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }} backHref="/" backLabel="Accueil" title="Séance" />
      <RitualBoard initial={rituals as unknown as RitualData[]} />
    </div>
  )
}
