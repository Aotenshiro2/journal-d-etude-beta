import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CanvasShell from '@/components/CanvasShell'
import ComingSoon from '@/components/ComingSoon'

// Placeholder : le shell donne déjà le canvas et le dropdown pour repartir
// ailleurs — d'où le retrait du lien « retour à l'accueil » en dur.
export default async function JournalPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  return (
    <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}>
      <ComingSoon title="Journal de trading" icon="📈" description="Trades, émotions, règles respectées ou non." />
    </CanvasShell>
  )
}
