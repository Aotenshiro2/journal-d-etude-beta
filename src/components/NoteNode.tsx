'use client'

import { Handle, Position, NodeProps, NodeResizer } from '@xyflow/react'
import { NoteData } from '@/types'
import { Edit, Trash2, Clock, Tag, GraduationCap, User } from 'lucide-react'
import { stripHtml, formatRelativeTime } from '@/lib/utils'
import { useState, useRef, useCallback } from 'react'

interface NoteNodeData extends NoteData {
  isSelected?: boolean
  isGroupSelected?: boolean
  isConnecting?: boolean
  isConnectingFrom?: boolean
  isGroupSelecting?: boolean
  isTagging?: boolean
  onEdit?: (noteId: string) => void
  onDelete?: (noteId: string) => void
  onDoubleClick?: (nodeId: string) => void
  onGroupSelect?: (noteId: string) => void
  onTagClick?: (noteId: string) => void
  onResize?: (noteId: string, width: number, height: number) => void
  // Données enrichies
  courseName?: string
  instructorName?: string
  concepts?: string[]
}

// Sous-composants modulaires inspirés d'AI Elements
function NodeHeader({ title, description, textColor }: { title: string; description?: string; textColor: string }) {
  return (
    <div className="border-b border-gray-100 pb-2 mb-2">
      <div
        className="font-semibold text-sm truncate"
        style={{ color: textColor }}
      >
        {title}
      </div>
      {description && (
        <div className="text-xs text-gray-500 truncate mt-1">
          {description}
        </div>
      )}
    </div>
  )
}

function NodeContent({ content }: { content: string }) {
  const cleanContent = stripHtml(content)
  
  return (
    <div className="flex-1 overflow-hidden">
      <div
        className="text-xs leading-relaxed text-gray-600"
        style={{ 
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          textOverflow: 'ellipsis',
          overflow: 'hidden'
        }}
      >
        {cleanContent?.trim() || 'Cliquez pour éditer...'}
      </div>
    </div>
  )
}

function NodeMetadata({ courseName, instructorName }: { courseName?: string; instructorName?: string }) {
  if (!courseName && !instructorName) return null
  
  return (
    <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
      {courseName && (
        <div className="flex items-center space-x-1 truncate">
          <GraduationCap className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{courseName}</span>
        </div>
      )}
      {instructorName && (
        <div className="flex items-center space-x-1 truncate">
          <User className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{instructorName}</span>
        </div>
      )}
    </div>
  )
}

function NodeConcepts({ concepts }: { concepts?: string[] }) {
  if (!concepts || concepts.length === 0) return null
  
  const displayedConcepts = concepts.slice(0, 2)
  const remainingCount = concepts.length - 2
  
  return (
    <div className="flex flex-wrap gap-1 mb-2">
      {displayedConcepts.map((concept, index) => (
        <span
          key={index}
          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700"
        >
          <Tag className="w-2.5 h-2.5 mr-1" />
          {concept}
        </span>
      ))}
      {remainingCount > 0 && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
          +{remainingCount}
        </span>
      )}
    </div>
  )
}

function NodeFooter({ updatedAt }: { updatedAt: Date }) {
  const timeText = formatRelativeTime(updatedAt)

  return (
    <div className="border-t border-gray-100 pt-2 mt-2">
      <div className="flex items-center justify-between text-xs text-gray-400">
        <div className="flex items-center space-x-1">
          <Clock className="w-3 h-3" />
          <span>{timeText}</span>
        </div>
        <div className="text-xs text-gray-400">
          {new Date(updatedAt).toLocaleDateString('fr-FR')}
        </div>
      </div>
    </div>
  )
}

function NodeToolbar({ onEdit, onDelete }: { onEdit: (e: React.MouseEvent) => void; onDelete: (e: React.MouseEvent) => void }) {
  return (
    <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-all duration-300 transform scale-95 group-hover:scale-100 bg-white rounded-lg shadow-lg border border-gray-200 flex">
      <button
        onClick={onEdit}
        className="p-2 hover:bg-blue-50 hover:text-blue-600 rounded-l-lg transition-all duration-200 transform hover:scale-110"
        title="Éditer"
      >
        <Edit className="w-3 h-3 text-gray-600" />
      </button>
      <button
        onClick={onDelete}
        className="p-2 hover:bg-red-50 hover:text-red-600 rounded-r-lg transition-all duration-200 transform hover:scale-110 border-l border-gray-200"
        title="Supprimer"
      >
        <Trash2 className="w-3 h-3 text-red-600" />
      </button>
    </div>
  )
}

// Le NodeResizer natif remplace notre implémentation custom

