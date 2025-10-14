'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { NoteData } from '@/types'
import GridBackground from './GridBackground'
import ZoomControls from './ZoomControls'
import { useDebounce } from '@/hooks/useDebounce'

// Import dynamique pour éviter les problèmes SSR
let fabric: any = null
if (typeof window !== 'undefined') {
  fabric = require('fabric').fabric
}

// Utilitaire pour nettoyer les event listeners
const cleanupEventListeners = (canvas: any) => {
  if (!canvas) return
  
  canvas.off('mouse:up')
  canvas.off('mouse:dblclick')
  canvas.off('object:moving')
  canvas.off('object:scaling')
  canvas.off('object:modified')
}

interface CanvasProps {
  notes: NoteData[]
  onNoteUpdate: (note: Partial<NoteData> & { id: string }) => void
  onNoteCreate: (position: { x: number; y: number }, elementType?: string) => void
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
  const [isDragOver, setIsDragOver] = useState(false)
  const wheelListenerRef = useRef<((e: WheelEvent) => void) | null>(null)
  const resizeListenerRef = useRef<(() => void) | null>(null)

  // Debounced update functions pour optimiser les performances
  const debouncedNoteUpdate = useDebounce(onNoteUpdate, 150)
  
  const debouncedCanvasRender = useDebounce(() => {
    if (fabricCanvasRef.current) {
      fabricCanvasRef.current.renderAll()
    }
  }, 50)

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

    // Stocker les références pour le cleanup
    wheelListenerRef.current = handleWheel
    resizeListenerRef.current = handleResize

    canvasRef.current?.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('resize', handleResize)
    setIsReady(true)

    return () => {
      // Cleanup robuste
      const canvasElement = canvasRef.current
      const wheelListener = wheelListenerRef.current
      const resizeListener = resizeListenerRef.current

      if (canvasElement && wheelListener) {
        canvasElement.removeEventListener('wheel', wheelListener)
      }
      if (resizeListener) {
        window.removeEventListener('resize', resizeListener)
      }
      
      cleanupEventListeners(canvas)
      
      // Dispose du canvas de manière sûre
      try {
        canvas.dispose()
      } catch (error) {
        console.warn('Error disposing canvas:', error)
      }
      
      fabricCanvasRef.current = null
      wheelListenerRef.current = null
      resizeListenerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!fabricCanvasRef.current || !isReady) return

    const canvas = fabricCanvasRef.current

    const handleCanvasClick = (e: any) => {
      try {
        if (e.target) {
          const noteId = e.target.get('noteId') as string
          onNoteSelect(noteId || null)
        } else {
          onNoteSelect(null)
        }
      } catch (error) {
        console.warn('Error in canvas click handler:', error)
      }
    }

    const handleDoubleClick = (e: any) => {
      try {
        if (!e.target) {
          const pointer = canvas.getPointer(e.e)
          onNoteCreate({ x: pointer.x, y: pointer.y })
        }
      } catch (error) {
        console.warn('Error in double click handler:', error)
      }
    }

    const handleObjectMoving = (e: any) => {
      try {
        const target = e.target
        if (target && target.get('noteId')) {
          const noteId = target.get('noteId') as string
          debouncedNoteUpdate({
            id: noteId,
            x: target.left || 0,
            y: target.top || 0,
          })
        }
      } catch (error) {
        console.warn('Error in object moving handler:', error)
      }
    }

    const handleObjectScaling = (e: any) => {
      try {
        const target = e.target
        if (target && target.get('noteId')) {
          const noteId = target.get('noteId') as string
          debouncedNoteUpdate({
            id: noteId,
            width: (target.width || 0) * (target.scaleX || 1),
            height: (target.height || 0) * (target.scaleY || 1),
          })
        }
      } catch (error) {
        console.warn('Error in object scaling handler:', error)
      }
    }

    // Ajouter les event listeners avec gestion d'erreur
    try {
      canvas.on('mouse:up', handleCanvasClick)
      canvas.on('mouse:dblclick', handleDoubleClick)
      canvas.on('object:moving', handleObjectMoving)
      canvas.on('object:scaling', handleObjectScaling)
    } catch (error) {
      console.warn('Error adding canvas event listeners:', error)
    }

    return () => {
      try {
        canvas.off('mouse:up', handleCanvasClick)
        canvas.off('mouse:dblclick', handleDoubleClick)
        canvas.off('object:moving', handleObjectMoving)
        canvas.off('object:scaling', handleObjectScaling)
      } catch (error) {
        console.warn('Error removing canvas event listeners:', error)
      }
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

  // Gestion du drag & drop depuis la sidebar
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    
    const elementType = e.dataTransfer.getData('text/plain')
    if (elementType) {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      
      onNoteCreate({ x, y }, elementType)
    }
  }

  return (
    <div 
      className={`relative w-full h-full overflow-hidden bg-gray-50 ${
        isDragOver ? 'bg-blue-50 border-2 border-dashed border-blue-300' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <GridBackground 
        width={canvasSize.width} 
        height={canvasSize.height} 
        zoom={zoom} 
      />
      <canvas 
        ref={canvasRef} 
        className="absolute top-0 left-0 z-10" 
      />
      
      {/* Indicateur de drop zone */}
      {isDragOver && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <div className="bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg">
            📌 Relâchez pour créer l'élément
          </div>
        </div>
      )}
      
      <ZoomControls
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetZoom={handleResetZoom}
      />
    </div>
  )
}