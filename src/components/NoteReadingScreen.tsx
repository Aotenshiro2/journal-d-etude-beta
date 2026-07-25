'use client'

// ─── L'écran de lecture — la note d'origine, plein cadre ──────────────────────
//
// Le même décor que partout (CanvasShell : dot grid, dropdown des espaces, pill
// bas-droite) : on ne change pas d'app, l'accueil se métamorphose en liseuse.
// Une seule colonne, centrée, largeur de lecture — pas de canvas ici.
//
// La note d'origine n'est JAMAIS modifiée depuis cet écran (doctrine) : on lit.
// Pour la travailler, le bouton « Explorer » mène à la copie de travail.

import Link from 'next/link'
import { ChevronLeft, Network } from 'lucide-react'
import CanvasShell from './CanvasShell'
import NoteReader from './NoteReader'
import { NoteData, MessageData } from '@/types'

interface NoteReadingScreenProps {
  note: NoteData & { messages: MessageData[] }
  user: { email: string; name: string }
  dueCount: number
}

export default function NoteReadingScreen({ note, user, dueCount }: NoteReadingScreenProps) {
  return (
    <CanvasShell user={user} dueCount={dueCount}>
      {/* La colonne de lecture. `680px` est la largeur au-delà de laquelle l'œil
          perd la ligne ; en dessous, elle prend tout l'écran moins les marges. */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 14px 96px' }}>
          {/* Retour + accès à l'exploration. En haut du flux plutôt qu'en overlay :
              sur un petit écran, chaque pastille flottante en moins est de la
              place gagnée pour le texte. */}
          <div className="canvas-float-pill" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', marginBottom: 14 }}>
            <Link
              href="/"
              title="Retour à la carte des notes"
              className="touch-target"
              style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--node-meta)', textDecoration: 'none', fontSize: 12, flexShrink: 0 }}
            >
              <ChevronLeft size={14} /> Carte
            </Link>
            <div style={{ width: 1, height: 16, background: 'var(--float-border)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 11, color: 'var(--node-meta)' }}>Note d&apos;origine — lecture</span>
            <Link
              href={`/notes/${note.id}`}
              title="Ouvrir l'exploration (la copie de travail)"
              className="touch-target"
              style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--node-title)', textDecoration: 'none', fontSize: 12, flexShrink: 0, padding: '2px 4px' }}
            >
              <Network size={13} style={{ color: 'var(--node-meta)' }} /> Explorer
            </Link>
          </div>

          <div className="canvas-float-pill note-reading-body" style={{ overflow: 'hidden' }}>
            <NoteReader note={note} />
          </div>
        </div>
      </div>
    </CanvasShell>
  )
}
