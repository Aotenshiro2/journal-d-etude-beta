'use client'

import { useState, useEffect } from 'react'
import { NoteData, CourseData } from '@/types'

interface NotePropertiesPanelProps {
  note: NoteData | null
  onUpdate: (updates: Partial<NoteData>) => void
  onClose: () => void
  onOpenContentEditor?: () => void
  courses?: CourseData[]
}

export default function NotePropertiesPanel({ note, onUpdate, onClose, onOpenContentEditor, courses = [] }: NotePropertiesPanelProps) {
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
      console.log('Saving note:', { title, backgroundColor, courseId: selectedCourseId }) // Debug
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
        console.log('Auto-saving note properties...') // Debug
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
    <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-xl border-l border-gray-500 z-50 flex flex-col">
      <div className="p-6 border-b border-gray-400 flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900">Propriétés de la note</h2>
        <button
          onClick={onClose}
          className="text-red-600 hover:text-red-700 text-xl w-8 h-8 flex items-center justify-center rounded-full hover:bg-red-50 transition-colors font-semibold"
        >
          ×
        </button>
      </div>

      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            Titre
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full p-3 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 text-gray-900 placeholder:text-gray-500 bg-gray-50"
            placeholder="Titre de la note"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            Formation
          </label>
          <select
            value={selectedCourseId}
            onChange={(e) => setSelectedCourseId(e.target.value)}
            className="w-full p-3 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 text-gray-900 bg-gray-50"
          >
            <option value="">Aucune formation</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-3">
            Couleur de fond
          </label>
          <div className="flex space-x-3">
            {['#ffffff', '#fef3c7', '#dbeafe', '#d1fae5', '#fce7f3', '#e0e7ff'].map((color) => (
              <button
                key={color}
                onClick={() => setBackgroundColor(color)}
                className={`w-10 h-10 rounded-lg border-2 transition-all duration-200 ${
                  backgroundColor === color ? 'border-gray-800 scale-110 shadow-md' : 'border-gray-500 hover:border-gray-700'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-3">
            Actions
          </label>
          <button
            onClick={onOpenContentEditor}
            className="w-full bg-green-600 text-white py-3 px-4 rounded-lg hover:bg-green-700 transition-all duration-200 font-medium flex items-center justify-center space-x-2"
          >
            <span>✏️</span>
            <span>Éditer le contenu</span>
          </button>
        </div>
      </div>

      <div className="p-6 border-t border-gray-400 bg-gray-50">
        <div className="flex space-x-3">
          <button
            onClick={handleSave}
            className="flex-1 bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition-all duration-200 font-medium"
          >
            Sauvegarder
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-white border border-gray-700 text-black py-3 px-4 rounded-lg hover:bg-gray-50 hover:border-gray-800 transition-all duration-200 font-medium"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  )
}