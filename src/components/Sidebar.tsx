'use client'

import { useState, useRef, useEffect } from 'react'
import { ICT_TRADING_CONCEPTS } from '@/lib/ict-concepts'
import { Eye, Edit, Search, Tag, BookOpen, Users, Activity } from 'lucide-react'

interface SidebarProps {
  onElementDrop: (elementType: string, position: { x: number; y: number }) => void
  isConnecting?: boolean
  onToggleConnectionMode?: () => void
  isGroupSelecting?: boolean
  onToggleGroupSelection?: () => void
  isTagging?: boolean
  onToggleTaggingMode?: () => void
}

const SIDEBAR_ITEMS = [
  {
    id: 'note',
    name: 'Note',
    icon: '📝',
    description: 'Créer une note',
    color: '#fef3c7'
  }
]

// Organiser les concepts par catégorie avec couleurs
const CATEGORY_COLORS = {
  'Structure & Cassures': '#e74c3c',
  'Liquidité': '#3498db', 
  'Inefficiences & Arrays': '#f39c12',
  'Niveaux & Zones': '#2ecc71',
  'Sessions & Timing': '#9b59b6'
}

// Convertir les concepts ICT en format utilisable avec statistiques simulées
const TRADING_CONCEPTS_BY_CATEGORY = Object.entries(ICT_TRADING_CONCEPTS).reduce((acc, [name, data]) => {
  const category = data.category
  if (!acc[category]) {
    acc[category] = []
  }
  acc[category].push({
    name,
    definition: data.definition,
    color: CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] || '#6b7280',
    // Simuler quelques statistiques pour la démo
    usageCount: Math.floor(Math.random() * 50) + 1,
    lastUsed: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // 30 derniers jours
    trend: Math.random() > 0.5 ? 'up' : 'down'
  })
  return acc
}, {} as Record<string, Array<{name: string, definition: string, color: string, usageCount: number, lastUsed: Date, trend: string}>>)

