import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CanvasShell from '@/components/CanvasShell'
import MesTrades from '@/components/mes-trades/MesTrades'

// « Mes trades » (brief J2, 05/11/2026), à la place de « Documenter mes trades » :
// le prévu du Carnet face à l'effectif du broker. Le shell donne le canvas, la
// pilule des espaces (titrée « Mes trades ») et les actions du bas ; l'écran
// charge ses données lui-même (GET /api/trades/synthese), selon la période.
export default async function JournalPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  return (
    <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}>
      <MesTrades />
    </CanvasShell>
  )
}
