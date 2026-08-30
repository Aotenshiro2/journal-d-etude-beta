'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   Le nœud-CONCEPT — un tag incarné sur le canvas.

   Relier une carte à ce nœud avec le crayon = la carte porte le concept. Côté
   serveur, `POST /api/canvas/[id]/edges` crée un `NoteTag` OU un `MessageTag`
   selon l'extrémité : le nœud fonctionne donc aussi bien sur le canvas d'accueil
   (des notes) que sur celui d'une note (des blocs). C'est ce qui permet de le
   partager tel quel entre les deux depuis le 0.1.7.

   Extrait de NoteMapCanvas, où il ne servait qu'à l'accueil.
   ───────────────────────────────────────────────────────────────────────────── */

import React, { useCallback, useState } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { PoigneesCardinales } from './poignees'
import { couleurConcept } from '@/lib/couleur-concept'

export const ConceptNode = React.memo(function ConceptNode({ id, data }: NodeProps) {
  const { setNodes, setEdges } = useReactFlow()
  const d = data as { label: string; color?: string | null; canvasId: string }
  const [hovered, setHovered] = useState(false)
  // 0.1.7 — la couleur se DÉDUIT du nom. `Tag.color` vaut le même bleu par
  // défaut pour les 126 concepts de la base (personne n'a jamais pu en choisir
  // un), donc s'y fier rendait toutes les pastilles identiques — et avec elles
  // tous les traits d'appartenance. Une couleur réellement choisie reste
  // prioritaire : voir `lib/couleur-concept.ts`.
  const color = couleurConcept(d.label, d.color)

  const handleRemove = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm(`Retirer le nœud « ${d.label} » du canvas ?\n\nLes cartes reliées par un trait perdent CE concept (les tags posés autrement ne bougent pas).`)) return
    await fetch(`/api/canvas/${d.canvasId}/nodes/${id}`, { method: 'DELETE' })
    setEdges(eds => eds.filter(e2 => e2.source !== id && e2.target !== id))
    setNodes(nds => nds.filter(n => n.id !== id))
  }, [id, d.canvasId, d.label, setNodes, setEdges])

  return (
    <div
      className="group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '10px 16px', borderRadius: 100,
        background: `${color}1f`, border: `1.5px solid ${color}`,
        boxShadow: 'var(--node-shadow)',
      }}
    >
      <PoigneesCardinales couleur={color} />
      <span style={{ fontSize: 13, fontWeight: 700, color }}>#</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--node-title)', whiteSpace: 'nowrap' }}>{d.label}</span>
      {hovered && (
        <button
          onClick={handleRemove}
          title="Retirer ce concept du canvas"
          style={{
            position: 'absolute', top: -7, right: -7,
            width: 18, height: 18, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(239,68,68,0.85)', border: 'none',
            cursor: 'pointer', color: '#fff', fontSize: 12, lineHeight: 1, padding: 0,
          }}
        >×</button>
      )}
    </div>
  )
})
