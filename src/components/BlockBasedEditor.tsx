'use client'

import { useCallback, useEffect, useState } from 'react'
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'

import { NoteData, NoteBlock } from '@/types'
import { useTheme } from '@/contexts/ThemeContext'
import { X, Save } from 'lucide-react'

interface BlockBasedEditorProps {
  note: NoteData
  onUpdate: (updates: Partial<NoteData>) => void
  onClose: () => void
}

export default function BlockBasedEditor({ note, onUpdate, onClose }: BlockBasedEditorProps) {
  const [title, setTitle] = useState(note.title)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const { theme } = useTheme()

  // Convertir le contenu HTML existant en blocs BlockNote
  const getInitialContent = useCallback(() => {
    // Si la note a déjà des blocs, les utiliser
    if (note.blocks && note.blocks.length > 0) {
      return note.blocks.map(block => ({
        id: block.id,
        type: block.type,
        content: block.content
      }))
    }
    
    // Sinon, créer un bloc initial à partir du contenu HTML
    if (note.content && note.content.trim()) {
      return [
        {
          id: 'initial-block',
          type: 'paragraph',
          content: [{ type: 'text', text: note.content.replace(/<[^>]*>/g, '') }]
        }
      ]
    }
    
    // Note vide, commencer avec un paragraphe vide
    return [
      {
        id: 'empty-block',
        type: 'paragraph',
        content: []
      }
    ]
  }, [note.content, note.blocks])

  // Créer l'éditeur BlockNote avec détection automatique
  const editor = useCreateBlockNote({
    initialContent: getInitialContent(),
    // Configuration pour masquer les toolbars et rendre l'interface minimaliste
    trailingBlock: false,
    // Configuration pour la détection automatique de contenu
    uploadFile: async (file: File) => {
      // Gérer l'upload d'images (retourner une URL ou base64)
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(file)
      })
    },
    // Désactiver les menus par défaut
    _tiptapOptions: {
      enableInputRules: true,
      enablePasteRules: true,
    },
  })

  // Sauvegarder automatiquement les changements
  const handleSave = useCallback(async () => {
    if (!editor) return

    setIsSaving(true)
    try {
      const blocks = editor.document
      const htmlContent = await editor.blocksToHTMLLossy(blocks)
      
      // Convertir les blocs en format NoteBlock
      const noteBlocks: NoteBlock[] = blocks.map((block, index) => ({
        id: block.id,
        type: block.type as any,
        content: block.content,
        order: index,
        metadata: block.props
      }))

      await onUpdate({
        title,
        content: htmlContent, // Garde compatibilité
        blocks: noteBlocks    // Nouvelle structure
      })
      
      setHasChanges(false)
    } catch (error) {
      console.error('Error saving note:', error)
    } finally {
      setIsSaving(false)
    }
  }, [editor, title, onUpdate])

  // Auto-save après 2 secondes d'inactivité
  useEffect(() => {
    if (!hasChanges || !editor) return

    const timeout = setTimeout(() => {
      handleSave()
    }, 2000)

    return () => clearTimeout(timeout)
  }, [hasChanges, handleSave])

  // Écouter les changements dans l'éditeur
  const handleEditorChange = useCallback(() => {
    setHasChanges(true)
  }, [])

  // Gestion des raccourcis clavier et interactions avancées
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.ctrlKey || e.metaKey) {
      if (e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
  }, [onClose, handleSave])

  // Gestion des interactions spéciales dans l'éditeur
  useEffect(() => {
    if (!editor) return

    // Écouter les changements pour détecter les patterns (URLs, etc.)
    const handleUpdate = () => {
      setHasChanges(true)
      
      // Auto-détection des URLs YouTube pour conversion en embed
      const currentBlock = editor.getTextCursorPosition().block
      if (currentBlock.type === 'paragraph') {
        const content = currentBlock.content
        if (Array.isArray(content) && content.length === 1 && content[0].type === 'text') {
          const text = content[0].text
          const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/
          if (youtubeRegex.test(text)) {
            // Laisser BlockNote gérer la conversion automatique
            // Les règles de paste intégrées devraient déjà faire cela
          }
        }
      }
    }

    // Attacher l'écouteur d'événements
    editor.onChange(handleUpdate)
  }, [editor])

  // Améliorer l'expérience de saisie
  useEffect(() => {
    if (!editor) return

    // Placeholder dynamique et contextuel
    const updatePlaceholders = () => {
      // BlockNote gère déjà les placeholders, mais on peut les personnaliser ici si besoin
    }

    updatePlaceholders()
  }, [editor])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!editor) {
    return null
  }

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'var(--modal-overlay)' }}
    >
      <div 
        className="rounded-lg shadow-2xl w-[95vw] h-[95vh] flex flex-col overflow-hidden theme-transition"
        style={{ 
          backgroundColor: 'var(--modal-bg)',
          border: '1px solid var(--modal-border)'
        }}
      >
        {/* Header minimaliste */}
        <div 
          className="flex items-center justify-between p-4 theme-transition"
          style={{ 
            borderBottom: '1px solid var(--border)',
            backgroundColor: 'var(--surface-elevated)'
          }}
        >
          <div className="flex items-center space-x-4 flex-1">
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setHasChanges(true)
              }}
              className="text-xl font-semibold rounded-lg px-3 py-2 outline-none flex-1 theme-transition focus-ring"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)'
              }}
              placeholder="Titre de la note..."
            />
            {isSaving && (
              <span className="text-sm" style={{ color: 'var(--ao-blue)' }}>Sauvegarde...</span>
            )}
            {hasChanges && !isSaving && (
              <span className="text-sm" style={{ color: 'var(--ao-red)' }}>Non sauvegardé</span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="px-4 py-2 rounded-lg disabled:opacity-50 flex items-center space-x-2 transition-colors"
              style={{
                backgroundColor: 'var(--ao-blue)',
                color: 'var(--text-inverse)'
              }}
              onMouseOver={(e) => !e.currentTarget.disabled && (e.currentTarget.style.opacity = '0.9')}
              onMouseOut={(e) => !e.currentTarget.disabled && (e.currentTarget.style.opacity = '1')}
            >
              <Save className="w-4 h-4" />
              <span>Sauvegarder</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg transition-colors"
              style={{
                backgroundColor: 'var(--hover)',
                color: 'var(--ao-red)'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--active)'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--hover)'}
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Zone d'édition par blocs - interface épurée */}
        <div 
          className="flex-1 overflow-y-auto theme-transition"
          style={{ backgroundColor: 'var(--editor-bg)' }}
        >
          <style jsx global>{`
            /* MASQUER COMPLÈTEMENT tous les éléments intrusifs */
            .bn-toolbar,
            .bn-formatting-toolbar,
            .bn-slash-menu,
            .bn-table-handles {
              display: none !important;
            }
            
            /* Side menu - seulement pour drag handle */
            .bn-side-menu {
              background: transparent !important;
              border: none !important;
              box-shadow: none !important;
            }
            
            .bn-side-menu > *:not(.bn-drag-handle) {
              display: none !important;
            }
            
            /* Personnaliser les couleurs selon le thème */
            .bn-editor {
              background-color: var(--editor-bg) !important;
              color: var(--editor-text) !important;
              padding: 2rem !important;
              line-height: 1.8 !important;
              font-size: 16px !important;
            }
            
            .bn-block-content {
              color: var(--editor-text) !important;
              line-height: 1.8 !important;
            }
            
            /* Style minimaliste pour les blocs */
            .bn-block-outer {
              margin: 1rem 0 !important;
              padding: 0.5rem 0 !important;
              border-radius: 6px !important;
              transition: all 0.2s ease !important;
            }
            
            .bn-block-outer:hover {
              background-color: var(--hover) !important;
            }
            
            /* Focus states épurés */
            .bn-block-content[contenteditable="true"]:focus {
              outline: none !important;
              background-color: transparent !important;
            }
            
            /* Drag handles ultra-discrets */
            .bn-drag-handle {
              opacity: 0 !important;
              transition: opacity 0.3s ease !important;
              background-color: var(--text-secondary) !important;
              border-radius: 4px !important;
              width: 4px !important;
              margin-right: 8px !important;
            }
            
            .bn-block-outer:hover .bn-drag-handle {
              opacity: 0.4 !important;
            }
            
            .bn-drag-handle:hover {
              opacity: 0.8 !important;
            }
            
            /* Style des différents types de blocs */
            .bn-block-content h1 {
              font-size: 2rem !important;
              font-weight: 700 !important;
              margin: 1.5rem 0 1rem 0 !important;
              color: var(--text-primary) !important;
            }
            
            .bn-block-content h2 {
              font-size: 1.5rem !important;
              font-weight: 600 !important;
              margin: 1.25rem 0 0.75rem 0 !important;
              color: var(--text-primary) !important;
            }
            
            .bn-block-content h3 {
              font-size: 1.25rem !important;
              font-weight: 600 !important;
              margin: 1rem 0 0.5rem 0 !important;
              color: var(--text-primary) !important;
            }
            
            .bn-block-content p {
              margin: 0.75rem 0 !important;
              color: var(--editor-text) !important;
            }
            
            .bn-block-content blockquote {
              border-left: 4px solid var(--ao-blue) !important;
              padding-left: 1rem !important;
              margin: 1rem 0 !important;
              font-style: italic !important;
              color: var(--text-secondary) !important;
            }
            
            /* Placeholder discret */
            .bn-block-content[data-placeholder]:before {
              color: var(--text-secondary) !important;
              opacity: 0.6 !important;
              font-style: italic !important;
            }
            
            /* Sélection visuelle */
            .bn-block-content::selection {
              background-color: var(--ao-blue) !important;
              color: var(--text-inverse) !important;
            }
          `}</style>
          
          <div>
            <BlockNoteView 
              editor={editor} 
              onChange={handleEditorChange}
              theme={theme}
              data-theming-css-variables
            />
          </div>
        </div>

        {/* Footer minimaliste */}
        <div 
          className="p-3 text-sm theme-transition"
          style={{
            borderTop: '1px solid var(--border)',
            backgroundColor: 'var(--surface-elevated)',
            color: 'var(--text-secondary)'
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              💡 <strong>Écriture fluide :</strong> Double Entrée pour nouveau bloc, Ctrl+S pour sauvegarder, Échap pour fermer
            </div>
            <div>
              Dernière modification : {new Date(note.updatedAt).toLocaleString('fr-FR')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}