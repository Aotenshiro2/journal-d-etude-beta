'use client'

import { useState, useEffect } from 'react'
import { NoteData } from '@/types'
import { X, Save, Brain, Lightbulb } from 'lucide-react'

interface TakeawayModalProps {
  isOpen: boolean
  note: NoteData | null
  onClose: () => void
  onSave: (noteId: string, takeaway: string) => void
}

export default function TakeawayModal({ 
  isOpen, 
  note, 
  onClose, 
  onSave 
}: TakeawayModalProps) {
  const [takeaway, setTakeaway] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (note && isOpen) {
      // Charger le takeaway existant si disponible
      setTakeaway(note.mainTakeaway || '')
    }
  }, [note, isOpen])

  if (!isOpen || !note) return null

  const handleSave = async () => {
    if (!takeaway.trim()) return

    setIsSaving(true)
    try {
      await onSave(note.id, takeaway.trim())
      onClose()
    } catch (error) {
      console.error('Erreur lors de la sauvegarde du takeaway:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      handleSave()
    }
  }

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'var(--modal-overlay)' }}
    >
      <div 
        className="rounded-lg shadow-2xl w-[600px] max-h-[80vh] flex flex-col theme-transition"
        style={{ 
          backgroundColor: 'var(--modal-bg)',
          border: '1px solid var(--modal-border)'
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between p-6 theme-transition"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <h2 
              className="text-xl font-semibold flex items-center"
              style={{ color: 'var(--text-primary)' }}
            >
              <Brain className="w-5 h-5 mr-2" style={{ color: 'var(--ao-green)' }} />
              Enseignement Principal
            </h2>
            <p 
              className="text-sm mt-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              Note : {note.title}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors"
            style={{
              backgroundColor: 'var(--hover)',
              color: 'var(--text-primary)'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--active)'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--hover)'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-6">
          <div className="mb-4">
            <div className="flex items-center mb-3">
              <Lightbulb className="w-4 h-4 mr-2" style={{ color: 'var(--ao-green)' }} />
              <label 
                className="text-sm font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                Quel est l&apos;enseignement principal de cette note ?
              </label>
            </div>
            <p 
              className="text-xs mb-4"
              style={{ color: 'var(--text-secondary)' }}
            >
              Synthétisez en quelques phrases la leçon clé, l'insight principal ou l'apprentissage le plus important de cette réflexion.
            </p>
          </div>

          <textarea
            value={takeaway}
            onChange={(e) => setTakeaway(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Par exemple : &quot;J&apos;ai appris que les concepts de Smart Money fonctionnent mieux quand combinés avec l&apos;analyse de volume...&quot; ou &quot;L&apos;importance de la patience dans l&apos;attente des setups parfaits...&quot;"
            className="w-full h-32 p-4 rounded-lg resize-none theme-transition"
            style={{
              backgroundColor: 'var(--surface)',
              border: '2px solid var(--border)',
              color: 'var(--text-primary)',
              fontSize: '0.9rem',
              lineHeight: '1.6'
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--ao-green)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
            autoFocus
          />

          <div className="mt-4 p-3 rounded-lg" style={{ backgroundColor: 'var(--surface-elevated)' }}>
            <div className="flex items-start space-x-2">
              <div className="w-2 h-2 rounded-full mt-2" style={{ backgroundColor: 'var(--ao-blue)' }} />
              <div>
                <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                  Pourquoi c&apos;est important ?
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Le takeaway principal permet de cristalliser l&apos;apprentissage et de créer des connexions entre vos notes. C&apos;est la synthèse qui transforme l&apos;information en connaissance.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div 
          className="flex items-center justify-between p-6"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            <kbd className="px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--surface)' }}>
              Ctrl+Entrée
            </kbd> pour sauvegarder • <kbd className="px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--surface)' }}>
              Échap
            </kbd> pour fermer
          </div>
          
          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg transition-colors"
              style={{
                backgroundColor: 'var(--surface)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--hover)'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--surface)'}
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={!takeaway.trim() || isSaving}
              className="px-4 py-2 rounded-lg transition-all duration-300 flex items-center space-x-2 disabled:opacity-50"
              style={{
                backgroundColor: takeaway.trim() ? 'var(--ao-green)' : 'var(--surface)',
                color: takeaway.trim() ? 'var(--text-inverse)' : 'var(--text-secondary)',
                border: `1px solid ${takeaway.trim() ? 'var(--ao-green)' : 'var(--border)'}`
              }}
              onMouseOver={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.transform = 'scale(1.05)'
                }
              }}
              onMouseOut={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.transform = 'scale(1)'
                }
              }}
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Sauvegarde...' : 'Sauvegarder'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}