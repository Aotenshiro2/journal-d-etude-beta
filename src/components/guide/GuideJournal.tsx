'use client'

// La page Guide (brief J2, 05/11/2026) : à la PREMIÈRE ouverture, le carrousel
// (une étape par écran) ; ensuite, la page pas à pas, qui récape. « Vu » se
// retient dans user_metadata.guide_journal_vu (supabase.auth.updateUser, comme
// l'accueil du nouvel élève), posé à Terminer ou à la fermeture du carrousel.

import { useCallback, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import GuideCarrousel from './GuideCarrousel'
import GuidePasAPas from './GuidePasAPas'

export default function GuideJournal({ premiereFois }: { premiereFois: boolean }) {
  const [carrousel, setCarrousel] = useState(premiereFois)
  const marque = useRef(!premiereFois)

  const fermer = useCallback(() => {
    setCarrousel(false)
    if (marque.current) return
    marque.current = true
    void (async () => {
      try {
        const supabase = createClient()
        await supabase.auth.updateUser({ data: { guide_journal_vu: true } })
      } catch {
        // silencieux : au pire, le carrousel revient à la prochaine visite
      }
    })()
  }, [])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 pb-28 pt-6 sm:px-6">
        {carrousel ? <GuideCarrousel onFermer={fermer} /> : <GuidePasAPas onRevoir={() => setCarrousel(true)} />}
      </div>
    </div>
  )
}
