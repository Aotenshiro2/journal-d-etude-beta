'use client'

import { useState, useRef, useEffect } from 'react'

interface SidebarProps {
  onElementDrop: (elementType: string, position: { x: number; y: number }) => void
  isConnecting?: boolean
  onToggleConnectionMode?: () => void
}

const SIDEBAR_ITEMS = [
  {
    id: 'note',
    name: 'Note',
    icon: '📝',
    description: 'Créer une note',
    color: '#fef3c7'
  },
  {
    id: 'concept',
    name: 'Concept',
    icon: '💡',
    description: 'Concept ICT',
    color: '#dbeafe'
  },
  {
    id: 'arrow',
    name: 'Flèche',
    icon: '↗️',
    description: 'Connexion directionnelle',
    color: 'transparent'
  },
  {
    id: 'shape-rect',
    name: 'Rectangle',
    icon: '⬜',
    description: 'Forme rectangle',
    color: '#e0e7ff'
  },
  {
    id: 'shape-circle',
    name: 'Cercle',
    icon: '⭕',
    description: 'Forme cercle',
    color: '#d1fae5'
  }
]

export default function Sidebar({ 
  onElementDrop, 
  isConnecting = false, 
  onToggleConnectionMode 
}: SidebarProps) {
  const [draggedItem, setDraggedItem] = useState<string | null>(null)
  const [position, setPosition] = useState({ x: 20, y: 100 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const sidebarRef = useRef<HTMLDivElement>(null)

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggedItem(itemId)
    e.dataTransfer.setData('text/plain', itemId)
    e.dataTransfer.effectAllowed = 'copy'
    
    // Créer une image de preview personnalisée
    const dragImage = document.createElement('div')
    dragImage.style.padding = '8px 12px'
    dragImage.style.backgroundColor = '#3b82f6'
    dragImage.style.color = 'white'
    dragImage.style.borderRadius = '6px'
    dragImage.style.fontSize = '12px'
    dragImage.style.position = 'absolute'
    dragImage.style.top = '-1000px'
    dragImage.textContent = SIDEBAR_ITEMS.find(item => item.id === itemId)?.name || ''
    
    document.body.appendChild(dragImage)
    e.dataTransfer.setDragImage(dragImage, 0, 0)
    
    setTimeout(() => document.body.removeChild(dragImage), 0)
  }

  const handleDragEnd = () => {
    setDraggedItem(null)
  }

  // Gestion du déplacement de la sidebar
  const handleMouseDown = (e: React.MouseEvent) => {
    if (sidebarRef.current) {
      const rect = sidebarRef.current.getBoundingClientRect()
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      })
      setIsDragging(true)
    }
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      })
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragOffset])

  return (
    <div 
      ref={sidebarRef}
      className={`
        fixed bg-white rounded-2xl shadow-2xl border border-gray-200 z-30 
        transition-all duration-300 select-none w-20 h-auto
        ${isDragging ? 'shadow-3xl scale-105' : 'hover:shadow-xl'}
      `}
      style={{
        left: position.x,
        top: position.y
      }}
    >
      {/* Header avec zone de drag dédiée */}
      <div 
        className="p-3 border-b border-gray-100 flex items-center justify-center cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <div className="flex space-x-1">
          <div className="w-1 h-4 bg-gray-400 rounded-full"></div>
          <div className="w-1 h-4 bg-gray-400 rounded-full"></div>
          <div className="w-1 h-4 bg-gray-400 rounded-full"></div>
        </div>
      </div>

      {/* Outil de connexion */}
      <div className="px-3 pb-3">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleConnectionMode?.()
          }}
          className={`
            w-full flex items-center justify-center p-3 rounded-xl border-2 border-dashed transition-all duration-200
            ${isConnecting 
              ? 'border-blue-400 bg-blue-50 text-blue-700 shadow-md' 
              : 'border-gray-300 hover:border-blue-400 hover:bg-blue-25'
            }
          `}
          title="Mode connexion"
        >
          <span className={`text-lg transition-transform ${isConnecting ? 'scale-110' : ''}`}>
            🔗
          </span>
        </button>
      </div>

      {/* Liste des éléments */}
      <div className="px-3 pb-3 space-y-2 overflow-y-auto">
        {SIDEBAR_ITEMS.map((item) => (
          <div
            key={item.id}
            draggable
            onDragStart={(e) => {
              e.stopPropagation()
              handleDragStart(e, item.id)
            }}
            onDragEnd={handleDragEnd}
            className={`
              flex items-center justify-center p-3 rounded-xl border-2 border-dashed border-gray-300
              hover:border-gray-400 hover:shadow-md cursor-grab active:cursor-grabbing
              transition-all duration-200 group bg-white
              ${draggedItem === item.id ? 'opacity-50 scale-95' : 'hover:scale-105'}
            `}
            title={`${item.name}: ${item.description}`}
          >
            <span 
              className="text-lg group-hover:scale-110 transition-transform"
              style={{ 
                backgroundColor: item.color !== 'transparent' ? item.color : 'transparent',
                padding: item.color !== 'transparent' ? '6px' : '0',
                borderRadius: item.color !== 'transparent' ? '6px' : '0'
              }}
            >
              {item.icon}
            </span>
            
          </div>
        ))}
      </div>

    </div>
  )
}