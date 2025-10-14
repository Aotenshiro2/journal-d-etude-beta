'use client'

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  EdgeProps,
} from '@xyflow/react'

// Edge animé pour les connexions principales/actives
export function AnimatedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <BaseEdge
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        ...style,
        stroke: '#3b82f6',
        strokeWidth: 2,
        strokeDasharray: '5,5',
      }}
      className="animate-pulse"
    />
  )
}

// Edge temporaire pour les connexions conditionnelles/secondaires
export function TemporaryEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: '#f59e0b',
          strokeWidth: 1.5,
          strokeDasharray: '8,4',
          opacity: 0.7,
        }}
      />
    </>
  )
}

// Edge standard pour les connexions normales
export function StandardEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <BaseEdge
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        ...style,
        stroke: '#6b7280',
        strokeWidth: 2,
      }}
    />
  )
}

// Types d'edges exportés
export const edgeTypes = {
  animated: AnimatedEdge,
  temporary: TemporaryEdge,
  standard: StandardEdge,
}