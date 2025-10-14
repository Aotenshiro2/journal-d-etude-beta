'use client'

import { useEffect, useRef } from 'react'
import { ConnectionData, NoteData } from '@/types'

// Import dynamique pour éviter les problèmes SSR
let fabric: any = null
if (typeof window !== 'undefined') {
  fabric = require('fabric').fabric
}

interface ConnectionManagerProps {
  connections: ConnectionData[]
  notes: NoteData[]
  fabricCanvas: any
  isConnecting: boolean
  connectingFromId?: string
  tempConnection?: {
    fromId: string
    startPoint: { x: number; y: number }
    endPoint: { x: number; y: number }
  }
  onConnectionCreate: (connection: Omit<ConnectionData, 'id'>) => void
}

export default function ConnectionManager({
  connections,
  notes,
  fabricCanvas,
  isConnecting,
  connectingFromId,
  tempConnection,
  onConnectionCreate
}: ConnectionManagerProps) {
  const connectionsRef = useRef<any[]>([])

  // Fonction pour calculer les points de connexion optimaux
  const calculateConnectionPoints = (fromNote: NoteData, toNote: NoteData) => {
    const fromCenter = {
      x: fromNote.x + fromNote.width / 2,
      y: fromNote.y + fromNote.height / 2
    }
    const toCenter = {
      x: toNote.x + toNote.width / 2,
      y: toNote.y + toNote.height / 2
    }

    // Calculer les points sur les bords des rectangles
    const dx = toCenter.x - fromCenter.x
    const dy = toCenter.y - fromCenter.y

    // Point de départ (bord de la note source)
    let fromPoint = { ...fromCenter }
    if (Math.abs(dx) > Math.abs(dy)) {
      // Connexion horizontale
      fromPoint.x = fromNote.x + (dx > 0 ? fromNote.width : 0)
      fromPoint.y = fromCenter.y
    } else {
      // Connexion verticale
      fromPoint.x = fromCenter.x
      fromPoint.y = fromNote.y + (dy > 0 ? fromNote.height : 0)
    }

    // Point d'arrivée (bord de la note cible)
    let toPoint = { ...toCenter }
    if (Math.abs(dx) > Math.abs(dy)) {
      // Connexion horizontale
      toPoint.x = toNote.x + (dx > 0 ? 0 : toNote.width)
      toPoint.y = toCenter.y
    } else {
      // Connexion verticale
      toPoint.x = toCenter.x
      toPoint.y = toNote.y + (dy > 0 ? 0 : toNote.height)
    }

    return { fromPoint, toPoint }
  }

  // Fonction pour créer une flèche Fabric.js
  const createArrow = (fromPoint: { x: number; y: number }, toPoint: { x: number; y: number }, connection: ConnectionData) => {
    if (!fabric) return null

    const line = new fabric.Line([fromPoint.x, fromPoint.y, toPoint.x, toPoint.y], {
      stroke: connection.color || '#6b7280',
      strokeWidth: connection.strokeWidth || 2,
      selectable: false,
      evented: false,
      excludeFromExport: false,
    })

    // Calculer l'angle pour la pointe de flèche
    const angle = Math.atan2(toPoint.y - fromPoint.y, toPoint.x - fromPoint.x)
    const arrowLength = 10
    const arrowAngle = Math.PI / 6

    // Points de la pointe de flèche
    const arrowX1 = toPoint.x - arrowLength * Math.cos(angle - arrowAngle)
    const arrowY1 = toPoint.y - arrowLength * Math.sin(angle - arrowAngle)
    const arrowX2 = toPoint.x - arrowLength * Math.cos(angle + arrowAngle)
    const arrowY2 = toPoint.y - arrowLength * Math.sin(angle + arrowAngle)

    // Créer la pointe de flèche
    const arrowHead = new fabric.Polygon([
      { x: toPoint.x, y: toPoint.y },
      { x: arrowX1, y: arrowY1 },
      { x: arrowX2, y: arrowY2 }
    ], {
      fill: connection.color || '#6b7280',
      selectable: false,
      evented: false,
    })

    // Grouper la ligne et la pointe
    const group = new fabric.Group([line, arrowHead], {
      selectable: false,
      evented: false,
    })

    group.set('connectionId', connection.id)
    return group
  }

  // Mettre à jour les connexions quand les notes ou connexions changent
  useEffect(() => {
    if (!fabricCanvas || !fabric) return

    // Supprimer les anciennes connexions
    connectionsRef.current.forEach(conn => {
      fabricCanvas.remove(conn)
    })
    connectionsRef.current = []

    // Créer les nouvelles connexions
    connections.forEach(connection => {
      const fromNote = notes.find(n => n.id === connection.fromId)
      const toNote = notes.find(n => n.id === connection.toId)

      if (fromNote && toNote) {
        const { fromPoint, toPoint } = calculateConnectionPoints(fromNote, toNote)
        const arrow = createArrow(fromPoint, toPoint, connection)
        
        if (arrow) {
          fabricCanvas.add(arrow)
          connectionsRef.current.push(arrow)
          arrow.moveTo(0) // Mettre les connexions en arrière-plan
        }
      }
    })

    fabricCanvas.renderAll()
  }, [connections, notes, fabricCanvas])

  // Afficher la connexion temporaire pendant le drag
  useEffect(() => {
    if (!fabricCanvas || !fabric || !tempConnection) return

    // Supprimer l'ancienne connexion temporaire
    const existingTemp = fabricCanvas.getObjects().find((obj: any) => obj.get('isTemp'))
    if (existingTemp) {
      fabricCanvas.remove(existingTemp)
    }

    // Créer la nouvelle connexion temporaire
    const tempLine = new fabric.Line([
      tempConnection.startPoint.x,
      tempConnection.startPoint.y,
      tempConnection.endPoint.x,
      tempConnection.endPoint.y
    ], {
      stroke: '#3b82f6',
      strokeWidth: 2,
      strokeDashArray: [5, 5],
      selectable: false,
      evented: false,
    })

    tempLine.set('isTemp', true)
    fabricCanvas.add(tempLine)
    fabricCanvas.renderAll()

    return () => {
      const tempToRemove = fabricCanvas.getObjects().find((obj: any) => obj.get('isTemp'))
      if (tempToRemove) {
        fabricCanvas.remove(tempToRemove)
        fabricCanvas.renderAll()
      }
    }
  }, [tempConnection, fabricCanvas])

  return null // Ce composant ne rend rien visuellement
}