'use client'

import { useEffect, useRef, useState } from 'react'
import { NoteData } from '@/types'
import GridBackground from './GridBackground'
import ZoomControls from './ZoomControls'

// Import dynamique pour éviter les problèmes SSR
let fabric: any = null
if (typeof window !== 'undefined') {
  fabric = require('fabric').fabric
}

interface CanvasProps {
  notes: NoteData[]
  onNoteUpdate: (note: Partial<NoteData> & { id: string }) => void
  onNoteCreate: (position: { x: number; y: number }) => void
  onNoteSelect: (noteId: string | null) => void
  selectedNoteId?: string
}

export default function Canvas({ 
  notes, 
  onNoteUpdate, 
  onNoteCreate, 
  onNoteSelect, 
  selectedNoteId 
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    if (!canvasRef.current || fabricCanvasRef.current || !fabric) return

    const width = window.innerWidth
    const height = window.innerHeight - 64 // Soustraire la hauteur de la toolbar
    
    setCanvasSize({ width, height })
    
    const canvas = new fabric.Canvas(canvasRef.current, {
      width: width,
      height: height,
      backgroundColor: 'transparent',
      selection: true,
      preserveObjectStacking: true,
    })

    fabricCanvasRef.current = canvas

    const handleResize = () => {
      const newWidth = window.innerWidth
      const newHeight = window.innerHeight - 64
      
      setCanvasSize({ width: newWidth, height: newHeight })
      canvas.setDimensions({
        width: newWidth,
        height: newHeight,
      })
    }

    // Gestion du zoom avec la molette
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        const newZoom = Math.max(0.1, Math.min(3, zoom + delta))
        setZoom(newZoom)
        canvas.setZoom(newZoom)
        canvas.renderAll()
      }
    }

    canvasRef.current?.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('resize', handleResize)
    setIsReady(true)

    return () => {
      canvasRef.current?.removeEventListener('wheel', handleWheel)
      window.removeEventListener('resize', handleResize)
      canvas.dispose()
      fabricCanvasRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!fabricCanvasRef.current || !isReady) return

    const canvas = fabricCanvasRef.current

    const handleCanvasClick = (e: any) => {
      if (e.target) {
        const noteId = e.target.get('noteId') as string
        onNoteSelect(noteId || null)
      } else {
        onNoteSelect(null)
      }
    }

    const handleDoubleClick = (e: any) => {
      if (!e.target) {
        const pointer = canvas.getPointer(e.e)
        onNoteCreate({ x: pointer.x, y: pointer.y })
      }
    }

    const handleObjectMoving = (e: any) => {
      const target = e.target
      if (target && target.get('noteId')) {
        const noteId = target.get('noteId') as string
        onNoteUpdate({
          id: noteId,
          x: target.left || 0,
          y: target.top || 0,
        })
      }
    }

    const handleObjectScaling = (e: any) => {
      const target = e.target
      if (target && target.get('noteId')) {
        const noteId = target.get('noteId') as string
        onNoteUpdate({
          id: noteId,
          width: (target.width || 0) * (target.scaleX || 1),
          height: (target.height || 0) * (target.scaleY || 1),
        })
      }
    }

    canvas.on('mouse:up', handleCanvasClick)
    canvas.on('mouse:dblclick', handleDoubleClick)
    canvas.on('object:moving', handleObjectMoving)
    canvas.on('object:scaling', handleObjectScaling)

    return () => {
      canvas.off('mouse:up', handleCanvasClick)
      canvas.off('mouse:dblclick', handleDoubleClick)
      canvas.off('object:moving', handleObjectMoving)
      canvas.off('object:scaling', handleObjectScaling)
    }
  }, [isReady, onNoteUpdate, onNoteCreate, onNoteSelect])

  useEffect(() => {
    if (!fabricCanvasRef.current || !isReady) return

    const canvas = fabricCanvasRef.current
    canvas.clear()

    notes.forEach((note) => {
      const rect = new fabric.Rect({
        left: note.x,
        top: note.y,
        width: note.width,
        height: note.height,
        fill: note.backgroundColor,
        stroke: selectedNoteId === note.id ? '#3b82f6' : '#e5e7eb',
        strokeWidth: selectedNoteId === note.id ? 2 : 1,
        cornerSize: 8,
        cornerStyle: 'circle',
        transparentCorners: false,
        cornerColor: '#3b82f6',
        rx: 8, // Coins arrondis
        ry: 8,
        shadow: new fabric.Shadow({
          color: 'rgba(0, 0, 0, 0.1)',
          blur: 10,
          offsetX: 0,
          offsetY: 2,
        }),
      })

      rect.set('noteId', note.id)

      const text = new fabric.Text(note.title, {
        left: note.x + 16,
        top: note.y + 16,
        width: note.width - 32,
        fontSize: 16,
        fontWeight: '600',
        fontFamily: 'Inter, system-ui, sans-serif',
        fill: note.textColor,
        selectable: false,
        evented: false,
      })

      const contentText = new fabric.Text(
        note.content.slice(0, 120) + (note.content.length > 120 ? '...' : ''), 
        {
          left: note.x + 16,
          top: note.y + 42,
          width: note.width - 32,
          fontSize: 12,
          fontFamily: 'Inter, system-ui, sans-serif',
          fill: '#6b7280',
          selectable: false,
          evented: false,
          lineHeight: 1.4,
        }
      )

      canvas.add(rect, text, contentText)
    })

    canvas.renderAll()
  }, [notes, selectedNoteId, isReady])

  const handleZoomIn = () => {
    const newZoom = Math.min(3, zoom + 0.2)
    setZoom(newZoom)
    if (fabricCanvasRef.current) {
      fabricCanvasRef.current.setZoom(newZoom)
      fabricCanvasRef.current.renderAll()
    }
  }

  const handleZoomOut = () => {
    const newZoom = Math.max(0.1, zoom - 0.2)
    setZoom(newZoom)
    if (fabricCanvasRef.current) {
      fabricCanvasRef.current.setZoom(newZoom)
      fabricCanvasRef.current.renderAll()
    }
  }

  const handleResetZoom = () => {
    setZoom(1)
    if (fabricCanvasRef.current) {
      fabricCanvasRef.current.setZoom(1)
      fabricCanvasRef.current.setViewportTransform([1, 0, 0, 1, 0, 0])
      fabricCanvasRef.current.renderAll()
    }
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-gray-50">
      <GridBackground 
        width={canvasSize.width} 
        height={canvasSize.height} 
        zoom={zoom} 
      />
      <canvas 
        ref={canvasRef} 
        className="absolute top-0 left-0 z-10" 
      />
      <ZoomControls
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetZoom={handleResetZoom}
      />
    </div>
  )
}