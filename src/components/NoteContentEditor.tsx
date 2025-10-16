'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { SimpleDragImage } from '@/lib/SimpleDragImage'
import Link from '@tiptap/extension-link'
import Youtube from '@tiptap/extension-youtube'
import Color from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import BulletList from '@tiptap/extension-bullet-list'
import OrderedList from '@tiptap/extension-ordered-list'
import ListItem from '@tiptap/extension-list-item'
import { useCallback, useEffect, useState } from 'react'
import { NoteData } from '@/types'
import { useTheme } from '@/contexts/ThemeContext'
import { 
  X, Save, Bold, Italic, Underline, List, ListOrdered, 
  Link as LinkIcon, Image as ImageIcon, Youtube as YoutubeIcon, Palette,
  Undo, Redo
} from 'lucide-react'

interface NoteContentEditorProps {
  note: NoteData
  onUpdate: (updates: Partial<NoteData>) => void
  onClose: () => void
}

export default function NoteContentEditor({ note, onUpdate, onClose }: NoteContentEditorProps) {
  const [title, setTitle] = useState(note.title)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const { theme } = useTheme()

  const editor = useEditor({
    extensions: [
      StarterKit,
      SimpleDragImage.configure({
        allowBase64: true,
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg',
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 underline hover:text-blue-800',
        },
      }),
      Youtube.configure({
        width: 640,
        height: 480,
        HTMLAttributes: {
          class: 'rounded-lg',
        },
      }),
      Color,
      TextStyle,
      BulletList,
      OrderedList,
      ListItem,
    ],
    content: note.content,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose prose-lg max-w-none focus:outline-none min-h-[400px] p-6',
        style: 'color: var(--editor-text); background-color: var(--editor-bg);',
      },
    },
    onUpdate: () => {
      setHasChanges(true)
    },
  })

  // Auto-save après 2 secondes d'inactivité
  useEffect(() => {
    if (!hasChanges || !editor) return

    const timeout = setTimeout(() => {
      handleSave()
    }, 2000)

    return () => clearTimeout(timeout)
  }, [hasChanges, editor?.getHTML(), title])

  const handleSave = useCallback(async () => {
    if (!editor) return

    setIsSaving(true)
    try {
      const content = editor.getHTML()
      await onUpdate({
        title,
        content,
      })
      setHasChanges(false)
    } catch (error) {
      console.error('Error saving note:', error)
    } finally {
      setIsSaving(false)
    }
  }, [editor, title, onUpdate])

  const handlePasteImage = useCallback(() => {
    navigator.clipboard.read().then((clipboardItems) => {
      for (const clipboardItem of clipboardItems) {
        for (const type of clipboardItem.types) {
          if (type.startsWith('image/')) {
            clipboardItem.getType(type).then((blob) => {
              const reader = new FileReader()
              reader.onload = () => {
                const base64 = reader.result as string
                editor?.chain().focus().setImage({ src: base64, width: 400, height: 300 }).run()
              }
              reader.readAsDataURL(blob)
            })
          }
        }
      }
    }).catch(console.error)
  }, [editor])

  const addLink = useCallback(() => {
    const url = window.prompt('URL du lien:')
    if (url) {
      editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
  }, [editor])

  const addYouTube = useCallback(() => {
    const url = window.prompt('URL YouTube:')
    if (url) {
      editor?.commands.setYoutubeVideo({ src: url })
    }
  }, [editor])


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
        {/* Header */}
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

        {/* Toolbar */}
        <div 
          className="flex items-center space-x-1 p-3 overflow-x-auto theme-transition"
          style={{
            borderBottom: '1px solid var(--border)',
            backgroundColor: 'var(--surface-elevated)'
          }}
        >
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-2 rounded hover:bg-gray-300 ${editor.isActive('bold') ? 'bg-gray-400' : ''}`}
          >
            <Bold className="w-4 h-4 text-gray-700" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-2 rounded hover:bg-gray-300 ${editor.isActive('italic') ? 'bg-gray-400' : ''}`}
          >
            <Italic className="w-4 h-4 text-gray-700" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`p-2 rounded hover:bg-gray-300 ${editor.isActive('strike') ? 'bg-gray-400' : ''}`}
          >
            <Underline className="w-4 h-4 text-gray-700" />
          </button>
          
          <div className="w-px h-6 bg-gray-500 mx-2" />
          
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-2 rounded hover:bg-gray-300 ${editor.isActive('bulletList') ? 'bg-gray-400' : ''}`}
          >
            <List className="w-4 h-4 text-gray-700" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`p-2 rounded hover:bg-gray-300 ${editor.isActive('orderedList') ? 'bg-gray-400' : ''}`}
          >
            <ListOrdered className="w-4 h-4 text-gray-700" />
          </button>
          
          <div className="w-px h-6 bg-gray-500 mx-2" />
          
          <button
            onClick={addLink}
            className="p-2 rounded hover:bg-gray-300"
            title="Ajouter un lien"
          >
            <LinkIcon className="w-4 h-4 text-gray-700" />
          </button>
          <button
            onClick={handlePasteImage}
            className="p-2 rounded hover:bg-gray-300"
            title="Coller une image du presse-papier"
          >
            <ImageIcon className="w-4 h-4 text-gray-700" />
          </button>
          <button
            onClick={addYouTube}
            className="p-2 rounded hover:bg-gray-300"
            title="Ajouter une vidéo YouTube"
          >
            <YoutubeIcon className="w-4 h-4 text-gray-700" />
          </button>
          
          <div className="w-px h-6 bg-gray-500 mx-2" />
          
          <button
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            className="p-2 rounded hover:bg-gray-300 disabled:opacity-50"
          >
            <Undo className="w-4 h-4 text-gray-700" />
          </button>
          <button
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            className="p-2 rounded hover:bg-gray-300 disabled:opacity-50"
          >
            <Redo className="w-4 h-4 text-gray-700" />
          </button>

        </div>

        {/* Editor Content */}
        <div 
          className="flex-1 overflow-y-auto theme-transition"
          style={{ backgroundColor: 'var(--editor-bg)' }}
        >
          <style jsx>{`
            :global(.ProseMirror) {
              color: var(--editor-text) !important;
              line-height: 1.6;
            }
            :global(.image-resize-container) {
              position: absolute;
              z-index: 10;
            }
            :global(.image-resize-handle) {
              transition: all 0.2s ease;
            }
            :global(.image-resize-handle:hover) {
              background: var(--ao-blue-hover) !important;
              transform: scale(1.1);
            }
            :global(.ProseMirror img.ProseMirror-selectednode) {
              outline: 2px solid var(--ao-blue);
              outline-offset: 2px;
            }
            :global(.ProseMirror img) {
              cursor: pointer;
              transition: all 0.2s ease;
            }
            :global(.ProseMirror img:hover) {
              opacity: 0.9;
            }
            :global(.ProseMirror p) {
              color: var(--editor-text) !important;
              margin: 0.75rem 0;
            }
            :global(.ProseMirror h1, .ProseMirror h2, .ProseMirror h3) {
              color: var(--text-primary) !important;
              font-weight: 600;
            }
            :global(.ProseMirror ul, .ProseMirror ol) {
              color: var(--editor-text) !important;
              padding-left: 1.5rem;
            }
            :global(.ProseMirror blockquote) {
              border-left: 4px solid var(--border-strong);
              padding-left: 1rem;
              color: var(--text-secondary) !important;
              font-style: italic;
            }
          `}</style>
          <EditorContent editor={editor} />
        </div>

        {/* Footer */}
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
              💡 <strong>Conseils :</strong> Ctrl+S pour sauvegarder, Échap pour fermer, Ctrl+V pour coller des images. Sélectionnez une image et tirez ses bords pour la redimensionner.
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