'use client'

import { useState } from 'react'

interface DivergenceBannerProps {
  onDismiss: () => void
}

export default function DivergenceBanner({ onDismiss }: DivergenceBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  const handleDismiss = () => {
    setDismissed(true)
    onDismiss()
  }

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-yellow-400/10 border-b border-yellow-400/20 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-yellow-400">⚠</span>
        <span className="text-yellow-200">
          La note source a été modifiée. Les nouveaux blocs sont disponibles dans le panneau bas.
        </span>
      </div>
      <button
        onClick={handleDismiss}
        className="text-yellow-400 hover:text-yellow-200 transition-colors ml-4 flex-shrink-0"
      >
        Marquer comme vu ✕
      </button>
    </div>
  )
}
