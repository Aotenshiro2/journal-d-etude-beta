'use client'

import { useState, useEffect, useCallback } from 'react'

const KEY = 'journal-show-meta'
const EVENT = 'journal-show-meta-change'

// Réglage « afficher les métadonnées de capture » (blocs type 'meta' : date,
// titre de page, URL). Masqué par défaut — l'info est en base, pas dans l'œil.
// Partagé entre les visualisateurs via localStorage + event (sync inter-panneaux).
export function useShowMeta(): [boolean, () => void] {
  const [showMeta, setShowMeta] = useState(false)

  useEffect(() => {
    setShowMeta(localStorage.getItem(KEY) === '1')
    const onChange = () => setShowMeta(localStorage.getItem(KEY) === '1')
    window.addEventListener(EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  const toggle = useCallback(() => {
    const next = localStorage.getItem(KEY) !== '1'
    localStorage.setItem(KEY, next ? '1' : '0')
    window.dispatchEvent(new Event(EVENT))
  }, [])

  return [showMeta, toggle]
}
