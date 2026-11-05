'use client'

// La vignette d'une étape du guide (brief J2) : public/guide/etape-N.png. Tant
// que l'image manque (les vraies captures viendront après le labo 2), un cadre
// neutre affiche sa légende, comme dans le labo. L'image ne se montre qu'une
// fois chargée : jamais d'icône d'image cassée.

import { useEffect, useRef, useState } from 'react'
import type { EtapeGuide } from '@/lib/guide-journal'

export default function Vignette({ etape, grande = false }: { etape: EtapeGuide; grande?: boolean }) {
  const [chargee, setChargee] = useState(false)
  const image = useRef<HTMLImageElement>(null)

  // Une image déjà en cache peut finir de charger avant que React n'écoute.
  useEffect(() => {
    const img = image.current
    if (img && img.complete && img.naturalWidth > 0) setChargee(true)
  }, [])

  return (
    <div
      className={`relative w-full overflow-hidden rounded-[10px] ${grande ? 'aspect-video' : 'aspect-[4/3]'}`}
      style={{ background: 'var(--case-bg)', border: chargee ? '1px solid var(--node-border)' : '1px dashed var(--float-border)' }}
    >
      {!chargee && (
        <span
          aria-hidden="true"
          className={`absolute inset-0 grid place-items-center p-1.5 text-center ${grande ? 'text-xs' : 'text-[10.5px]'}`}
          style={{ color: 'var(--node-meta)' }}
        >
          {etape.vignette}
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={image}
        src={etape.image}
        alt={etape.vignette}
        onLoad={() => setChargee(true)}
        onError={() => setChargee(false)}
        className={`absolute inset-0 h-full w-full object-cover ${chargee ? '' : 'opacity-0'}`}
        loading={grande ? 'eager' : 'lazy'}
      />
    </div>
  )
}
