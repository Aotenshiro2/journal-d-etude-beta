import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CanvasShell from '@/components/CanvasShell'
import ComingSoon from '@/components/ComingSoon'

// Placeholder orphelin (aucun lien ne pointe ici, il n'est pas dans le dropdown) —
// migré avec /journal parce qu'il partage ComingSoon. À supprimer si l'écran
// « Observer le marché » n'est plus au programme.
export default async function MarketPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  return (
    <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}>
      <ComingSoon title="Observer le marché" icon="🔎" description="Suivi des actifs, flux d'actualités, analyse technique." />
    </CanvasShell>
  )
}
