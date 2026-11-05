import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CanvasShell from '@/components/CanvasShell'
import GuideJournal from '@/components/guide/GuideJournal'

// Le tutoriel du Journal (brief J2, 05/11/2026), à la place de « Le parcours » :
// les neuf étapes du labo (src/lib/guide-journal.ts), en carrousel à la première
// ouverture, puis en page pas à pas ; « Aller plus loin » garde ce que les neuf
// étapes ne couvrent pas (concepts, analyse, mental game, l'extension).
export default async function GuidePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const premiereFois = user.user_metadata?.guide_journal_vu !== true
  return (
    <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}>
      <GuideJournal premiereFois={premiereFois} />
    </CanvasShell>
  )
}
