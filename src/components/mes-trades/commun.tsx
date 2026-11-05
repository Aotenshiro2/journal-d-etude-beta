// Petits morceaux partagés par l'écran « Mes trades » (brief J2, 05/11/2026) :
// surfaces et teintes du labo (jetons --node-*, --trade-*), pastille d'écart,
// note A/B/C. Rien de calculé ici : les calculs vivent dans mes-trades-pur.ts.

import type { CSSProperties, ReactNode } from 'react'
import type { Pastille, Ton } from '@/lib/mes-trades-pur'

/** Une carte du canvas : la surface des nœuds. */
export const SURFACE: CSSProperties = {
  background: 'var(--node-bg)',
  border: '1px solid var(--node-border)',
  boxShadow: 'var(--node-shadow)',
}

export const TEINTES = {
  vert: 'var(--trade-vert)',
  ambre: 'var(--trade-ambre)',
  rouge: 'var(--trade-rouge)',
  bleu: 'var(--trade-bleu)',
  violet: 'var(--trade-violet)',
  gris: 'var(--trade-gris)',
} as const

export const COULEUR_TON: Record<Ton, string> = {
  vert: TEINTES.vert,
  ambre: TEINTES.ambre,
  rouge: TEINTES.rouge,
  neutre: 'var(--node-title)',
  gris: 'var(--node-meta)',
}

/** L'anneau de focus clavier des cartes, panneaux et jours. */
export const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-[var(--trade-bleu)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas-bg)]'

export function PastilleEcart({ pastille }: { pastille: Pastille }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-medium"
      style={{ background: 'var(--case-bg)', color: COULEUR_TON[pastille.ton] }}
    >
      {pastille.texte}
    </span>
  )
}

/** La note A/B/C du dernier jugement, telle qu'écrite (« B+ »). */
export function Note({ grade }: { grade: string }) {
  return (
    <span
      className="rounded-md px-2 py-px font-mono text-[13px] font-semibold"
      style={{ background: 'color-mix(in srgb, var(--trade-bleu) 15%, transparent)', color: TEINTES.bleu }}
      title={`Note ${grade}`}
    >
      {grade}
    </span>
  )
}

/** Un petit titre de bloc, en capitales, avec son icône. */
export function TeteBloc({ icone, children }: { icone: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--node-meta)' }}>
      {icone}
      {children}
    </div>
  )
}

export const LIBELLE_CAUSE: Record<string, string> = {
  technique: 'technique',
  connaissance: 'connaissance',
  emotionnel: 'émotionnel',
}
