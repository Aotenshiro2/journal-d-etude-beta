export interface NoteData {
  id: string
  title: string
  content: string
  contentHash?: string | null
  userId: string
  source?: string | null
  sourceUrl?: string | null
  favicon?: string | null
  lastSyncAt?: Date | string | null
  createdAt?: Date | string | null
  firstSyncAt: Date | string
  lastModifiedAt: Date | string
  messages?: MessageData[]
}

export interface MessageData {
  id: string
  noteId: string
  content: string
  order: number
  type: string
  tags?: { tag: TagData }[]
}

export interface CanvasData {
  id: string
  type: string
  userId: string
  noteId?: string | null
  noteContentHash?: string | null
  createdAt: Date | string
  updatedAt: Date | string
  nodes: CanvasNodeData[]
  edges: CanvasEdgeData[]
}

export interface CanvasNodeData {
  id: string
  canvasId: string
  messageId?: string | null
  noteId?: string | null
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasEdgeData {
  id: string
  canvasId: string
  fromId: string
  toId: string
  label?: string | null
  style: string
}

export interface TagData {
  id: string
  name: string
  category?: string | null
  color: string
  userId: string
}
