'use client'

import { useState, useEffect } from 'react'
import { NoteData } from '@/types'
import { X, Plus, Tag, Search } from 'lucide-react'

interface Concept {
  id: string
  name: string
  category?: string
  color: string
}

interface TaggingModalProps {
  isOpen: boolean
  note: NoteData | null
  onClose: () => void
  onAddConcept: (noteId: string, conceptName: string, category?: string) => void
  onRemoveConcept: (noteId: string, conceptId: string) => void
}

// Concepts prédéfinis par catégorie
const PREDEFINED_CONCEPTS = {
  'ICT': [
    { name: 'HTML', color: '#e34c26' },
    { name: 'CSS', color: '#1572b6' },
    { name: 'JavaScript', color: '#f7df1e' },
    { name: 'React', color: '#61dafb' },
    { name: 'Node.js', color: '#339933' },
    { name: 'Database', color: '#336791' },
    { name: 'API', color: '#ff6b6b' },
    { name: 'Framework', color: '#4ecdc4' },
  ],
  'Smart Money': [
    { name: 'Investissement', color: '#2ecc71' },
    { name: 'Trading', color: '#e74c3c' },
    { name: 'Crypto', color: '#f39c12' },
    { name: 'Épargne', color: '#3498db' },
    { name: 'Budget', color: '#9b59b6' },
    { name: 'Immobilier', color: '#34495e' },
    { name: 'Actions', color: '#e67e22' },
    { name: 'Analyse', color: '#1abc9c' },
  ],
  'Général': [
    { name: 'Important', color: '#e74c3c' },
    { name: 'À réviser', color: '#f39c12' },
    { name: 'Compris', color: '#2ecc71' },
    { name: 'Difficile', color: '#e67e22' },
    { name: 'Exemples', color: '#3498db' },
    { name: 'Définition', color: '#9b59b6' },
    { name: 'Méthode', color: '#34495e' },
    { name: 'Théorie', color: '#95a5a6' },
  ]
}

export default function TaggingModal({ 
  isOpen, 
  note, 
  onClose, 
  onAddConcept,
  onRemoveConcept
}: TaggingModalProps) {
  const [activeCategory, setActiveCategory] = useState<string>('ICT')
  const [searchTerm, setSearchTerm] = useState('')
  const [newConceptName, setNewConceptName] = useState('')
  const [selectedConcepts, setSelectedConcepts] = useState<string[]>([])

  useEffect(() => {
    if (note) {
      // TODO: Charger les concepts existants de la note depuis l'API
      setSelectedConcepts([])
    }
  }, [note])

  if (!isOpen || !note) return null

  const categories = Object.keys(PREDEFINED_CONCEPTS)
  const currentConcepts = PREDEFINED_CONCEPTS[activeCategory as keyof typeof PREDEFINED_CONCEPTS] || []
  
  const filteredConcepts = currentConcepts.filter(concept =>
    concept.name.toLowerCase().includes(searchTerm.toLowerCase())
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
      <div className="bg-white rounded-lg shadow-2xl w-[700px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-800 flex items-center">
              <Tag className="w-5 h-5 mr-2 text-purple-600" />
              Gestion des concepts
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
                const concept = Object.values(PREDEFINED_CONCEPTS).flat().find(c => c.name === conceptName)
                return (
                  <span
                    key={conceptName}
                    className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: concept?.color || '#6b7280' }}
                  >
                    {conceptName}
                    <button
                      onClick={() => handleRemoveConcept(conceptName)}
                      className="ml-1 hover:bg-black hover:bg-opacity-20 rounded-full p-0.5"
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
        <div className="flex border-b border-gray-200">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
                activeCategory === category
                  ? 'border-b-2 border-purple-500 text-purple-600 bg-purple-50'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
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
              placeholder="Rechercher un concept..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Concepts List */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            {filteredConcepts.map((concept) => {
              const isSelected = selectedConcepts.includes(concept.name)
              return (
                <button
                  key={concept.name}
                  onClick={() => 
                    isSelected 
                      ? handleRemoveConcept(concept.name)
                      : handleAddConcept(concept.name, activeCategory)
                  }
                  className={`p-3 rounded-lg border-2 transition-all text-left ${
                    isSelected
                      ? 'border-purple-400 bg-purple-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center">
                    <div 
                      className="w-3 h-3 rounded-full mr-2"
                      style={{ backgroundColor: concept.color }}
                    />
                    <span className={`text-sm font-medium ${
                      isSelected ? 'text-purple-700' : 'text-gray-700'
                    }`}>
                      {concept.name}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Créer un nouveau concept */}
          <div className="mt-6 p-4 border-2 border-dashed border-gray-300 rounded-lg">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Créer un nouveau concept :</h4>
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
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}