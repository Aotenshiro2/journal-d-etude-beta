import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import CanvasShell from '@/components/CanvasShell'
import ImportsTrades from '@/components/ImportsTrades'

export const dynamic = 'force-dynamic'

// « Importer mes trades » — la porte déterministe : un fichier de plateforme
// (Tradovate d'abord) devient des trades en base, dédupliqués, que le mentor
// lit à côté des jugements du carnet. On ne réaffiche pas un dashboard : la
// donnée sert de SOURCE, pas de spectacle (cadrage Brice, 08/09/2026).
export default async function ImportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const dueCount = await prisma.canvas.count({
    where: { userId: user.id, type: 'note-study', reviewedAt: null, nodes: { some: {} } },
  })

  return (
    <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }} dueCount={dueCount}>
      <ImportsTrades />
    </CanvasShell>
  )
}
