'use client'

import { useState, useEffect } from 'react'
import { NoteData, CourseData } from '@/types'
import { X, Edit, Palette, BookOpen } from 'lucide-react'

interface NotePropertiesModalProps {
  note: NoteData | null
  onUpdate: (updates: Partial<NoteData>) => void
  onClose: () => void
  onOpenContentEditor?: () => void
  courses?: CourseData[]
}

export default function NotePropertiesModal({ 
  note, 
  onUpdate, 
  onClose, 
  onOpenContentEditor, 
  courses = [] 
}: NotePropertiesModalProps) {
  const [title, setTitle] = useState('')
  const [backgroundColor, setBackgroundColor] = useState('#ffffff')
  const [selectedCourseId, setSelectedCourseId] = useState('')

  useEffect(() => {
    if (note) {
      setTitle(note.title)
      setBackgroundColor(note.backgroundColor)
      setSelectedCourseId(note.courseId || '')
    }
  }, [note])

  const handleSave = () => {
    if (note) {
      console.log('Saving note:', { title, backgroundColor, courseId: selectedCourseId })
      onUpdate({
        title,
        backgroundColor,
        courseId: selectedCourseId || undefined,
      })
    }
    onClose()
  }

  // Auto-save when typing stops for 1 second
  useEffect(() => {
    if (!note) return
    
    const timeout = setTimeout(() => {
      if (note && (title !== note.title || backgroundColor !== note.backgroundColor || selectedCourseId !== (note.courseId || ''))) {
        console.log('Auto-saving note properties...')
        onUpdate({
          title,
          backgroundColor,
          courseId: selectedCourseId || undefined,
        })
      }
    }, 1000)

    return () => clearTimeout(timeout)
  }, [title, backgroundColor, selectedCourseId, note, onUpdate])

  if (!note) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Edit className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Propriétés</h2>
              <p className="text-sm text-gray-500">Configuration de la note</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 space-y-6 overflow-y-auto">
          {/* Titre */}
          <div>
            <label className="flex items-center space-x-2 text-sm font-medium text-gray-700 mb-3">
              <Edit className="w-4 h-4" />
              <span>Titre</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 text-gray-900 placeholder:text-gray-500"
              placeholder="Titre de la note"
            />
          </div>

          {/* Formation */}
          <div>
            <label className="flex items-center space-x-2 text-sm font-medium text-gray-700 mb-3">
              <BookOpen className="w-4 h-4" />
              <span>Formation</span>
            </label>
            <select
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 text-gray-900"
            >
              <option value="">Aucune formation</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </div>

          {/* Couleur de fond */}
          <div>
            <label className="flex items-center space-x-2 text-sm font-medium text-gray-700 mb-3">
              <Palette className="w-4 h-4" />
              <span>Couleur de fond</span>
            </label>
            <div className="grid grid-cols-6 gap-2">
              {[
                { color: '#ffffff', name: 'Blanc' },
                { color: '#fef3c7', name: 'Jaune' },
                { color: '#dbeafe', name: 'Bleu' },
                { color: '#d1fae5', name: 'Vert' },
                { color: '#fce7f3', name: 'Rose' },
                { color: '#e0e7ff', name: 'Indigo' },
              ].map(({ color, name }) => (
                <button
                  key={color}
                  onClick={() => setBackgroundColor(color)}
                  title={name}
                  className={`w-12 h-12 rounded-lg border-2 transition-all duration-200 ${
                    backgroundColor === color 
                      ? 'border-blue-500 scale-110 shadow-lg' 
                      : 'border-gray-300 hover:border-gray-400 hover:scale-105'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          {/* Action Éditer contenu */}
          <div>
            <button
              onClick={onOpenContentEditor}
              className="w-full bg-green-600 text-white py-3 px-4 rounded-lg hover:bg-green-700 transition-all duration-200 font-medium flex items-center justify-center space-x-2"
            >
              <Edit className="w-4 h-4" />
              <span>Éditer le contenu</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center space-x-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-100 text-gray-700 py-3 px-4 rounded-lg hover:bg-gray-200 transition-all duration-200 font-medium"
          >
            Fermer
          </button>
          <button
            onClick={handleSave}
            className="flex-1 bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition-all duration-200 font-medium"
          >
            Sauvegarder
          </button>
        </div>
      </div>
    </div>
  )
}