import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CanvasShell from '@/components/CanvasShell'
import VersionsContenu from './VersionsContenu'

export const metadata: Metadata = {
  title: "Versions et feuille de route | Journal d'Études",
  description: "Ce qui a changé dans le Journal d'Études, palier par palier, et l'ordre des modules.",
}

// /versions : même garde d'auth que /guide. Le contenu est dans versions.ts, la
// mise en page dans VersionsContenu.tsx.
export default async function VersionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  return (
    <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}>
      <VersionsContenu />
    </CanvasShell>
  )
}
