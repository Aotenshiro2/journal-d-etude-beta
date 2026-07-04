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
  extensionNoteId?: string | null
  firstSyncAt: Date | string
  lastModifiedAt: Date | string
  messages?: MessageData[]
  concepts?: string[]
  folderId?: string | null
  folderName?: string | null
  tags?: { tag: TagData }[]
  annotations?: AnnotationData[]
  trades?: TradeSegmentData[] | null
  worked?: boolean // canvas d'étude non vide
}

export interface MessageData {
  id: string
  noteId: string
  content: string
  order: number
  type: string
  tradeRef?: string | null
  tags?: { tag: TagData }[]
}

// Notation A/B/C (masterclass edge) — miroir du modèle extension
export interface AnnotationData {
  id: string
  noteId?: string | null
  messageRef?: string | null
  tradeRef?: string | null
  grade: string // 'A' | 'B' | 'C'
  phrase: string
  causeCategory?: string | null // 'technique' | 'connaissance' | 'emotionnel'
  createdAt: Date | string
  reviewDueAt?: Date | string | null
  reviewedAt?: Date | string | null
}

// Segment de trade (stocké en Json sur Note, source de vérité extension)
export interface TradeSegmentData {
  id: string
  startedAt: number
  closedAt?: number
  outcome?: 'gain' | 'perte' | 'be'
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
  kind?: string // 'message' | 'group' | 'text'
  content?: string | null // surcharge locale (copie de travail) ou contenu du bloc libre
  label?: string | null // nom du groupe (proto-concept)
  color?: string | null // clé de palette du groupe
  parentId?: string | null // groupe parent — x/y relatifs au parent
  orderInParent?: number | null
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
  fromHandle?: string | null
  toHandle?: string | null
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
