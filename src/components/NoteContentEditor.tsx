'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ResizableImage } from '@/lib/ResizableImage'
import { ImageResize } from '@/lib/ImageResize'
import Link from '@tiptap/extension-link'
import Youtube from '@tiptap/extension-youtube'
import Color from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import BulletList from '@tiptap/extension-bullet-list'
import OrderedList from '@tiptap/extension-ordered-list'
import ListItem from '@tiptap/extension-list-item'
import { useCallback, useEffect, useState } from 'react'
import { NoteData } from '@/types'
import { 
  X, Save, Bold, Italic, Underline, List, ListOrdered, 
  Link as LinkIcon, Image as ImageIcon, Youtube as YoutubeIcon, Palette,
  Undo, Redo, Maximize, Minimize, RotateCcw
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

  const editor = useEditor({
    extensions: [
      StarterKit,
      ResizableImage.configure({
        allowBase64: true,
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg cursor-pointer',
        },
      }),
      ImageResize,
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
        class: 'prose prose-lg max-w-none focus:outline-none min-h-[400px] p-6 text-gray-900',
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
                editor?.chain().focus().setImage({ src: base64 }).run()
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

  // Fonctions de redimensionnement d'images
  const resizeImage = useCallback((size: 'small' | 'medium' | 'large' | 'original') => {
    if (!editor) return

    const { selection } = editor.state
    const selectedNode = editor.state.doc.nodeAt(selection.from)
    
    if (selectedNode && selectedNode.type.name === 'resizableImage') {
      let width: number | undefined
      let height: number | undefined

      switch (size) {
        case 'small':
          width = 200
          height = undefined // Maintenir le ratio
          break
        case 'medium':
          width = 400
          height = undefined
          break
        case 'large':
          width = 600
          height = undefined
          break
        case 'original':
          width = undefined
          height = undefined
          break
      }

      editor.commands.updateAttributes('resizableImage', {
        width,
        height,
      })
    }
  }, [editor])

  const getSelectedImageInfo = useCallback(() => {
    if (!editor) return null

    const { selection } = editor.state
    const selectedNode = editor.state.doc.nodeAt(selection.from)
    
    if (selectedNode && selectedNode.type.name === 'resizableImage') {
      return {
        width: selectedNode.attrs.width,
        height: selectedNode.attrs.height,
        src: selectedNode.attrs.src,
      }
    }
    return null
  }, [editor])

  const [selectedImageInfo, setSelectedImageInfo] = useState<any>(null)

  // Écouter les changements de sélection pour détecter les images sélectionnées
  useEffect(() => {
    if (!editor) return

    const updateSelection = () => {
      setSelectedImageInfo(getSelectedImageInfo())
    }

    editor.on('selectionUpdate', updateSelection)
    return () => editor.off('selectionUpdate', updateSelection)
  }, [editor, getSelectedImageInfo])

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
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-2xl w-[95vw] h-[95vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-500 bg-gray-50">
          <div className="flex items-center space-x-4 flex-1">
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setHasChanges(true)
              }}
              className="text-xl font-semibold bg-gray-50 border border-gray-600 rounded-lg px-3 py-2 outline-none flex-1 text-gray-900 placeholder:text-gray-600"
              placeholder="Titre de la note..."
            />
            {isSaving && (
              <span className="text-sm text-blue-600">Sauvegarde...</span>
            )}
            {hasChanges && !isSaving && (
              <span className="text-sm text-orange-600">Non sauvegardé</span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="px-4 py-2 bg-blue-800 text-white rounded-lg hover:bg-blue-900 disabled:opacity-50 flex items-center space-x-2"
            >
              <Save className="w-4 h-4" />
              <span>Sauvegarder</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-red-50 rounded-lg transition-colors text-red-600 hover:text-red-700"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center space-x-1 p-3 border-b border-gray-400 bg-gray-50 overflow-x-auto">
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

          {/* Boutons de redimensionnement d'images (visible seulement si une image est sélectionnée) */}
          {selectedImageInfo && (
            <>
              <div className="w-px h-6 bg-gray-500 mx-2" />
              
              <div className="flex items-center space-x-1 bg-blue-50 px-2 py-1 rounded-lg">
                <span className="text-xs text-blue-800 font-medium">Image:</span>
                <button
                  onClick={() => resizeImage('small')}
                  className="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 rounded text-blue-800"
                  title="Petite (200px)"
                >
                  <Minimize className="w-3 h-3" />
                </button>
                <button
                  onClick={() => resizeImage('medium')}
                  className="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 rounded text-blue-800"
                  title="Moyenne (400px)"
                >
                  M
                </button>
                <button
                  onClick={() => resizeImage('large')}
                  className="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 rounded text-blue-800"
                  title="Grande (600px)"
                >
                  <Maximize className="w-3 h-3" />
                </button>
                <button
                  onClick={() => resizeImage('original')}
                  className="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 rounded text-blue-800"
                  title="Taille originale"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
                {selectedImageInfo.width && (
                  <span className="text-xs text-blue-600 ml-1">
                    {selectedImageInfo.width}px
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Editor Content */}
        <div className="flex-1 overflow-y-auto bg-white">
          <style jsx>{`
            :global(.ProseMirror) {
              color: #1f2937 !important;
              line-height: 1.6;
            }
            :global(.image-resize-container) {
              position: relative;
            }
            :global(.ProseMirror img.ProseMirror-selectednode) {
              outline: 2px solid #3b82f6;
              outline-offset: 2px;
            }
            :global(.ProseMirror p) {
              color: #374151 !important;
              margin: 0.75rem 0;
            }
            :global(.ProseMirror h1, .ProseMirror h2, .ProseMirror h3) {
              color: #111827 !important;
              font-weight: 600;
            }
            :global(.ProseMirror ul, .ProseMirror ol) {
              color: #374151 !important;
              padding-left: 1.5rem;
            }
            :global(.ProseMirror blockquote) {
              border-left: 4px solid #6b7280;
              padding-left: 1rem;
              color: #374151 !important;
              font-style: italic;
            }
          `}</style>
          <EditorContent editor={editor} />
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-400 bg-gray-50 text-sm text-gray-700">
          <div className="flex items-center justify-between">
            <div>
              💡 <strong>Conseils :</strong> Ctrl+S pour sauvegarder, Échap pour fermer, Ctrl+V pour coller des images. Cliquez sur une image pour la redimensionner.
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