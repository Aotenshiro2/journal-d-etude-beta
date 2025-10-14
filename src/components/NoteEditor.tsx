'use client'

import { useState, useEffect } from 'react'
import { NoteData } from '@/types'

interface NoteEditorProps {
  note: NoteData | null
  onUpdate: (updates: Partial<NoteData>) => void
  onClose: () => void
}

export default function NoteEditor({ note, onUpdate, onClose }: NoteEditorProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [backgroundColor, setBackgroundColor] = useState('#ffffff')

  useEffect(() => {
    if (note) {
      setTitle(note.title)
      setContent(note.content)
      setBackgroundColor(note.backgroundColor)
    }
  }, [note])

  const handleSave = () => {
    if (note) {
      console.log('Saving note:', { title, content, backgroundColor }) // Debug
      onUpdate({
        title,
        content,
        backgroundColor,
      })
    }
    onClose()
  }

  // Auto-save when typing stops for 1 second
  useEffect(() => {
    if (!note) return
    
    const timeout = setTimeout(() => {
      if (note && (title !== note.title || content !== note.content || backgroundColor !== note.backgroundColor)) {
        console.log('Auto-saving note...') // Debug
        onUpdate({
          title,
          content,
          backgroundColor,
        })
      }
    }, 1000)

    return () => clearTimeout(timeout)
  }, [title, content, backgroundColor, note, onUpdate])

  if (!note) return null

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-xl border-l border-gray-200 z-50 flex flex-col">
      <div className="p-6 border-b border-gray-100 flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900">Éditer la note</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xl w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
        >
          ×
        </button>
      </div>

      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Titre
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 text-gray-900"
            placeholder="Titre de la note"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Couleur de fond
          </label>
          <div className="flex space-x-3">
            {['#ffffff', '#fef3c7', '#dbeafe', '#d1fae5', '#fce7f3', '#e0e7ff'].map((color) => (
              <button
                key={color}
                onClick={() => setBackgroundColor(color)}
                className={`w-10 h-10 rounded-lg border-2 transition-all duration-200 ${
                  backgroundColor === color ? 'border-gray-800 scale-110' : 'border-gray-200 hover:border-gray-300'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Contenu
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-64 p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none transition-all duration-200 text-gray-900 leading-relaxed"
            placeholder="Contenu de votre note..."
          />
        </div>
      </div>

      <div className="p-6 border-t border-gray-100 bg-gray-50">
        <div className="flex space-x-3">
          <button
            onClick={handleSave}
            className="flex-1 bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition-all duration-200 font-medium"
          >
            Sauvegarder
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-white border border-gray-200 text-gray-700 py-3 px-4 rounded-lg hover:bg-gray-50 transition-all duration-200 font-medium"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  )
}