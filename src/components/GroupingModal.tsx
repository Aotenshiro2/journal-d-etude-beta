'use client'

import { useState } from 'react'
import { CourseData, InstructorData } from '@/types'
import { X, Plus, User, BookOpen } from 'lucide-react'

interface GroupingModalProps {
  isOpen: boolean
  selectedNotes: string[]
  courses: CourseData[]
  instructors: InstructorData[]
  onClose: () => void
  onGroupToCourse: (courseId: string) => void
  onCreateCourse: (courseName: string, instructorId?: string) => void
  onCreateInstructor: (instructorName: string) => void
}

export default function GroupingModal({ 
  isOpen, 
  selectedNotes, 
  courses, 
  instructors,
  onClose, 
  onGroupToCourse,
  onCreateCourse,
  onCreateInstructor
}: GroupingModalProps) {
  const [activeTab, setActiveTab] = useState<'existing' | 'new'>('existing')
  const [newCourseName, setNewCourseName] = useState('')
  const [newInstructorName, setNewInstructorName] = useState('')
  const [selectedInstructorId, setSelectedInstructorId] = useState('')

  if (!isOpen) return null

  const handleCreateCourse = () => {
    if (newCourseName.trim()) {
      onCreateCourse(newCourseName.trim(), selectedInstructorId || undefined)
      setNewCourseName('')
      setSelectedInstructorId('')
      onClose()
    }
  }

  const handleCreateInstructor = () => {
    if (newInstructorName.trim()) {
      onCreateInstructor(newInstructorName.trim())
      setNewInstructorName('')
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-2xl w-[600px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              Grouper les notes sélectionnées
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {selectedNotes.length} note{selectedNotes.length > 1 ? 's' : ''} sélectionnée{selectedNotes.length > 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('existing')}
            className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
              activeTab === 'existing'
                ? 'border-b-2 border-blue-500 text-blue-600 bg-blue-50'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <BookOpen className="w-4 h-4 inline mr-2" />
            Formation existante
          </button>
          <button
            onClick={() => setActiveTab('new')}
            className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
              activeTab === 'new'
                ? 'border-b-2 border-blue-500 text-blue-600 bg-blue-50'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <Plus className="w-4 h-4 inline mr-2" />
            Nouvelle formation
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'existing' ? (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-700 mb-3">
                Sélectionnez une formation existante :
              </h3>
              {courses.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <BookOpen className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>Aucune formation disponible</p>
                  <p className="text-sm">Créez une nouvelle formation</p>
                </div>
              ) : (
                courses.map((course) => (
                  <button
                    key={course.id}
                    onClick={() => {
                      onGroupToCourse(course.id)
                      onClose()
                    }}
                    className="w-full p-4 text-left border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-md transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-gray-800">{course.name}</h4>
                        {course.description && (
                          <p className="text-sm text-gray-600 mt-1">{course.description}</p>
                        )}
                        {course.instructor && (
                          <div className="flex items-center mt-2 text-xs text-gray-500">
                            <User className="w-3 h-3 mr-1" />
                            {course.instructor.name}
                          </div>
                        )}
                      </div>
                      <div 
                        className="w-4 h-4 rounded-full border-2 border-gray-300"
                        style={{ backgroundColor: course.color }}
                      />
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nom de la nouvelle formation *
                </label>
                <input
                  type="text"
                  value={newCourseName}
                  onChange={(e) => setNewCourseName(e.target.value)}
                  placeholder="Ex: Développement Web, Base de données..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Formateur (optionnel)
                </label>
                <div className="space-y-2">
                  <select
                    value={selectedInstructorId}
                    onChange={(e) => setSelectedInstructorId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Aucun formateur assigné</option>
                    {instructors.map((instructor) => (
                      <option key={instructor.id} value={instructor.id}>
                        {instructor.name}
                      </option>
                    ))}
                  </select>
                  
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={newInstructorName}
                      onChange={(e) => setNewInstructorName(e.target.value)}
                      placeholder="Ou créer un nouveau formateur..."
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    />
                    <button
                      onClick={handleCreateInstructor}
                      disabled={!newInstructorName.trim()}
                      className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
          >
            Annuler
          </button>
          {activeTab === 'new' && (
            <button
              onClick={handleCreateCourse}
              disabled={!newCourseName.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Créer et grouper
            </button>
          )}
        </div>
      </div>
    </div>
  )
}