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
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ backgroundColor: 'var(--modal-overlay)' }}
    >
      <div 
        className="rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col theme-transition"
        style={{ 
          backgroundColor: 'hsl(var(--modal-bg))',
          border: '1px solid hsl(var(--modal-border))'
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between p-6 theme-transition"
          style={{ 
            borderBottom: '1px solid hsl(var(--border))',
            backgroundColor: 'hsl(var(--surface-elevated))'
          }}
        >
          <div className="flex items-center space-x-3">
            <div 
              className="p-2 rounded-lg"
              style={{ backgroundColor: 'hsl(var(--ao-blue) / 0.1)' }}
            >
              <Edit className="w-5 h-5" style={{ color: 'hsl(var(--ao-blue))' }} />
            </div>
            <div>
              <h2 
                className="text-xl font-semibold"
                style={{ color: 'hsl(var(--text-primary))' }}
              >
                Propriétés
              </h2>
              <p 
                className="text-sm"
                style={{ color: 'hsl(var(--text-secondary))' }}
              >
                Configuration de la note
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors"
            style={{
              backgroundColor: 'hsl(var(--hover))',
              color: 'hsl(var(--ao-red))'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'hsl(var(--active))'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'hsl(var(--hover))'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div 
          className="flex-1 p-6 space-y-6 overflow-y-auto"
          style={{ backgroundColor: 'hsl(var(--surface))' }}
        >
          {/* Titre */}
          <div>
            <label 
              className="flex items-center space-x-2 text-sm font-medium mb-3"
              style={{ color: 'hsl(var(--text-primary))' }}
            >
              <Edit className="w-4 h-4" />
              <span>Titre</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-3 rounded-lg transition-all duration-200 outline-none focus-ring"
              style={{
                backgroundColor: 'hsl(var(--surface-elevated))',
                border: '1px solid hsl(var(--border))',
                color: 'hsl(var(--text-primary))'
              }}
              placeholder="Titre de la note"
            />
          </div>

          {/* Formation */}
          <div>
            <label 
              className="flex items-center space-x-2 text-sm font-medium mb-3"
              style={{ color: 'hsl(var(--text-primary))' }}
            >
              <BookOpen className="w-4 h-4" />
              <span>Formation</span>
            </label>
            <select
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="w-full p-3 rounded-lg transition-all duration-200 outline-none focus-ring"
              style={{
                backgroundColor: 'hsl(var(--surface-elevated))',
                border: '1px solid hsl(var(--border))',
                color: 'hsl(var(--text-primary))'
              }}
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
            <label 
              className="flex items-center space-x-2 text-sm font-medium mb-3"
              style={{ color: 'hsl(var(--text-primary))' }}
            >
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
                      ? 'scale-110 shadow-lg' 
                      : 'hover:scale-105'
                  }`}
                  style={{
                    borderColor: backgroundColor === color 
                      ? 'hsl(var(--ao-blue))' 
                      : 'hsl(var(--border))'
                  }}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          {/* Action Éditer contenu */}
          <div>
            <button
              onClick={onOpenContentEditor}
              className="w-full py-3 px-4 rounded-lg transition-all duration-200 font-medium flex items-center justify-center space-x-2"
              style={{
                backgroundColor: 'hsl(var(--ao-blue))',
                color: 'hsl(var(--text-inverse))'
              }}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              <Edit className="w-4 h-4" />
              <span>Éditer le contenu</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div 
          className="flex items-center space-x-3 p-6 theme-transition"
          style={{
            borderTop: '1px solid hsl(var(--border))',
            backgroundColor: 'hsl(var(--surface-elevated))'
          }}
        >
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-lg transition-all duration-200 font-medium"
            style={{
              backgroundColor: 'hsl(var(--secondary))',
              color: 'hsl(var(--secondary-foreground))'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'hsl(var(--hover))'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'hsl(var(--secondary))'}
          >
            Fermer
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-3 px-4 rounded-lg transition-all duration-200 font-medium"
            style={{
              backgroundColor: 'hsl(var(--ao-blue))',
              color: 'hsl(var(--text-inverse))'
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
          >
            Sauvegarder
          </button>
        </div>
      </div>
    </div>
  )
}