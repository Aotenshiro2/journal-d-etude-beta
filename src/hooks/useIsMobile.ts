'use client'

import { useState, useEffect } from 'react'

// Le seuil « téléphone » : en dessous, on n'a plus la place des overlays latéraux
// (le panneau d'aperçu fait 300 px à lui seul) et les gestes passent au doigt.
// Tablettes et au-dessus gardent l'expérience bureau.
const QUERY = '(max-width: 767px)'

// Rend `false` au premier rendu — celui du serveur et de l'hydratation, où
// `window` n'existe pas. Le vrai état arrive à l'effet : un composant qui s'en
// sert doit donc supporter d'être monté une fois en version bureau.
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    setIsMobile(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
