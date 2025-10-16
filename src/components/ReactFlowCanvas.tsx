'use client'

import { useCallback, useEffect, useState, useMemo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  Node,
  Edge,
  Connection,
  NodeTypes,
  BackgroundVariant,
  NodeChange,
  EdgeChange,
  ConnectionMode,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { NoteData, ConnectionData } from '@/types'
import NoteNode from './NoteNode'
import { edgeTypes } from './CustomEdges'
import { Copy, Share2, Sun, Moon } from 'lucide-react'

interface ReactFlowCanvasProps {
  notes: NoteData[]
  connections?: ConnectionData[]
  courses?: Array<{id: string, name: string}>
  instructors?: Array<{id: string, name: string}>
  onNoteUpdate: (note: Partial<NoteData> & { id: string }) => void
  onNoteCreate: (position: { x: number; y: number }, elementType?: string) => void
  onNoteSelect: (noteId: string | null) => void
  onNoteConnectionClick?: (noteId: string) => void
  onConnectionCreate?: (connection: { source: string; target: string }) => void
  onNoteDelete?: (noteId: string) => void
  onNoteDoubleClick?: (noteId: string) => void
  onNoteGroupSelect?: (noteId: string) => void
  onNoteTagClick?: (noteId: string) => void
  selectedNoteId?: string
  selectedNotes?: string[]
  isConnecting?: boolean
  connectingFromId?: string
  isGroupSelecting?: boolean
  isTagging?: boolean
}

// Types de nœuds personnalisés
const nodeTypes: NodeTypes = {
  noteNode: NoteNode,
}

export default function ReactFlowCanvas({
  notes,
  connections = [],
  courses = [],
  instructors = [],
  onNoteUpdate,
  onNoteCreate,
  onNoteSelect,
  onNoteConnectionClick,
  onConnectionCreate,
  onNoteDelete,
  onNoteDoubleClick,
  onNoteGroupSelect,
  onNoteTagClick,
  selectedNoteId,
  selectedNotes = [],
  isConnecting = false,
  connectingFromId,
  isGroupSelecting = false,
  isTagging = false
}: ReactFlowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null)
  
  // Gestion du thème pour React Flow et toggle
  const { theme, toggleTheme } = useTheme()
  const [backgroundGridColor, setBackgroundGridColor] = useState('#e2e8f0')
  
  // Mettre à jour la couleur de la grille selon le thème
  useEffect(() => {
    setBackgroundGridColor(theme === 'dark' ? '#334155' : '#e2e8f0')
  }, [theme])

  // Convertir les notes en nodes React Flow
  const convertNotesToNodes = useCallback((notesList: NoteData[]): Node[] => {
    return notesList.map((note) => {
      // Enrichir avec les données de course et instructor
      const course = courses.find(c => c.id === note.courseId)
      const instructor = instructors.find(i => i.id === note.instructorId)
      
      // Récupérer les concepts réels de la note
      const noteConcepts = note.concepts ? note.concepts.map(nc => nc.concept.name) : []
      
      return {
        id: note.id,
        type: 'noteNode',
        position: { x: note.x, y: note.y },
        data: {
          ...note,
          // Données enrichies
          courseName: course?.name,
          instructorName: instructor?.name,
          concepts: noteConcepts,
          // États et handlers
          isSelected: selectedNoteId === note.id,
          isGroupSelected: selectedNotes.includes(note.id),
          isConnecting: isConnecting,
          isConnectingFrom: connectingFromId === note.id,
          isGroupSelecting: isGroupSelecting,
          isTagging: isTagging,
          onEdit: (noteId: string) => onNoteSelect(noteId),
          onDelete: onNoteDelete || ((noteId: string) => {
            console.log('Delete note:', noteId)
          }),
          onDoubleClick: onNoteDoubleClick,
          onGroupSelect: onNoteGroupSelect,
          onTagClick: onNoteTagClick,
          onResize: (noteId: string, width: number, height: number) => {
            onNoteUpdate({ id: noteId, width, height })
          },
        },
        dragHandle: '.drag-handle',
      }
    })
  }, [selectedNoteId, selectedNotes, isConnecting, connectingFromId, isGroupSelecting, isTagging, onNoteSelect, onNoteDelete, onNoteDoubleClick, onNoteGroupSelect, onNoteTagClick, courses, instructors])

  // Convertir les connexions en edges React Flow
  const convertConnectionsToEdges = useCallback((connectionsList: ConnectionData[]): Edge[] => {
    return connectionsList.map((connection) => {
      // Déterminer le type d'edge selon le style ou d'autres critères
      let edgeType = 'standard'
      if (connection.style === 'animated' || connection.color === '#3b82f6') {
        edgeType = 'animated'
      } else if (connection.style === 'temporary' || connection.color === '#f59e0b') {
        edgeType = 'temporary'
      }

      return {
        id: connection.id,
        source: connection.fromId,
        target: connection.toId,
        type: edgeType,
        markerEnd: {
          type: 'arrowclosed',
          color: connection.color || '#6b7280',
        },
      }
    })
  }, [])

  // Mettre à jour les nodes quand les notes changent
  useEffect(() => {
    const newNodes = convertNotesToNodes(notes)
    setNodes(newNodes)
  }, [notes, convertNotesToNodes, setNodes])

  // Mettre à jour les edges quand les connexions changent
  useEffect(() => {
    const newEdges = convertConnectionsToEdges(connections)
    setEdges(newEdges)
  }, [connections, convertConnectionsToEdges, setEdges])

  // Gérer les changements de position des nodes - Optimisé pour performance
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    // Appliquer les changements immédiatement à React Flow
    onNodesChange(changes)
    
    // Batching des updates de position pour éviter les calls API excessifs
    const positionChanges = changes.filter(
      (change): change is NodeChange & { type: 'position'; position: { x: number; y: number } } => 
        change.type === 'position' && change.position !== undefined && change.id !== undefined
    )
    
    if (positionChanges.length > 0) {
      // Utiliser requestAnimationFrame pour optimiser les updates
      requestAnimationFrame(() => {
        positionChanges.forEach((change) => {
          onNoteUpdate({
            id: change.id!,
            x: change.position!.x,
            y: change.position!.y,
          })
        })
      })
    }
  }, [onNodesChange, onNoteUpdate])

  // Gérer la sélection des nodes
  const handleNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    event.stopPropagation()
    if (isConnecting && onNoteConnectionClick) {
      onNoteConnectionClick(node.id)
    } else if (isGroupSelecting && onNoteGroupSelect) {
      onNoteGroupSelect(node.id)
    } else if (isTagging && onNoteTagClick) {
      onNoteTagClick(node.id)
    } else {
      onNoteSelect(node.id)
    }
  }, [isConnecting, isGroupSelecting, isTagging, onNoteConnectionClick, onNoteGroupSelect, onNoteTagClick, onNoteSelect])

  // Gérer la création de connexions
  const onConnect = useCallback((params: Connection) => {
    if (params.source && params.target && onConnectionCreate) {
      onConnectionCreate({
        source: params.source,
        target: params.target
      })
    }
  }, [onConnectionCreate])

  // Gérer le clic sur le canvas vide
  const handlePaneClick = useCallback((event: React.MouseEvent) => {
    if (!reactFlowInstance) return

    // Si on n'est pas en mode connexion, déselectionner
    if (!isConnecting) {
      onNoteSelect(null)
    }

    // Double-clic pour créer une nouvelle note
    if (event.detail === 2) {
      const bounds = (event.target as HTMLElement).getBoundingClientRect()
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      })
      onNoteCreate(position)
    }
  }, [reactFlowInstance, isConnecting, onNoteSelect, onNoteCreate])

  // Gérer le drag & drop depuis la sidebar
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!reactFlowInstance) return

    const elementType = e.dataTransfer.getData('text/plain')
    if (elementType) {
      const bounds = (e.target as HTMLElement).getBoundingClientRect()
      const position = reactFlowInstance.screenToFlowPosition({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      })
      onNoteCreate(position, elementType)
    }
  }, [reactFlowInstance, onNoteCreate])

  const minimapStyle = {
    height: 120,
    backgroundColor: 'var(--canvas-bg)',
    border: '1px solid var(--border)'
  }

  return (
    <div 
      className="w-full h-full theme-transition" 
      style={{ backgroundColor: 'var(--canvas-bg)' }}
      onDragOver={handleDragOver} 
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onInit={setReactFlowInstance}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.1}
        maxZoom={2}
        snapToGrid={true}
        snapGrid={[15, 15]}
        attributionPosition="bottom-left"
        proOptions={{
          hideAttribution: true
        }}
        nodesDraggable={true}
        nodesConnectable={true}
        elementsSelectable={true}
      >
        <Background 
          variant={BackgroundVariant.Dots} 
          gap={20} 
          size={1}
          color={backgroundGridColor}
        />
        <Controls 
          position="bottom-right"
          showZoom={true}
          showFitView={true}
          showInteractive={false}
        />
        <MiniMap
          style={minimapStyle}
          zoomable
          pannable
          position="bottom-left"
        />
        
        {/* Panel top-left supprimé - Interface nettoyée */}
        
        {/* Nouveau Panel top-right avec actions essentielles */}
        <Panel position="top-right">
          <div className="flex space-x-2">
            {/* Bouton Copier URL */}
            <button
              className="p-2 bg-card rounded-lg shadow-md border border-border hover:bg-muted transition-colors"
              title="Copier l'URL du canvas"
              onClick={() => {
                navigator.clipboard.writeText(window.location.href)
                // TODO: Ajouter notification de succès
                console.log('URL copiée')
              }}
            >
              <Copy className="w-4 h-4 text-foreground" />
            </button>
            
            {/* Bouton Partager */}
            <button
              className="p-2 bg-card rounded-lg shadow-md border border-border hover:bg-muted transition-colors"
              title="Partager le canvas"
              onClick={() => {
                if (navigator.share) {
                  navigator.share({
                    title: 'Mon Canvas de Notes',
                    url: window.location.href
                  })
                } else {
                  // Fallback: copier l'URL
                  navigator.clipboard.writeText(window.location.href)
                  console.log('URL copiée pour partage')
                }
              }}
            >
              <Share2 className="w-4 h-4 text-foreground" />
            </button>
            
            {/* Toggle Dark/Light Mode */}
            <button
              onClick={toggleTheme}
              className="p-2 bg-card rounded-lg shadow-md border border-border hover:bg-muted transition-colors"
              title={theme === 'dark' ? 'Basculer en mode clair' : 'Basculer en mode sombre'}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-foreground" />
              ) : (
                <Moon className="w-4 h-4 text-foreground" />
              )}
            </button>
          </div>
        </Panel>
      </ReactFlow>

      {/* Indicateur de mode connexion amélioré */}
      {isConnecting && (
        <div className="absolute top-4 left-4 z-50 pointer-events-none">
          <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center space-x-3 animate-pulse border border-orange-400">
            <div className="w-3 h-3 bg-white rounded-full animate-ping"></div>
            <span className="text-sm font-medium">
              {connectingFromId 
                ? '🎯 Cliquez sur une note pour créer la connexion' 
                : '🔗 Sélectionnez la première note à connecter'
              }
            </span>
            {connectingFromId && (
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}