export default function Sidebar({ 
  onElementDrop, 
  isConnecting = false, 
  onToggleConnectionMode,
  isGroupSelecting = false,
  onToggleGroupSelection,
  isTagging = false,
  onToggleTaggingMode
}: SidebarProps) {
  const [draggedItem, setDraggedItem] = useState<string | null>(null)
  const [position, setPosition] = useState({ x: 20, y: 100 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [activeTab, setActiveTab] = useState<'elements' | 'concepts'>('elements')
  const [conceptsMode, setConceptsMode] = useState<'overview' | 'edit'>('overview')
  const [selectedCategory, setSelectedCategory] = useState<string>('Structure & Cassures')
  const [searchTerm, setSearchTerm] = useState('')
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

  // Filtrer les concepts selon la recherche
  const filteredConcepts = TRADING_CONCEPTS_BY_CATEGORY[selectedCategory]?.filter(concept =>
    concept.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    concept.definition.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  // Statistiques globales pour le mode overview
  const globalStats = {
    totalConcepts: Object.values(TRADING_CONCEPTS_BY_CATEGORY).flat().length,
    totalUsage: Object.values(TRADING_CONCEPTS_BY_CATEGORY).flat().reduce((sum, c) => sum + c.usageCount, 0),
    topConcept: Object.values(TRADING_CONCEPTS_BY_CATEGORY).flat().sort((a, b) => b.usageCount - a.usageCount)[0],
    categories: Object.keys(TRADING_CONCEPTS_BY_CATEGORY).length
  }

  return (
    <div 
      ref={sidebarRef}
      className={`
        fixed rounded-2xl shadow-2xl z-30 
        transition-all duration-300 select-none theme-transition
        ${isDragging ? 'shadow-3xl scale-105' : 'hover:shadow-xl'}
      `}
      style={{
        backgroundColor: 'var(--sidebar-bg)',
        border: '1px solid var(--sidebar-border)',
        left: position.x,
        top: position.y,
        width: activeTab === 'concepts' ? '320px' : '80px',
        maxHeight: '85vh'
      }}
    >
      {/* Header avec zone de drag et onglets */}
      <div className="border-b border-gray-200 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-t-2xl">
        <div 
          className="p-3 flex items-center justify-center cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          <div className="flex space-x-1">
            <div className="w-1 h-4 bg-white/60 rounded-full"></div>
            <div className="w-1 h-4 bg-white/60 rounded-full"></div>
            <div className="w-1 h-4 bg-white/60 rounded-full"></div>
          </div>
        </div>
        
        {/* Onglets */}
        <div className="flex">
          <button
            onClick={() => setActiveTab('elements')}
            className={`flex-1 py-2 px-2 text-xs font-medium transition-colors ${
              activeTab === 'elements' 
                ? 'bg-white text-gray-700' 
                : 'text-white/80 hover:text-white'
            }`}
          >
            <BookOpen className="w-3 h-3 mx-auto" />
            {activeTab === 'elements' && <div className="text-xs mt-1">Outils</div>}
          </button>
          <button
            onClick={() => setActiveTab('concepts')}
            className={`flex-1 py-2 px-2 text-xs font-medium transition-colors ${
              activeTab === 'concepts' 
                ? 'bg-white text-gray-700' 
                : 'text-white/80 hover:text-white'
            }`}
          >
            <Tag className="w-3 h-3 mx-auto" />
            {activeTab === 'concepts' && <div className="text-xs mt-1">ICT</div>}
          </button>
        </div>
      </div>

      {/* Contenu selon l'onglet actif */}
      {activeTab === 'elements' && (
        <div className="px-3 pb-3 space-y-2">
          {/* Outil de connexion */}
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

          {/* Outil de groupement */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleGroupSelection?.()
            }}
            className={`
              w-full flex items-center justify-center p-3 rounded-xl border-2 border-dashed transition-all duration-200
              ${isGroupSelecting 
                ? 'border-orange-400 bg-orange-50 text-orange-700 shadow-md' 
                : 'border-gray-300 hover:border-orange-400 hover:bg-orange-25'
              }
            `}
            title="Mode groupement - Sélectionner des notes pour les grouper"
          >
            <span className={`text-lg transition-transform ${isGroupSelecting ? 'scale-110' : ''}`}>
              🎯
            </span>
          </button>

          {/* Outil de tagging */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleTaggingMode?.()
            }}
            className={`
              w-full flex items-center justify-center p-3 rounded-xl border-2 border-dashed transition-all duration-200
              ${isTagging 
                ? 'border-purple-400 bg-purple-50 text-purple-700 shadow-md' 
                : 'border-gray-300 hover:border-purple-400 hover:bg-purple-25'
              }
            `}
            title="Mode tagging - Ajouter des concepts/tags aux notes"
          >
            <span className={`text-lg transition-transform ${isTagging ? 'scale-110' : ''}`}>
              💡
            </span>
          </button>

          {/* Élément note draggable */}
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
      )}

      {activeTab === 'concepts' && (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Mode selector pour concepts */}
          <div className="p-3 border-b border-gray-200 bg-gray-50">
            <div className="flex space-x-1 bg-gray-200 rounded-lg p-1">
              <button
                onClick={() => setConceptsMode('overview')}
                className={`flex-1 py-2 px-3 text-xs font-medium rounded-md transition-colors ${
                  conceptsMode === 'overview' 
                    ? 'bg-white text-gray-700 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                <Eye className="w-3 h-3 inline mr-1" />
                Vue d'ensemble
              </button>
              <button
                onClick={() => setConceptsMode('edit')}
                className={`flex-1 py-2 px-3 text-xs font-medium rounded-md transition-colors ${
                  conceptsMode === 'edit' 
                    ? 'bg-white text-gray-700 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                <Edit className="w-3 h-3 inline mr-1" />
                Édition
              </button>
            </div>
          </div>

          {/* Contenu selon le mode de concepts */}
          <div className="flex-1 overflow-y-auto">
            {conceptsMode === 'overview' && (
              <div className="p-4 space-y-4">
                {/* Statistiques globales */}
                <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-3 border border-purple-200">
                  <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center">
                    <Activity className="w-4 h-4 mr-2 text-purple-600" />
                    Aperçu Global
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="text-center">
                      <div className="text-lg font-bold text-purple-600">{globalStats.totalConcepts}</div>
                      <div className="text-xs text-gray-600">Concepts</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-blue-600">{globalStats.categories}</div>
                      <div className="text-xs text-gray-600">Catégories</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-green-600">{globalStats.totalUsage}</div>
                      <div className="text-xs text-gray-600">Utilisations</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-orange-600">{globalStats.topConcept?.usageCount || 0}</div>
                      <div className="text-xs text-gray-600">Top concept</div>
                    </div>
                  </div>
                  {globalStats.topConcept && (
                    <div className="mt-3 pt-3 border-t border-purple-200">
                      <div className="text-xs text-gray-600">Concept le plus utilisé :</div>
                      <div className="text-sm font-medium text-gray-800">{globalStats.topConcept.name}</div>
                    </div>
                  )}
                </div>

                {/* Catégories avec statistiques */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-gray-800 flex items-center">
                    <Users className="w-4 h-4 mr-2 text-gray-600" />
                    Catégories
                  </h4>
                  {Object.entries(TRADING_CONCEPTS_BY_CATEGORY).map(([category, concepts]) => {
                    const totalUsage = concepts.reduce((sum, c) => sum + c.usageCount, 0)
                    const avgUsage = Math.round(totalUsage / concepts.length)
                    
                    return (
                      <div
                        key={category}
                        className="p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors cursor-pointer"
                        onClick={() => {
                          setSelectedCategory(category)
                          setConceptsMode('edit')
                        }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center">
                            <div 
                              className="w-3 h-3 rounded-full mr-2"
                              style={{ backgroundColor: CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] }}
                            />
                            <span className="font-medium text-sm text-gray-800">{category}</span>
                          </div>
                          <span className="text-xs text-gray-500">{concepts.length} concepts</span>
                        </div>
                        <div className="flex justify-between text-xs text-gray-600">
                          <span>{totalUsage} utilisations</span>
                          <span>Moy: {avgUsage}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {conceptsMode === 'edit' && (
              <div className="p-4 space-y-4">
                {/* Sélecteur de catégorie */}
                <div>
                  <label className="text-xs font-medium text-gray-700 mb-2 block">Catégorie :</label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full text-xs border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  >
                    {Object.keys(TRADING_CONCEPTS_BY_CATEGORY).map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>

                {/* Recherche */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-3 h-3" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Rechercher..."
                    className="w-full pl-8 pr-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>

                {/* Liste des concepts */}
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {filteredConcepts.map((concept) => (
                    <div
                      key={concept.name}
                      className="p-2 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center mb-1">
                            <div 
                              className="w-2 h-2 rounded-full mr-2 flex-shrink-0"
                              style={{ backgroundColor: concept.color }}
                            />
                            <span className="font-medium text-xs text-gray-800 truncate">{concept.name}</span>
                          </div>
                          <div className="text-xs text-gray-600 line-clamp-2">
                            {concept.definition}
                          </div>
                        </div>
                        <div className="flex flex-col items-end ml-2 flex-shrink-0">
                          <span className="text-xs font-medium text-gray-700">{concept.usageCount}</span>
                          <span className={`text-xs ${concept.trend === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                            {concept.trend === 'up' ? '↗' : '↘'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}