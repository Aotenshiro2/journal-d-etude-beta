'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { NoteData, ConnectionData } from '@/types'
import GridBackground from './GridBackground'
import ZoomControls from './ZoomControls'
import ConnectionManager from './ConnectionManager'
import { useDebounce } from '@/hooks/useDebounce'
import { 
  captureCanvasError, 
  traceCanvasOperation, 
  addCanvasBreadcrumb,
  addUserActionBreadcrumb 
} from '@/lib/sentry-utils'

// Import dynamique pour éviter les problèmes SSR
let fabric: any = null
if (typeof window !== 'undefined') {
  fabric = require('fabric').fabric
}

// Utilitaire pour nettoyer les event listeners
const cleanupEventListeners = (canvas: any) => {
  if (!canvas) return
  
  canvas.off('mouse:up')
  canvas.off('mouse:down')
  canvas.off('mouse:move')
  canvas.off('mouse:dblclick')
  canvas.off('object:moving')
  canvas.off('object:scaling')
  canvas.off('object:modified')
}

interface CanvasProps {
  notes: NoteData[]
  connections?: ConnectionData[]
  onNoteUpdate: (note: Partial<NoteData> & { id: string }) => void
  onNoteCreate: (position: { x: number; y: number }, elementType?: string) => void
  onNoteSelect: (noteId: string | null) => void
  onNoteConnectionClick?: (noteId: string) => void
  selectedNoteId?: string
  isConnecting?: boolean
  connectingFromId?: string
}

