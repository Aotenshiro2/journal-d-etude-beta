export interface Position {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface NoteData {
  id: string
  title: string
  content: string
  x: number
  y: number
  width: number
  height: number
  backgroundColor: string
  textColor: string
  courseId?: string
  createdAt: Date
  updatedAt: Date
}

export interface InstructorData {
  id: string
  name: string
  email?: string
  avatar?: string
  color: string
  createdAt: Date
  updatedAt: Date
}

export interface CourseData {
  id: string
  name: string
  description?: string
  color: string
  instructorId?: string
  instructor?: InstructorData
  createdAt: Date
  updatedAt: Date
}

export interface ConceptData {
  id: string
  name: string
  description?: string
  category?: string
  frequency: number
  createdAt: Date
}

export interface ConnectionData {
  id: string
  fromId: string
  toId: string
  label?: string
  fromPoint?: { x: number; y: number }
  toPoint?: { x: number; y: number }
  color?: string
  style?: 'straight' | 'curved' | 'elbow'
  strokeWidth?: number
}

export interface CanvasState {
  zoom: number
  pan: Position
  selectedNoteId?: string
  isConnecting?: boolean
  connectingFromId?: string
  isGroupSelecting?: boolean
  groupSelection?: {
    startPoint: Position
    endPoint: Position
    selectedItems: string[]
  }
  tempConnection?: {
    fromId: string
    startPoint: Position
    endPoint: Position
  }
}

export interface ICTConcepts {
  [key: string]: {
    category: string
    definition: string
    keywords: string[]
    weight: number
  }
}