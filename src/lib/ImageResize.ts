import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface ImageResizeOptions {
  allowedMimeTypes: string[]
  maxFileSize: number
}

export const ImageResize = Extension.create<ImageResizeOptions>({
  name: 'imageResize',

  addOptions() {
    return {
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      maxFileSize: 5 * 1024 * 1024, // 5MB
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('imageResize'),
        props: {
          decorations: (state) => {
            const { doc, selection } = state
            const decorations: Decoration[] = []

            // Ajouter des handles de redimensionnement seulement si une image est sélectionnée
            if (selection.empty) return DecorationSet.empty

            const { from, to } = selection
            const selectedNode = doc.nodeAt(from)

            if (selectedNode && selectedNode.type.name === 'resizableImage') {
              // Créer une décoration avec des handles de redimensionnement
              const decoration = Decoration.widget(to, () => {
                const container = document.createElement('div')
                container.className = 'image-resize-container'
                container.style.cssText = `
                  position: absolute;
                  border: 2px solid #3b82f6;
                  pointer-events: none;
                  z-index: 10;
                `

                // Handles de redimensionnement
                const positions = [
                  { class: 'resize-handle-nw', style: 'top: -4px; left: -4px; cursor: nw-resize;' },
                  { class: 'resize-handle-ne', style: 'top: -4px; right: -4px; cursor: ne-resize;' },
                  { class: 'resize-handle-sw', style: 'bottom: -4px; left: -4px; cursor: sw-resize;' },
                  { class: 'resize-handle-se', style: 'bottom: -4px; right: -4px; cursor: se-resize;' },
                ]

                positions.forEach(({ class: className, style }) => {
                  const handle = document.createElement('div')
                  handle.className = className
                  handle.style.cssText = `
                    position: absolute;
                    width: 8px;
                    height: 8px;
                    background: #3b82f6;
                    border: 1px solid #fff;
                    pointer-events: all;
                    ${style}
                  `
                  container.appendChild(handle)
                })

                return container
              })

              decorations.push(decoration)
            }

            return DecorationSet.create(doc, decorations)
          },

          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = event.target as HTMLElement
              
              if (target.classList.contains('resize-handle-se')) {
                event.preventDefault()
                
                const startX = event.clientX
                const startY = event.clientY
                const { state, dispatch } = view
                const { selection } = state
                
                if (selection.empty) return false
                
                const selectedNode = state.doc.nodeAt(selection.from)
                if (!selectedNode || selectedNode.type.name !== 'resizableImage') return false
                
                const currentWidth = selectedNode.attrs.width || 300
                const currentHeight = selectedNode.attrs.height || 200
                
                const handleMouseMove = (e: MouseEvent) => {
                  const deltaX = e.clientX - startX
                  const deltaY = e.clientY - startY
                  
                  const newWidth = Math.max(50, currentWidth + deltaX)
                  const newHeight = Math.max(50, currentHeight + deltaY)
                  
                  const tr = state.tr.setNodeMarkup(selection.from, undefined, {
                    ...selectedNode.attrs,
                    width: newWidth,
                    height: newHeight,
                  })
                  
                  dispatch(tr)
                }
                
                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove)
                  document.removeEventListener('mouseup', handleMouseUp)
                }
                
                document.addEventListener('mousemove', handleMouseMove)
                document.addEventListener('mouseup', handleMouseUp)
                
                return true
              }
              
              return false
            },
          },
        },
      }),
    ]
  },
})