export default function Canvas({ 
  notes, 
  connections = [],
  onNoteUpdate, 
  onNoteCreate, 
  onNoteSelect, 
  onNoteConnectionClick,
  selectedNoteId,
  isConnecting = false,
  connectingFromId
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [isDragOver, setIsDragOver] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 })
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
    const height = window.innerHeight // Canvas plein écran
    
    setCanvasSize({ width, height })
    
    const canvas = new fabric.Canvas(canvasRef.current, {
      width: width,
      height: height,
      backgroundColor: 'transparent',
      selection: true,
      preserveObjectStacking: true,
      allowTouchScrolling: true,
    })

    fabricCanvasRef.current = canvas

    const handleResize = () => {
      const newWidth = window.innerWidth
      const newHeight = window.innerHeight
      
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

    // Gestion du pan (déplacement du canvas)
    const handleMouseDown = (opt: any) => {
      const evt = opt.e
      if (evt.altKey || evt.button === 1) { // Alt key ou molette central
        setIsPanning(true)
        setLastPanPoint({ x: evt.clientX, y: evt.clientY })
        canvas.isDragging = true
        canvas.selection = false
        canvas.getElement().style.cursor = 'grab'
      }
    }

    const handleMouseMove = (opt: any) => {
      if (canvas.isDragging) {
        const evt = opt.e
        const vpt = canvas.viewportTransform
        if (vpt) {
          vpt[4] += evt.clientX - lastPanPoint.x
          vpt[5] += evt.clientY - lastPanPoint.y
          canvas.requestRenderAll()
          setLastPanPoint({ x: evt.clientX, y: evt.clientY })
          setPan({ x: vpt[4], y: vpt[5] })
        }
      }
    }

    const handleMouseUp = () => {
      canvas.isDragging = false
      canvas.selection = true
      setIsPanning(false)
      canvas.getElement().style.cursor = 'default'
    }

    // Ajouter les événements de pan
    canvas.on('mouse:down', handleMouseDown)
    canvas.on('mouse:move', handleMouseMove)
    canvas.on('mouse:up', handleMouseUp)

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
        addUserActionBreadcrumb('canvas_click');
        
        if (e.target) {
          const noteId = e.target.get('noteId') as string
          if (noteId) {
            if (isConnecting && onNoteConnectionClick) {
              addCanvasBreadcrumb('note_connection_click', { noteId });
              onNoteConnectionClick(noteId)
            } else {
              console.log('Selecting note:', noteId) // Debug
              addCanvasBreadcrumb('note_select', { noteId });
              onNoteSelect(noteId)
            }
          } else {
            addCanvasBreadcrumb('canvas_deselect');
            onNoteSelect(null)
          }
        } else {
          addCanvasBreadcrumb('canvas_deselect');
          onNoteSelect(null)
        }
      } catch (error) {
        captureCanvasError(error as Error, {
          canvasId: 'main',
          noteCount: notes.length,
          connectionCount: connections.length,
          userAction: 'canvas_click'
        });
        console.warn('Error in canvas click handler:', error)
      }
    }

    const handleDoubleClick = (e: any) => {
      try {
        addUserActionBreadcrumb('canvas_double_click');
        
        if (!e.target) {
          const pointer = canvas.getPointer(e.e)
          addCanvasBreadcrumb('note_create', { 
            x: pointer.x, 
            y: pointer.y,
            noteCount: notes.length 
          });
          onNoteCreate({ x: pointer.x, y: pointer.y })
        }
      } catch (error) {
        captureCanvasError(error as Error, {
          canvasId: 'main',
          noteCount: notes.length,
          connectionCount: connections.length,
          userAction: 'double_click_create'
        });
        console.warn('Error in double click handler:', error)
      }
    }

    const handleObjectMoving = (e: any) => {
      try {
        const target = e.target
        if (target && target.get('noteId')) {
          const noteId = target.get('noteId') as string
          addCanvasBreadcrumb('note_move', { noteId });
          debouncedNoteUpdate({
            id: noteId,
            x: target.left || 0,
            y: target.top || 0,
          })
        }
      } catch (error) {
        captureCanvasError(error as Error, {
          canvasId: 'main',
          noteCount: notes.length,
          connectionCount: connections.length,
          userAction: 'note_move'
        });
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
      // Déterminer la couleur de bordure selon l'état
      let strokeColor = '#e5e7eb'
      let strokeWidth = 1
      
      if (selectedNoteId === note.id) {
        strokeColor = '#3b82f6'
        strokeWidth = 2
      } else if (isConnecting && connectingFromId === note.id) {
        strokeColor = '#10b981'
        strokeWidth = 3
      } else if (isConnecting) {
        strokeColor = '#f59e0b'
        strokeWidth = 2
      }

      const rect = new fabric.Rect({
        left: note.x,
        top: note.y,
        width: note.width,
        height: note.height,
        fill: note.backgroundColor,
        stroke: strokeColor,
        strokeWidth: strokeWidth,
        cornerSize: 8,
        cornerStyle: 'circle',
        transparentCorners: false,
        cornerColor: '#3b82f6',
        rx: 8,
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
      text.set('noteId', note.id)

      // S'assurer que le contenu n'est pas vide ou juste des espaces
      const displayContent = note.content?.trim() || 'Cliquez pour éditer...'
      const truncatedContent = displayContent.slice(0, 100) + (displayContent.length > 100 ? '...' : '')
      
      const contentText = new fabric.Text(truncatedContent, {
        left: note.x + 16,
        top: note.y + 44,
        width: note.width - 32,
        fontSize: 12,
        fontFamily: 'Inter, system-ui, sans-serif',
        fill: '#4b5563',
        selectable: false,
        evented: false,
        lineHeight: 1.4,
        splitByGrapheme: true,
      })
      contentText.set('noteId', note.id)

      canvas.add(rect, text, contentText)
    })

    canvas.renderAll()
  }, [notes, selectedNoteId, isReady, isConnecting, connectingFromId])

  const handleZoomIn = () => {
    const newZoom = Math.min(3, zoom + 0.2)
    setZoom(newZoom)
    if (fabricCanvasRef.current) {
      const canvas = fabricCanvasRef.current
      const center = canvas.getCenter()
      canvas.zoomToPoint(new fabric.Point(center.left, center.top), newZoom)
    }
  }

  const handleZoomOut = () => {
    const newZoom = Math.max(0.1, zoom - 0.2)
    setZoom(newZoom)
    if (fabricCanvasRef.current) {
      const canvas = fabricCanvasRef.current
      const center = canvas.getCenter()
      canvas.zoomToPoint(new fabric.Point(center.left, center.top), newZoom)
    }
  }

  const handleResetZoom = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
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

      {/* Indicateur de mode connexion */}
      {isConnecting && (
        <div className="absolute top-4 left-4 z-20 pointer-events-none">
          <div className="bg-orange-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center space-x-2">
            <span>🔗</span>
            <span className="text-sm">
              {connectingFromId 
                ? 'Cliquez sur une note pour la connecter' 
                : 'Cliquez sur la première note à connecter'
              }
            </span>
          </div>
        </div>
      )}

      {/* Indicateur de navigation */}
      {!isConnecting && (
        <div className="absolute bottom-4 left-4 z-20 pointer-events-none">
          <div className="bg-gray-800 text-white px-3 py-2 rounded-lg shadow-lg text-xs">
            <div>🖱️ <strong>Alt + drag</strong> : déplacer</div>
            <div>⚪ <strong>Ctrl + molette</strong> : zoomer</div>
          </div>
        </div>
      )}
      
      <ConnectionManager
        connections={connections}
        notes={notes}
        fabricCanvas={fabricCanvasRef.current}
        isConnecting={isConnecting}
        connectingFromId={connectingFromId}
        onConnectionCreate={() => {}} // TODO: Implémenter
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