export default function NoteNode({ data, selected }: NodeProps<NoteNodeData>) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Si on est en mode groupement, gérer la sélection
    if (data.isGroupSelecting && data.onGroupSelect) {
      data.onGroupSelect(data.id)
    }
    // Si on est en mode tagging, gérer l'ajout de tags
    else if (data.isTagging && data.onTagClick) {
      data.onTagClick(data.id)
    }
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (data.onDoubleClick) {
      data.onDoubleClick(data.id)
    }
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (data.onEdit) {
      data.onEdit(data.id)
    }
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (data.onDelete) {
      data.onDelete(data.id)
    }
  }

  // Déterminer la couleur de bordure selon l'état
  let borderColor = '#e5e7eb'
  let borderWidth = '1px'
  let shadowClass = 'shadow-md'
  
  if (selected) {
    borderColor = '#3b82f6'
    borderWidth = '2px'
    shadowClass = 'shadow-lg shadow-blue-200'
  } else if (data.isGroupSelected) {
    borderColor = '#f59e0b'
    borderWidth = '3px'
    shadowClass = 'shadow-lg shadow-orange-200'
  } else if (data.isConnectingFrom) {
    borderColor = '#10b981'
    borderWidth = '3px'
    shadowClass = 'shadow-lg shadow-green-200'
  } else if (data.isConnecting) {
    borderColor = '#f59e0b'
    borderWidth = '2px'
    shadowClass = 'shadow-lg shadow-orange-200'
  } else if (data.isGroupSelecting) {
    // Effet visuel quand on est en mode sélection de groupe
    borderColor = '#fbbf24'
    borderWidth = '1px'
    shadowClass = 'shadow-md hover:shadow-lg hover:shadow-orange-100'
  } else if (data.isTagging) {
    // Effet visuel quand on est en mode tagging
    borderColor = '#a855f7'
    borderWidth = '1px'
    shadowClass = 'shadow-md hover:shadow-lg hover:shadow-purple-100'
  }

  return (
    <div
      onClick={handleClick}
      className="relative group cursor-pointer"
      style={{
        width: data.width,
        height: data.height,
      }}
    >
      {/* Handles de connexion - Configuration optimisée */}
      {/* Handles Target (entrée) - Côtés gauche et haut */}
      <Handle
        id="target-top"
        type="target"
        position={Position.Top}
        className="w-4 h-4 !bg-blue-500 !border-2 !border-white !opacity-0 group-hover:!opacity-100 transition-all duration-300 hover:!scale-125 hover:!bg-blue-600 shadow-lg"
        style={{ top: '-8px', left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}
      />
      <Handle
        id="target-left"
        type="target"
        position={Position.Left}
        className="w-4 h-4 !bg-blue-500 !border-2 !border-white !opacity-0 group-hover:!opacity-100 transition-all duration-300 hover:!scale-125 hover:!bg-blue-600 shadow-lg"
        style={{ left: '-8px', top: '50%', transform: 'translateY(-50%)', zIndex: 10 }}
      />
      
      {/* Handles Source (sortie) - Côtés droite et bas */}
      <Handle
        id="source-right"
        type="source"
        position={Position.Right}
        className="w-4 h-4 !bg-green-500 !border-2 !border-white !opacity-0 group-hover:!opacity-100 transition-all duration-300 hover:!scale-125 hover:!bg-green-600 shadow-lg"
        style={{ right: '-8px', top: '50%', transform: 'translateY(-50%)', zIndex: 10 }}
      />
      <Handle
        id="source-bottom"
        type="source"
        position={Position.Bottom}
        className="w-4 h-4 !bg-green-500 !border-2 !border-white !opacity-0 group-hover:!opacity-100 transition-all duration-300 hover:!scale-125 hover:!bg-green-600 shadow-lg"
        style={{ bottom: '-8px', left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}
      />

      {/* Contenu de la note avec structure modulaire */}
      <div
        className={`drag-handle w-full h-full rounded-lg ${shadowClass} transition-all duration-300 hover:shadow-xl hover:scale-[1.02] p-3 bg-white flex flex-col cursor-move`}
        style={{
          backgroundColor: data.backgroundColor,
          borderColor: borderColor,
          borderWidth: borderWidth,
          borderStyle: 'solid',
        }}
        onDoubleClick={handleDoubleClick}
      >
        <NodeHeader 
          title={data.title} 
          description="Note d'étude"
          textColor={data.textColor} 
        />
        
        <NodeMetadata 
          courseName={data.courseName}
          instructorName={data.instructorName}
        />
        
        <NodeConcepts concepts={data.concepts} />
        
        <NodeContent content={data.content} />
        
        <NodeFooter updatedAt={data.updatedAt} />
      </div>

      {/* Toolbar flottante */}
      <NodeToolbar onEdit={handleEdit} onDelete={handleDelete} />
      
      {/* NodeResizer natif React Flow */}
      <NodeResizer
        color="#3b82f6"
        isVisible={selected}
        minWidth={200}
        minHeight={150}
        onResize={(event, params) => {
          if (data.onResize) {
            data.onResize(data.id, params.width, params.height)
          }
        }}
        keepAspectRatio={false}
      />
    </div>
  )
}