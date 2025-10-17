'use client'

import { useCallback, useEffect, useState } from 'react'
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'

import { NoteData, NoteBlock } from '@/types'
import { useTheme } from '@/contexts/ThemeContext'
import { X, Save, Tag, Brain } from 'lucide-react'

interface BlockBasedEditorProps {
  note: NoteData
  onUpdate: (updates: Partial<NoteData>) => void
  onClose: () => void
  onOpenConcepts?: () => void
  onOpenTakeaway?: () => void
}

export default function BlockBasedEditor({ note, onUpdate, onClose, onOpenConcepts, onOpenTakeaway }: BlockBasedEditorProps) {
  const [title, setTitle] = useState(note.title)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [inputText, setInputText] = useState('')
  const { theme } = useTheme()

  // Parser intelligent HTML vers blocs multiples
  const parseHTMLToBlocks = useCallback((htmlContent: string) => {
    if (!htmlContent || !htmlContent.trim()) {
      return [{
        id: 'empty-block',
        type: 'paragraph',
        content: []
      }]
    }

    const parser = new DOMParser()
    const doc = parser.parseFromString(`<div>${htmlContent}</div>`, 'text/html')
    const container = doc.querySelector('div')
    
    if (!container || !container.children.length) {
      // Fallback: texte simple sans balises
      const textContent = htmlContent.replace(/<[^>]*>/g, '').trim()
      if (textContent) {
        return [{
          id: 'migrated-text',
          type: 'paragraph',
          content: [{ type: 'text', text: textContent }]
        }]
      }
      return [{
        id: 'empty-block',
        type: 'paragraph',
        content: []
      }]
    }
    
    const blocks = Array.from(container.children).map((el, index) => {
      const textContent = el.textContent?.trim() || ''
      
      switch (el.tagName.toLowerCase()) {
        case 'h1':
          return {
            id: `migrated-h1-${index}`,
            type: 'heading',
            content: textContent ? [{ type: 'text', text: textContent }] : [],
            props: { level: 1 }
          }
        case 'h2':
          return {
            id: `migrated-h2-${index}`,
            type: 'heading',
            content: textContent ? [{ type: 'text', text: textContent }] : [],
            props: { level: 2 }
          }
        case 'h3':
          return {
            id: `migrated-h3-${index}`,
            type: 'heading',
            content: textContent ? [{ type: 'text', text: textContent }] : [],
            props: { level: 3 }
          }
        case 'blockquote':
          return {
            id: `migrated-quote-${index}`,
            type: 'paragraph',
            content: textContent ? [{ type: 'text', text: textContent }] : []
          }
        case 'p':
        default:
          return {
            id: `migrated-p-${index}`,
            type: 'paragraph',
            content: textContent ? [{ type: 'text', text: textContent }] : []
          }
      }
    }).filter(block => 
      // Éliminer les blocs vides
      block.content.length > 0 && 
      (block.content[0] as any)?.text?.trim()
    )
    
    return blocks.length > 0 ? blocks : [{
      id: 'empty-block',
      type: 'paragraph',
      content: []
    }]
  }, [])

  // Convertir le contenu HTML existant en blocs BlockNote
  const getInitialContent = useCallback(() => {
    // Priorité 1 : Blocs sauvegardés (structure préservée)
    if (note.blocks && Array.isArray(note.blocks) && note.blocks.length > 0) {
      return note.blocks.map(block => ({
        id: block.id,
        type: block.type,
        content: block.content,
        props: block.metadata || {}
      }))
    }
    
    // Priorité 2 : Migration HTML intelligente (conversion multi-blocs)
    if (note.content && note.content.trim()) {
      const parsedBlocks = parseHTMLToBlocks(note.content)
      return parsedBlocks
    }
    
    // Priorité 3 : Bloc vide par défaut
    return [{
      id: 'empty-block',
      type: 'paragraph',
      content: []
    }]
  }, [note.content, note.blocks, parseHTMLToBlocks])

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

  // Fonction pour créer un nouveau bloc à partir du texte saisi
  const handleCreateBlock = useCallback(() => {
    if (!editor || !inputText.trim()) return

    try {
      // Créer un nouveau bloc à la fin
      const newBlock = {
        id: `block-${Date.now()}`,
        type: 'paragraph' as const,
        content: [{ type: 'text', text: inputText.trim() }]
      }

      // Ajouter le bloc à la fin du document
      editor.insertBlocks([newBlock], editor.document[editor.document.length - 1], 'after')
      
      // Vider la zone de saisie
      setInputText('')
      setHasChanges(true)
    } catch (error) {
      console.error('Erreur lors de la création du bloc:', error)
    }
  }, [editor, inputText])

  // Gérer la touche Entrée dans la zone de saisie
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      // Ctrl+Entrée ou Cmd+Entrée = créer le bloc
      e.preventDefault()
      handleCreateBlock()
    }
    // Entrée simple = retour à la ligne normal (comportement par défaut)
  }, [handleCreateBlock])

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

  // Gestion des interactions spéciales dans l'éditeur + zone d'écriture fixe
  useEffect(() => {
    if (!editor) return

    // Référence pour l'élément de scroll
    const scrollContainer = document.querySelector('.bn-editor')?.parentElement
    if (!scrollContainer) return

    // Écouter les changements pour détecter les patterns (URLs, etc.) + auto-scroll
    const handleUpdate = () => {
      setHasChanges(true)
      
      // Auto-détection améliorée des URLs YouTube pour conversion en embed
      const currentBlock = editor.getTextCursorPosition().block
      if (currentBlock.type === 'paragraph') {
        const content = currentBlock.content
        if (Array.isArray(content) && content.length === 1 && content[0].type === 'text') {
          const text = content[0].text.trim()
          
          // Regex robuste pour tous les formats YouTube
          const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/|m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/
          const match = text.match(youtubeRegex)
          
          if (match && text === match[0]) {
            // URL YouTube seule dans le bloc, conversion automatique
            setTimeout(() => {
              try {
                editor.updateBlock(currentBlock.id, {
                  type: "video",
                  props: {
                    url: text,
                    caption: "",
                    showPreview: true,
                    previewWidth: 512
                  }
                })
              } catch (error) {
                console.log('Conversion YouTube en cours via BlockNote...')
              }
            }, 500) // Délai pour éviter les conflits
          }
        }
      }

      // Zone d'écriture fixe : maintenir le bloc actif visuellement au même endroit
      setTimeout(() => {
        try {
          const activeBlock = document.querySelector('.bn-block-outer:focus-within')
          if (activeBlock && scrollContainer) {
            const containerRect = scrollContainer.getBoundingClientRect()
            const blockRect = activeBlock.getBoundingClientRect()
            
            // Position idéale : 60% de la hauteur du container (zone d'écriture confortable)
            const idealPosition = containerRect.height * 0.6
            const currentRelativePosition = blockRect.top - containerRect.top
            
            // Si le bloc actif sort de la zone confortable, ajuster le scroll
            if (currentRelativePosition > idealPosition || currentRelativePosition < idealPosition - 100) {
              const targetScrollTop = scrollContainer.scrollTop + (currentRelativePosition - idealPosition)
              
              // Scroll fluide vers la position idéale
              scrollContainer.scrollTo({
                top: Math.max(0, targetScrollTop),
                behavior: 'smooth'
              })
            }
          }
        } catch (error) {
          console.log('Auto-scroll:', error)
        }
      }, 100) // Délai pour que le DOM soit mis à jour
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
          backgroundColor: 'hsl(var(--modal-bg))',
          border: '1px solid hsl(var(--modal-border))'
        }}
      >
        {/* Header intégré dans l'espace de pensée */}
        <div 
          className="flex items-center justify-between p-6 theme-transition"
          style={{ 
            borderBottom: '1px solid hsl(var(--border))',
            backgroundColor: 'hsl(var(--surface-elevated))'
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
              className="text-2xl font-light rounded-lg px-4 py-3 outline-none flex-1 theme-transition"
              style={{
                backgroundColor: 'transparent',
                border: '2px solid transparent',
                borderBottom: '2px solid hsl(var(--border))',
                color: 'hsl(var(--text-primary))',
                fontFamily: 'Georgia, serif',
                letterSpacing: '0.02em'
              }}
              placeholder="Donnez un titre à votre réflexion..."
              onFocus={(e) => e.target.style.borderBottomColor = 'hsl(var(--ao-blue))'}
              onBlur={(e) => e.target.style.borderBottomColor = 'hsl(var(--border))'}
            />
            {isSaving && (
              <span className="text-sm" style={{ color: 'var(--ao-blue)' }}>Sauvegarde...</span>
            )}
            {hasChanges && !isSaving && (
              <span className="text-sm" style={{ color: 'var(--ao-red)' }}>Non sauvegardé</span>
            )}
          </div>
          <div className="flex items-center space-x-3">
            {/* Bouton Concepts */}
            {onOpenConcepts && (
              <button
                onClick={onOpenConcepts}
                className="px-3 py-2 rounded-full flex items-center space-x-2 transition-all duration-300"
                style={{
                  backgroundColor: 'transparent',
                  color: 'var(--ao-purple)',
                  border: '1px solid var(--ao-purple)',
                  fontSize: '0.875rem'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'scale(1.05)'
                  e.currentTarget.style.backgroundColor = 'var(--ao-purple)'
                  e.currentTarget.style.color = 'var(--text-inverse)'
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'scale(1)'
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.color = 'var(--ao-purple)'
                }}
              >
                <Tag className="w-3 h-3" />
                <span>Concepts</span>
              </button>
            )}

            {/* Bouton Main Takeaway */}
            {onOpenTakeaway && (
              <button
                onClick={onOpenTakeaway}
                className="px-3 py-2 rounded-full flex items-center space-x-2 transition-all duration-300"
                style={{
                  backgroundColor: 'transparent',
                  color: 'var(--ao-green)',
                  border: '1px solid var(--ao-green)',
                  fontSize: '0.875rem'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'scale(1.05)'
                  e.currentTarget.style.backgroundColor = 'var(--ao-green)'
                  e.currentTarget.style.color = 'var(--text-inverse)'
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'scale(1)'
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.color = 'var(--ao-green)'
                }}
              >
                <Brain className="w-3 h-3" />
                <span>Takeaway</span>
              </button>
            )}

            <button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="px-3 py-2 rounded-full disabled:opacity-50 flex items-center space-x-2 transition-all duration-300"
              style={{
                backgroundColor: hasChanges ? 'var(--ao-blue)' : 'transparent',
                color: hasChanges ? 'var(--text-inverse)' : 'var(--text-secondary)',
                border: `1px solid ${hasChanges ? 'var(--ao-blue)' : 'var(--block-border)'}`,
                fontSize: '0.875rem'
              }}
              onMouseOver={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.transform = 'scale(1.05)'
                  e.currentTarget.style.backgroundColor = 'var(--ao-blue)'
                  e.currentTarget.style.color = 'var(--text-inverse)'
                }
              }}
              onMouseOut={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.transform = 'scale(1)'
                  e.currentTarget.style.backgroundColor = hasChanges ? 'var(--ao-blue)' : 'transparent'
                  e.currentTarget.style.color = hasChanges ? 'var(--text-inverse)' : 'var(--text-secondary)'
                }
              }}
            >
              <Save className="w-3 h-3" />
              <span>{isSaving ? 'Enregistrement...' : 'Sauver'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full transition-all duration-300"
              style={{
                backgroundColor: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--block-border)'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'scale(1.1)'
                e.currentTarget.style.backgroundColor = 'var(--ao-red)'
                e.currentTarget.style.color = 'var(--text-inverse)'
                e.currentTarget.style.borderColor = 'var(--ao-red)'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.color = 'var(--text-secondary)'
                e.currentTarget.style.borderColor = 'var(--block-border)'
              }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Espace de pensée visuelle - composition centrée */}
        <div 
          className="flex-1 overflow-y-auto theme-transition"
          style={{ 
            backgroundColor: 'hsl(var(--background))'
          }}
        >
          <style jsx global>{`
            /* ===========================================
               ESPACE DE PENSÉE VISUELLE - COMPOSITION COGNITIVE
               =========================================== */
            
            /* MASQUER ÉLÉMENTS INTRUSIFS */
            .bn-toolbar,
            .bn-formatting-toolbar,
            .bn-slash-menu,
            .bn-table-handles {
              display: none !important;
            }
            
            /* Side menu épuré - seulement drag handle */
            .bn-side-menu {
              background: transparent !important;
              border: none !important;
              box-shadow: none !important;
            }
            
            .bn-side-menu > *:not(.bn-drag-handle) {
              display: none !important;
            }
            
            /* ZONE DE COMPOSITION CENTRÉE selon modèle */
            .bn-editor {
              max-width: 700px !important;
              margin: 0 auto !important;
              padding: 2rem 2.5rem !important;
              min-height: calc(100vh - 160px) !important;
              background-color: hsl(var(--background)) !important;
              color: hsl(var(--editor-text)) !important;
              line-height: 1.8 !important;
              font-size: 16px !important;
            }
            
            /* FRAGMENTS DE PENSÉE - Blocs constamment visibles selon modèle */
            .bn-block-outer {
              margin: 1rem 0 !important;
              padding: 1rem 1.5rem !important;
              border-radius: 6px !important;
              transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
              position: relative !important;
              /* VISIBILITÉ PERMANENTE inspirée du modèle */
              border: 1px solid hsl(var(--border)) !important;
              background: hsl(var(--card)) !important;
            }
            
            /* États subtils inspirés du modèle - Améliorés pour interaction */
            .bn-block-outer:hover {
              background: hsl(var(--accent)) !important;
              box-shadow: 0 2px 8px hsl(var(--border) / 0.2) !important;
              transform: translateY(-1px) !important;
              border-color: hsl(var(--ao-blue)) !important;
              cursor: text !important;
            }
            
            .bn-block-outer:focus-within {
              background: hsl(var(--accent)) !important;
              border-color: hsl(var(--ao-blue)) !important;
              box-shadow: 0 4px 16px hsl(var(--border) / 0.2) !important;
              transform: translateY(-2px) !important;
            }
            
            /* Différenciation visuelle entre zone d'édition et zone de drag */
            .bn-block-outer:hover .bn-block-content {
              cursor: text !important;
              border-left: 2px solid transparent !important;
              padding-left: 1rem !important;
              transition: all 0.2s ease !important;
            }
            
            .bn-block-outer:focus-within .bn-block-content {
              border-left: 2px solid hsl(var(--ao-blue)) !important;
              padding-left: 1rem !important;
            }
            
            /* TYPOGRAPHIE COGNITIVE */
            .bn-block-content {
              color: hsl(var(--editor-text)) !important;
              line-height: 2.0 !important;
            }
            
            /* DIFFÉRENTIATION VISUELLE DES TYPES DE BLOCS */
            
            /* Paragraphes standards - fragments de pensée */
            .bn-block-content[data-content-type="paragraph"] {
              border-left: 2px solid transparent !important;
              padding-left: 1rem !important;
            }
            
            /* Titres - présence marquée */
            .bn-block-content h1 {
              font-size: 2.25rem !important;
              font-weight: 700 !important;
              margin: 2rem 0 1.5rem 0 !important;
              color: var(--text-primary) !important;
              background: var(--heading-bg) !important;
              padding: 1.5rem 2rem !important;
              border-radius: 8px !important;
              border-left: 4px solid var(--ao-blue) !important;
            }
            
            .bn-block-content h2 {
              font-size: 1.875rem !important;
              font-weight: 600 !important;
              margin: 1.75rem 0 1rem 0 !important;
              color: var(--text-primary) !important;
              background: var(--heading-bg) !important;
              padding: 1rem 1.5rem !important;
              border-radius: 6px !important;
              border-left: 3px solid var(--ao-purple) !important;
            }
            
            .bn-block-content h3 {
              font-size: 1.5rem !important;
              font-weight: 600 !important;
              margin: 1.5rem 0 0.75rem 0 !important;
              color: var(--text-primary) !important;
              background: var(--heading-bg) !important;
              padding: 0.75rem 1rem !important;
              border-radius: 4px !important;
              border-left: 2px solid var(--accent-secondary) !important;
            }
            
            /* Paragraphes - espacement équilibré selon modèle */
            .bn-block-content p {
              margin: 1rem 0 !important;
              color: var(--editor-text) !important;
              font-size: 16px !important;
            }
            
            /* Citations - zone distincte de réflexion */
            .bn-block-content blockquote {
              background: var(--quote-bg) !important;
              border-left: 4px solid var(--accent-secondary) !important;
              padding: 2rem 2.5rem !important;
              margin: 2.5rem 0 !important;
              border-radius: 0 8px 8px 0 !important;
              font-style: italic !important;
              color: var(--text-secondary) !important;
              font-size: 1.1rem !important;
              box-shadow: 0 2px 8px var(--block-shadow) !important;
            }
            
            /* Images - cadre de composition visuelle */
            .bn-block-content img {
              border-radius: 12px !important;
              box-shadow: 0 8px 32px var(--image-shadow) !important;
              margin: 3rem auto !important;
              display: block !important;
              transition: transform 0.3s ease !important;
            }
            
            .bn-block-content img:hover {
              transform: scale(1.02) !important;
            }
            
            /* DRAG HANDLES AMÉLIORÉS - Plus visibles et fonctionnels */
            .bn-drag-handle {
              opacity: 0.3 !important;
              transition: all 0.3s ease !important;
              background: linear-gradient(135deg, hsl(var(--ao-blue)), hsl(var(--ao-purple))) !important;
              border-radius: 8px !important;
              width: 8px !important;
              height: 24px !important;
              margin-right: 16px !important;
              cursor: grab !important;
              position: relative !important;
            }
            
            /* Zone d'interaction élargie pour le drag */
            .bn-drag-handle::before {
              content: '' !important;
              position: absolute !important;
              top: -8px !important;
              left: -8px !important;
              right: -8px !important;
              bottom: -8px !important;
              border-radius: 12px !important;
              background: transparent !important;
            }
            
            .bn-block-outer:hover .bn-drag-handle {
              opacity: 0.8 !important;
              transform: translateX(2px) !important;
            }
            
            .bn-drag-handle:hover {
              opacity: 1 !important;
              transform: scale(1.15) translateX(4px) !important;
              cursor: grabbing !important;
              box-shadow: 0 2px 8px hsl(var(--ao-blue) / 0.3) !important;
            }
            
            /* Amélioration de la zone de drag sur toute la marge */
            .bn-side-menu {
              width: 32px !important;
              cursor: grab !important;
            }
            
            .bn-side-menu:hover {
              background: hsl(var(--muted) / 0.3) !important;
              border-radius: 8px !important;
            }
            
            /* ÉTATS DE FOCUS COGNITIFS */
            .bn-block-content[contenteditable="true"]:focus {
              outline: none !important;
              background-color: transparent !important;
            }
            
            /* PLACEHOLDERS CONTEXTUELS */
            .bn-block-content[data-placeholder]:before {
              color: var(--text-secondary) !important;
              opacity: 0.7 !important;
              font-style: italic !important;
              content: "Exprimez votre idée..." !important;
            }
            
            /* Sélection personnalisée déplacée vers globals.css pour meilleure portée */
            
            /* MICRO-ANIMATIONS DE COMPOSITION */
            .bn-block-outer {
              animation: fadeInUp 0.5s ease-out !important;
            }
            
            @keyframes fadeInUp {
              from {
                opacity: 0;
                transform: translateY(20px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            
            /* GUIDAGE VISUEL POUR LA PENSÉE STRUCTURÉE */
            
            /* Numérotation discrète des fragments */
            .bn-block-outer::before {
              content: counter(block-counter) !important;
              counter-increment: block-counter !important;
              position: absolute !important;
              left: -2rem !important;
              top: 1.5rem !important;
              width: 1.5rem !important;
              height: 1.5rem !important;
              background: var(--block-border) !important;
              color: var(--text-secondary) !important;
              border-radius: 50% !important;
              display: flex !important;
              align-items: center !important;
              justify-content: center !important;
              font-size: 0.75rem !important;
              font-weight: 600 !important;
              opacity: 0 !important;
              transition: opacity 0.3s ease !important;
            }
            
            .bn-editor {
              counter-reset: block-counter !important;
            }
            
            .bn-block-outer:hover::before {
              opacity: 0.6 !important;
            }
            
            /* Indicateurs de type de contenu */
            .bn-block-outer[data-content-type]::after {
              content: attr(data-content-type) !important;
              position: absolute !important;
              right: -1rem !important;
              top: 0.5rem !important;
              background: var(--accent-secondary) !important;
              color: white !important;
              padding: 0.25rem 0.5rem !important;
              border-radius: 4px !important;
              font-size: 0.6rem !important;
              font-weight: 500 !important;
              text-transform: uppercase !important;
              opacity: 0 !important;
              transition: opacity 0.3s ease !important;
              pointer-events: none !important;
            }
            
            .bn-block-outer:hover[data-content-type]::after {
              opacity: 0.8 !important;
            }
            
            /* Lignes de connexion visuelles entre blocs liés */
            .bn-block-outer + .bn-block-outer::before {
              content: '' !important;
              position: absolute !important;
              left: 50% !important;
              top: -1.5rem !important;
              width: 2px !important;
              height: 1rem !important;
              background: linear-gradient(to bottom, transparent, var(--block-border)) !important;
              transform: translateX(-50%) !important;
              opacity: 0 !important;
              transition: opacity 0.3s ease !important;
            }
            
            .bn-block-outer:hover + .bn-block-outer::before,
            .bn-block-outer + .bn-block-outer:hover::before {
              opacity: 0.4 !important;
            }
            
            /* ESPACEMENT COGNITIF RESPONSIVE selon modèle */
            @media (max-width: 1200px) {
              .bn-editor {
                max-width: 90% !important;
                padding: 3rem 2rem !important;
              }
            }
            
            @media (max-width: 768px) {
              .bn-editor {
                max-width: 95% !important;
                padding: 2rem 1.5rem !important;
              }
              
              .bn-block-outer {
                margin: 1rem 0 !important;
                padding: 0.75rem 1rem !important;
              }
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

        {/* Zone de saisie fixe en bas */}
        <div 
          className="p-4 theme-transition"
          style={{
            borderTop: '1px solid hsl(var(--border))',
            backgroundColor: 'hsl(var(--surface-elevated))'
          }}
        >
          {/* Zone de saisie principale */}
          <div className="max-w-4xl mx-auto">
            <div className="flex items-end space-x-3">
              <div className="flex-1">
                <label 
                  className="block text-xs font-medium mb-2"
                  style={{ color: 'hsl(var(--text-secondary))' }}
                >
                  💭 Nouvelle idée
                </label>
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Écrivez votre pensée... (Ctrl+Entrée pour créer le bloc)"
                  className="w-full rounded-lg transition-all duration-200 outline-none focus-ring resize-none"
                  style={{
                    backgroundColor: 'hsl(var(--background))',
                    border: '1px solid hsl(var(--border))',
                    color: 'hsl(var(--text-primary))',
                    padding: '0.75rem 1rem',
                    minHeight: '60px',
                    maxHeight: '120px',
                    lineHeight: '1.5'
                  }}
                  rows={2}
                />
              </div>
              <button
                onClick={handleCreateBlock}
                disabled={!inputText.trim()}
                className="px-4 py-3 rounded-lg transition-all duration-200 disabled:opacity-50 flex items-center space-x-2"
                style={{
                  backgroundColor: inputText.trim() ? 'hsl(var(--ao-blue))' : 'hsl(var(--muted))',
                  color: inputText.trim() ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
                  marginBottom: '0'
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
                title="Créer un nouveau bloc (Ctrl+Entrée)"
              >
                <span className="text-lg">+</span>
                <span className="hidden sm:inline text-sm">Ajouter</span>
              </button>
            </div>
            
            {/* Conseils discrets */}
            <div 
              className="flex items-center justify-center space-x-6 mt-3 text-xs"
              style={{ color: 'hsl(var(--text-secondary))', opacity: 0.7 }}
            >
              <span>⌨️ <strong>Entrée</strong> = retour ligne</span>
              <span>⌨️ <strong>Ctrl+Entrée</strong> = créer bloc</span>
              <span>⌨️ <strong>Ctrl+S</strong> = sauvegarder</span>
              <span>📅 {new Date(note.updatedAt).toLocaleDateString('fr-FR')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}