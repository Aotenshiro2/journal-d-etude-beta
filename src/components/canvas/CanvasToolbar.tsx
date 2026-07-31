'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   La pill d'outils à droite — 0.1.7

   Elle existait en DEUX exemplaires écrits à l'identique : `RightToolbar` dans
   NoteMapCanvas et `CanvasToolbar` dans StudyCanvas. Même conteneur au pixel,
   même `btnBase`, même séparateur, même bloc d'état actif, même trio de zoom.
   Seuls le contenu du milieu et les libellés changeaient.

   ⚠️ Ce composant ne doit contenir AUCUN `<Panel>` de React Flow : un Panel doit
   être enfant de `<ReactFlow>`, or l'accueil rend sa barre EN DEHORS. Les
   boutons « Grouper » / « Fusionner » restent donc chez StudyCanvas.
   `useReactFlow()` fonctionne des deux côtés, il suffit d'être dans le Provider.
   ───────────────────────────────────────────────────────────────────────────── */

import type React from 'react'
import { useReactFlow } from '@xyflow/react'
import { MousePointer2, Square, Pencil, Hand, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'

export type OutilCanvas = 'select' | 'mark' | 'connect' | 'pan'

const ICONES: Record<OutilCanvas, React.ElementType> = {
  select: MousePointer2,
  mark: Square,
  connect: Pencil,
  pan: Hand,
}

export type ActionBarre = {
  id: string
  Icon: React.ElementType
  label: string
  onClick: (e: React.MouseEvent) => void
  /** État « allumé », pour un bouton à bascule comme le favori. */
  actif?: boolean
  couleurActive?: string
  remplirIcone?: boolean
}

export const BTN_BASE: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 7,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'none', border: '1px solid transparent',
  cursor: 'pointer', color: 'var(--node-meta)',
}

const Separateur = () => (
  <div style={{ height: 1, background: 'var(--float-border)', margin: '2px 0' }} />
)

function BoutonAction({ a }: { a: ActionBarre }) {
  const couleurRepos = a.actif ? (a.couleurActive ?? '#3b82f6') : 'var(--node-meta)'
  return (
    <button
      onClick={a.onClick}
      title={a.label}
      style={{ ...BTN_BASE, color: couleurRepos }}
      onMouseEnter={e => {
        if (!a.actif) e.currentTarget.style.color = '#3b82f6'
        e.currentTarget.style.background = 'var(--canvas-bg)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = couleurRepos
        e.currentTarget.style.background = 'none'
      }}
    >
      <a.Icon size={14} fill={a.remplirIcone && a.actif ? (a.couleurActive ?? '#3b82f6') : 'none'} />
    </button>
  )
}

export function CanvasToolbar({
  outil,
  setOutil,
  outils,
  actions = [],
  actionsFin = [],
}: {
  outil: OutilCanvas
  setOutil: (o: OutilCanvas) => void
  /** Ordre et libellé de chaque outil. Les deux canvas n'ont pas encore le même
   *  vocabulaire de tooltip, on le laisse à l'appelant. */
  outils: { id: OutilCanvas; label: string }[]
  /** Entre les outils et le zoom : concept, nouveau groupe, texte libre… */
  actions?: ActionBarre[]
  /** Après le zoom : le favori de l'accueil. */
  actionsFin?: ActionBarre[]
}) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()

  const zooms: ActionBarre[] = [
    { id: 'zoom-in', Icon: ZoomIn, label: 'Zoom avant', onClick: () => zoomIn({ duration: 200 }) },
    { id: 'zoom-out', Icon: ZoomOut, label: 'Zoom arrière', onClick: () => zoomOut({ duration: 200 }) },
    { id: 'fit', Icon: Maximize2, label: 'Ajuster la vue', onClick: () => fitView({ duration: 400 }) },
  ]

  return (
    <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', zIndex: 20 }}>
      <div className="canvas-float-pill" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 4px' }}>

        {outils.map(({ id, label }) => {
          const Icon = ICONES[id]
          const choisi = outil === id
          return (
            <button
              key={id}
              onClick={() => setOutil(id)}
              title={label}
              style={{
                ...BTN_BASE,
                background: choisi ? 'var(--tool-active-bg)' : 'none',
                border: choisi ? '1px solid var(--tool-active-border)' : '1px solid transparent',
                color: choisi ? '#3b82f6' : 'var(--node-meta)',
              }}
            >
              <Icon size={14} />
            </button>
          )
        })}

        {actions.length > 0 && <Separateur />}
        {actions.map(a => <BoutonAction key={a.id} a={a} />)}

        <Separateur />
        {zooms.map(a => <BoutonAction key={a.id} a={a} />)}

        {actionsFin.length > 0 && <Separateur />}
        {actionsFin.map(a => <BoutonAction key={a.id} a={a} />)}

      </div>
    </div>
  )
}
