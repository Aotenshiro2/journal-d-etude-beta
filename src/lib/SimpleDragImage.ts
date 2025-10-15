import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface SimpleDragImageOptions {
  inline: boolean
  allowBase64: boolean
  HTMLAttributes: Record<string, any>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    simpleDragImage: {
      setImage: (options: { src: string; alt?: string; title?: string; width?: number; height?: number }) => ReturnType
    }
  }
}

export const inputRegex = /(?:^|\s)(!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\))$/

export const SimpleDragImage = Node.create<SimpleDragImageOptions>({
  name: 'simpleDragImage',

  addOptions() {
    return {
      inline: false,
      allowBase64: true,
      HTMLAttributes: {},
    }
  },

  inline() {
    return this.options.inline
  },

  group() {
    return this.options.inline ? 'inline' : 'block'
  },

  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      width: {
        default: 400,
        parseHTML: element => {
          const width = element.style.width || element.getAttribute('width')
          return width ? parseInt(width, 10) : 400
        },
        renderHTML: attributes => {
          if (!attributes.width) return {}
          return {
            width: attributes.width,
            style: `width: ${attributes.width}px;`,
          }
        },
      },
      height: {
        default: 300,
        parseHTML: element => {
          const height = element.style.height || element.getAttribute('height')
          return height ? parseInt(height, 10) : 300
        },
        renderHTML: attributes => {
          if (!attributes.height) return {}
          return {
            height: attributes.height,
            style: `height: ${attributes.height}px;`,
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: this.options.allowBase64
          ? 'img[src]'
          : 'img[src]:not([src^="data:"])',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)]
  },

  addCommands() {
    return {
      setImage:
        options =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          })
        },
    }
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: inputRegex,
        type: this.type,
        getAttributes: match => {
          const [, , alt, src, title] = match
          return { src, alt, title }
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('imageDragResize'),
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement
              
              if (target.tagName !== 'IMG') return false
              
              // Vérifier si l'image est de notre type
              const pos = view.posAtDOM(target, 0)
              const node = view.state.doc.nodeAt(pos)
              
              if (!node || node.type.name !== 'simpleDragImage') return false
              
              // Sélectionner l'image
              const tr = view.state.tr.setSelection(
                view.state.schema.createNodeSelection(view.state.doc.resolve(pos))
              )
              view.dispatch(tr)
              
              // Ajouter les handles de redimensionnement après sélection
              setTimeout(() => {
                addResizeHandles(target, view, pos)
              }, 10)
              
              return false
            },
          },
        },
        view() {
          return {
            update: (view, prevState) => {
              // Nettoyer les handles existants quand la sélection change
              if (view.state.selection !== prevState.selection) {
                const existingHandles = document.querySelectorAll('.image-resize-container')
                existingHandles.forEach(handle => handle.remove())
                
                // Si une image est sélectionnée, ajouter les handles
                const { selection } = view.state
                if (selection.node && selection.node.type.name === 'simpleDragImage') {
                  const pos = selection.from
                  const domNode = view.nodeDOM(pos) as HTMLElement
                  if (domNode && domNode.tagName === 'IMG') {
                    setTimeout(() => {
                      addResizeHandles(domNode, view, pos)
                    }, 10)
                  }
                }
              }
            }
          }
        }
      }),
    ]
  },
})

function addResizeHandles(img: HTMLElement, view: any, pos: number) {
  // Supprimer les handles existants
  const existingHandles = document.querySelectorAll('.image-resize-handle')
  existingHandles.forEach(handle => handle.remove())
  
  // Créer un conteneur pour les handles
  const container = document.createElement('div')
  container.className = 'image-resize-container'
  container.style.cssText = `
    position: absolute;
    pointer-events: none;
    z-index: 10;
    border: 2px solid #3b82f6;
    border-radius: 4px;
  `
  
  // Positionner le conteneur sur l'image
  const imgRect = img.getBoundingClientRect()
  const editorRect = view.dom.getBoundingClientRect()
  
  container.style.left = `${imgRect.left - editorRect.left - 2}px`
  container.style.top = `${imgRect.top - editorRect.top - 2}px`
  container.style.width = `${imgRect.width + 4}px`
  container.style.height = `${imgRect.height + 4}px`
  
  // Créer les handles (seulement les coins pour simplifier)
  const handles = [
    { class: 'nw-resize', style: 'top: -6px; left: -6px; cursor: nw-resize;' },
    { class: 'ne-resize', style: 'top: -6px; right: -6px; cursor: ne-resize;' },
    { class: 'sw-resize', style: 'bottom: -6px; left: -6px; cursor: sw-resize;' },
    { class: 'se-resize', style: 'bottom: -6px; right: -6px; cursor: se-resize;' },
  ]
  
  handles.forEach(({ class: className, style }) => {
    const handle = document.createElement('div')
    handle.className = `image-resize-handle ${className}`
    handle.style.cssText = `
      position: absolute;
      width: 12px;
      height: 12px;
      background: #3b82f6;
      border: 2px solid #fff;
      border-radius: 50%;
      pointer-events: all;
      ${style}
    `
    
    // Ajouter le gestionnaire de redimensionnement
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      
      const startX = e.clientX
      const startY = e.clientY
      const node = view.state.doc.nodeAt(pos)
      const currentWidth = node?.attrs.width || imgRect.width
      const currentHeight = node?.attrs.height || imgRect.height
      const aspectRatio = currentWidth / currentHeight
      
      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX
        const deltaY = moveEvent.clientY - startY
        
        let newWidth = currentWidth
        let newHeight = currentHeight
        
        // Calcul selon le coin sélectionné
        if (className.includes('e')) {
          newWidth = currentWidth + deltaX
        }
        if (className.includes('w')) {
          newWidth = currentWidth - deltaX
        }
        if (className.includes('s')) {
          newHeight = currentHeight + deltaY
        }
        if (className.includes('n')) {
          newHeight = currentHeight - deltaY
        }
        
        // Contraintes minimales
        newWidth = Math.max(50, newWidth)
        newHeight = Math.max(50, newHeight)
        
        // Maintenir le ratio d'aspect sauf si Shift est pressé
        if (!moveEvent.shiftKey) {
          if (Math.abs(deltaX) > Math.abs(deltaY)) {
            newHeight = newWidth / aspectRatio
          } else {
            newWidth = newHeight * aspectRatio
          }
        }
        
        // Mettre à jour l'attribut du nœud
        const tr = view.state.tr.setNodeMarkup(pos, undefined, {
          ...node?.attrs,
          width: Math.round(newWidth),
          height: Math.round(newHeight),
        })
        
        view.dispatch(tr)
      }
      
      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        container.remove()
      }
      
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    })
    
    container.appendChild(handle)
  })
  
  view.dom.appendChild(container)
  
  // Supprimer les handles après 3 secondes d'inactivité
  setTimeout(() => {
    if (container.parentNode) {
      container.remove()
    }
  }, 3000)
}