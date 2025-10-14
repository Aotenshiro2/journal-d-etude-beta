'use client'

import { Handle, Position, NodeProps } from '@xyflow/react'
import { NoteData } from '@/types'
import { Edit, Trash2, Clock } from 'lucide-react'

interface NoteNodeData extends NoteData {
  isSelected?: boolean
  isGroupSelected?: boolean
  isConnecting?: boolean
  isConnectingFrom?: boolean
  isGroupSelecting?: boolean
  isTagging?: boolean
  onEdit?: (noteId: string) => void
  onDelete?: (noteId: string) => void
  onDoubleClick?: (noteId: string) => void
  onGroupSelect?: (noteId: string) => void
  onTagClick?: (noteId: string) => void
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
  return (
    <div className="flex-1 overflow-hidden">
      <div
        className="text-xs leading-relaxed text-gray-600"
        style={{ 
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          textOverflow: 'ellipsis',
          overflow: 'hidden'
        }}
      >
        {content?.trim() || 'Cliquez pour éditer...'}
      </div>
    </div>
  )
}

function NodeFooter({ updatedAt }: { updatedAt: Date }) {
  const timeAgo = new Date().getTime() - new Date(updatedAt).getTime()
  const minutes = Math.floor(timeAgo / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  
  let timeText = 'À l\'instant'
  if (days > 0) timeText = `${days}j`
  else if (hours > 0) timeText = `${hours}h`
  else if (minutes > 0) timeText = `${minutes}m`

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
    <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white rounded-lg shadow-lg border border-gray-200 flex">
      <button
        onClick={onEdit}
        className="p-2 hover:bg-gray-50 rounded-l-lg transition-colors"
        title="Éditer"
      >
        <Edit className="w-3 h-3 text-gray-600" />
      </button>
      <button
        onClick={onDelete}
        className="p-2 hover:bg-red-50 rounded-r-lg transition-colors border-l border-gray-200"
        title="Supprimer"
      >
        <Trash2 className="w-3 h-3 text-red-600" />
      </button>
    </div>
  )
}

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
      {/* Handles de connexion */}
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-blue-500 !border-2 !border-white opacity-0 group-hover:opacity-100 transition-opacity"
      />
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 !bg-blue-500 !border-2 !border-white opacity-0 group-hover:opacity-100 transition-opacity"
      />
      <Handle
        type="target"
        position={Position.Right}
        className="w-3 h-3 !bg-blue-500 !border-2 !border-white opacity-0 group-hover:opacity-100 transition-opacity"
      />
      <Handle
        type="target"
        position={Position.Bottom}
        className="w-3 h-3 !bg-blue-500 !border-2 !border-white opacity-0 group-hover:opacity-100 transition-opacity"
      />
      
      <Handle
        type="source"
        position={Position.Top}
        className="w-3 h-3 !bg-green-500 !border-2 !border-white opacity-0 group-hover:opacity-100 transition-opacity"
      />
      <Handle
        type="source"
        position={Position.Left}
        className="w-3 h-3 !bg-green-500 !border-2 !border-white opacity-0 group-hover:opacity-100 transition-opacity"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 !bg-green-500 !border-2 !border-white opacity-0 group-hover:opacity-100 transition-opacity"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-green-500 !border-2 !border-white opacity-0 group-hover:opacity-100 transition-opacity"
      />

      {/* Contenu de la note avec structure modulaire */}
      <div
        className={`drag-handle w-full h-full rounded-lg ${shadowClass} transition-all duration-200 hover:shadow-xl p-3 bg-white flex flex-col`}
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
        
        <NodeContent content={data.content} />
        
        <NodeFooter updatedAt={data.updatedAt} />
      </div>

      {/* Toolbar flottante */}
      <NodeToolbar onEdit={handleEdit} onDelete={handleDelete} />
    </div>
  )
}