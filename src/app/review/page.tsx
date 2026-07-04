import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import AppHeader from '@/components/AppHeader'
import ReviewDeck, { ReviewItem } from '@/components/ReviewDeck'

// La file de relecture : les jugements A/B/C dont l'échéance (~2 semaines) est passée.
export default async function ReviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const due = await prisma.annotation.findMany({
    where: { userId: user.id, reviewedAt: null, reviewDueAt: { lte: new Date() } },
    include: { note: { select: { id: true, title: true, favicon: true } } },
    orderBy: { reviewDueAt: 'asc' },
  })

  const items = due as unknown as ReviewItem[]

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--canvas-bg)' }}>
      <AppHeader
        user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}
        backHref="/"
        backLabel="Accueil"
        title="Relecture"
      />
      <ReviewDeck items={items} />
    </div>
  )
}
