'use client'

import { useState } from 'react'

interface SidebarProps {
  onElementDrop: (elementType: string, position: { x: number; y: number }) => void
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

const SIDEBAR_ITEMS = [
  {
    id: 'note',
    name: 'Note',
    icon: '📝',
    description: 'Note de cours classique',
    color: '#ffffff'
  },
  {
    id: 'text',
    name: 'Texte libre',
    icon: '📄',
    description: 'Texte sans cadre',
    color: 'transparent'
  },
  {
    id: 'image',
    name: 'Image',
    icon: '🖼️',
    description: 'Uploader une image',
    color: '#f3f4f6'
  },
  {
    id: 'concept',
    name: 'Concept',
    icon: '💡',
    description: 'Bloc concept ICT',
    color: '#fef3c7'
  },
  {
    id: 'arrow',
    name: 'Flèche',
    icon: '↗️',
    description: 'Connexion entre éléments',
    color: 'transparent'
  },
  {
    id: 'shape-rect',
    name: 'Rectangle',
    icon: '⬜',
    description: 'Forme géométrique',
    color: '#dbeafe'
  },
  {
    id: 'shape-circle',
    name: 'Cercle',
    icon: '⭕',
    description: 'Forme géométrique',
    color: '#d1fae5'
  },
  {
    id: 'sticky',
    name: 'Post-it',
    icon: '🟡',
    description: 'Note rapide',
    color: '#fef3c7'
  }
]

export default function Sidebar({ onElementDrop, isCollapsed = false, onToggleCollapse }: SidebarProps) {
  const [draggedItem, setDraggedItem] = useState<string | null>(null)

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

  return (
    <div className={`fixed left-0 top-16 h-[calc(100vh-64px)] bg-white border-r border-gray-200 z-30 transition-all duration-300 ${
      isCollapsed ? 'w-16' : 'w-64'
    }`}>
      {/* Header avec bouton collapse */}
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        {!isCollapsed && (
          <h2 className="text-sm font-semibold text-gray-800">Éléments</h2>
        )}
        <button
          onClick={onToggleCollapse}
          className="p-1 rounded hover:bg-gray-100 transition-colors"
          title={isCollapsed ? 'Développer' : 'Réduire'}
        >
          <span className="text-gray-500">
            {isCollapsed ? '→' : '←'}
          </span>
        </button>
      </div>

      {/* Liste des éléments */}
      <div className="p-2 space-y-2 overflow-y-auto h-full">
        {SIDEBAR_ITEMS.map((item) => (
          <div
            key={item.id}
            draggable
            onDragStart={(e) => handleDragStart(e, item.id)}
            onDragEnd={handleDragEnd}
            className={`
              flex items-center p-3 rounded-lg border-2 border-dashed border-gray-200 
              hover:border-blue-300 hover:bg-blue-50 cursor-grab active:cursor-grabbing
              transition-all duration-200 group
              ${draggedItem === item.id ? 'opacity-50' : ''}
              ${isCollapsed ? 'justify-center' : ''}
            `}
            style={{ backgroundColor: item.color }}
            title={isCollapsed ? `${item.name}: ${item.description}` : undefined}
          >
            <span className="text-lg mr-3 group-hover:scale-110 transition-transform">
              {item.icon}
            </span>
            
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {item.name}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {item.description}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Instructions en bas */}
      {!isCollapsed && (
        <div className="absolute bottom-4 left-4 right-4 p-3 bg-gray-50 rounded-lg border">
          <div className="text-xs text-gray-600">
            💡 <strong>Astuce :</strong> Glissez-déposez les éléments sur le canvas pour les créer
          </div>
        </div>
      )}
    </div>
  )
}