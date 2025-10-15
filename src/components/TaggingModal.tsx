'use client'

import { useState, useEffect } from 'react'
import { NoteData } from '@/types'
import { X, Plus, Tag, Search, Info } from 'lucide-react'
import { ICT_TRADING_CONCEPTS } from '@/lib/ict-concepts'

interface Concept {
  id: string
  name: string
  category?: string
  definition?: string
  color: string
}

interface TaggingModalProps {
  isOpen: boolean
  note: NoteData | null
  onClose: () => void
  onAddConcept: (noteId: string, conceptName: string, category?: string) => void
  onRemoveConcept: (noteId: string, conceptId: string) => void
}

// Organiser les concepts par catégorie avec couleurs
const CATEGORY_COLORS = {
  'Structure & Cassures': '#e74c3c',
  'Liquidité': '#3498db', 
  'Inefficiences & Arrays': '#f39c12',
  'Niveaux & Zones': '#2ecc71',
  'Sessions & Timing': '#9b59b6'
}

// Convertir les concepts ICT en format utilisable
const TRADING_CONCEPTS_BY_CATEGORY = Object.entries(ICT_TRADING_CONCEPTS).reduce((acc, [name, data]) => {
  const category = data.category
  if (!acc[category]) {
    acc[category] = []
  }
  acc[category].push({
    name,
    definition: data.definition,
    color: CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] || '#6b7280'
  })
  return acc
}, {} as Record<string, Array<{name: string, definition: string, color: string}>>)

export default function TaggingModal({ 
  isOpen, 
  note, 
  onClose, 
  onAddConcept,
  onRemoveConcept
}: TaggingModalProps) {
  const [activeCategory, setActiveCategory] = useState<string>('Structure & Cassures')
  const [searchTerm, setSearchTerm] = useState('')
  const [newConceptName, setNewConceptName] = useState('')
  const [selectedConcepts, setSelectedConcepts] = useState<string[]>([])
  const [hoveredConcept, setHoveredConcept] = useState<string | null>(null)

  useEffect(() => {
    if (note) {
      // TODO: Charger les concepts existants de la note depuis l'API
      setSelectedConcepts([])
    }
  }, [note])

  if (!isOpen || !note) return null

  const categories = Object.keys(TRADING_CONCEPTS_BY_CATEGORY)
  const currentConcepts = TRADING_CONCEPTS_BY_CATEGORY[activeCategory] || []
  
  const filteredConcepts = currentConcepts.filter(concept =>
    concept.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    concept.definition.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleAddConcept = (conceptName: string, category: string) => {
    if (!selectedConcepts.includes(conceptName)) {
      onAddConcept(note.id, conceptName, category)
      setSelectedConcepts(prev => [...prev, conceptName])
    }
  }

  const handleRemoveConcept = (conceptName: string) => {
    onRemoveConcept(note.id, conceptName)
    setSelectedConcepts(prev => prev.filter(name => name !== conceptName))
  }

  const handleCreateCustomConcept = () => {
    if (newConceptName.trim()) {
      handleAddConcept(newConceptName.trim(), activeCategory)
      setNewConceptName('')
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-2xl w-[800px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-800 flex items-center">
              <Tag className="w-5 h-5 mr-2 text-purple-600" />
              Concepts ICT / Smart Money
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Note : {note.title}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Concepts sélectionnés */}
        {selectedConcepts.length > 0 && (
          <div className="p-4 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Concepts assignés :</h3>
            <div className="flex flex-wrap gap-2">
              {selectedConcepts.map((conceptName) => {
                const concept = Object.values(TRADING_CONCEPTS_BY_CATEGORY).flat().find(c => c.name === conceptName)
                return (
                  <span
                    key={conceptName}
                    className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: concept?.color || '#6b7280' }}
                  >
                    {conceptName}
                    <button
                      onClick={() => handleRemoveConcept(conceptName)}
                      className="ml-2 hover:bg-black hover:bg-opacity-20 rounded-full p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* Categories */}
        <div className="flex border-b border-gray-200 overflow-x-auto">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`flex-shrink-0 py-3 px-4 text-sm font-medium transition-colors border-b-2 ${
                activeCategory === category
                  ? 'border-purple-500 text-purple-600 bg-purple-50'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
              style={{
                borderBottomColor: activeCategory === category 
                  ? CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] 
                  : 'transparent'
              }}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Rechercher un concept ou dans les définitions..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Concepts List */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-3">
            {filteredConcepts.map((concept) => {
              const isSelected = selectedConcepts.includes(concept.name)
              const isHovered = hoveredConcept === concept.name
              
              return (
                <div
                  key={concept.name}
                  onMouseEnter={() => setHoveredConcept(concept.name)}
                  onMouseLeave={() => setHoveredConcept(null)}
                  className={`p-4 rounded-lg border-2 transition-all cursor-pointer ${
                    isSelected
                      ? 'border-purple-400 bg-purple-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => 
                    isSelected 
                      ? handleRemoveConcept(concept.name)
                      : handleAddConcept(concept.name, activeCategory)
                  }
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center mb-2">
                        <div 
                          className="w-3 h-3 rounded-full mr-3"
                          style={{ backgroundColor: concept.color }}
                        />
                        <span className={`font-semibold ${
                          isSelected ? 'text-purple-700' : 'text-gray-800'
                        }`}>
                          {concept.name}
                        </span>
                      </div>
                      
                      {(isHovered || isSelected) && (
                        <div className="mt-2 pl-6">
                          <p className="text-sm text-gray-600 leading-relaxed">
                            {concept.definition}
                          </p>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      {isSelected && (
                        <span className="text-xs text-purple-600 font-medium">
                          Sélectionné
                        </span>
                      )}
                      <Info className="w-4 h-4 text-gray-400" />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Créer un nouveau concept */}
          <div className="mt-6 p-4 border-2 border-dashed border-gray-300 rounded-lg">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Créer un concept personnalisé :</h4>
            <div className="flex space-x-2">
              <input
                type="text"
                value={newConceptName}
                onChange={(e) => setNewConceptName(e.target.value)}
                placeholder={`Nouveau concept ${activeCategory}...`}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                onKeyPress={(e) => e.key === 'Enter' && handleCreateCustomConcept()}
              />
              <button
                onClick={handleCreateCustomConcept}
                disabled={!newConceptName.trim()}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200">
          <div className="text-sm text-gray-500">
            {filteredConcepts.length} concept{filteredConcepts.length > 1 ? 's' : ''} disponible{filteredConcepts.length > 1 ? 's' : ''}
          </div>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}