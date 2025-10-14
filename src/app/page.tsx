'use client'

import { useState, useEffect } from 'react'
import ReactFlowCanvas from '@/components/ReactFlowCanvas'
import NoteEditor from '@/components/NoteEditor'
import Sidebar from '@/components/Sidebar'
import { NoteData, CourseData, ConnectionData } from '@/types'
import { useKeepAlive } from '@/hooks/useKeepAlive'
import { v4 as uuidv4 } from 'uuid'

export default function Home() {
  const [notes, setNotes] = useState<NoteData[]>([])
  const [courses, setCourses] = useState<CourseData[]>([])
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [selectedCourse, setSelectedCourse] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [connections, setConnections] = useState<ConnectionData[]>([])
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null)
  const [appError, setAppError] = useState<string | null>(null)

  // Keep-alive pour maintenir l'app active
  useKeepAlive({ interval: 300000 }) // Ping toutes les 5 minutes

  const selectedNote = selectedNoteId ? notes.find(n => n.id === selectedNoteId) || null : null

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setAppError(null)
      const [notesRes, coursesRes] = await Promise.all([
        fetch('/api/notes'),
        fetch('/api/courses')
      ])
      
      if (notesRes.ok) {
        const notesData = await notesRes.json()
        setNotes(notesData)
      } else {
        throw new Error(`Failed to load notes: ${notesRes.status}`)
      }
      
      if (coursesRes.ok) {
        const coursesData = await coursesRes.json()
        setCourses(coursesData)
      } else {
        throw new Error(`Failed to load courses: ${coursesRes.status}`)
      }
    } catch (error) {
      console.error('Error loading data:', error)
      setAppError(`Erreur de chargement: ${error instanceof Error ? error.message : 'Erreur inconnue'}`)
    } finally {
      setIsLoading(false)
    }
  }

  const createNote = async (position: { x: number; y: number }, elementType: string = 'note') => {
    const elementConfigs = {
      note: {
        title: 'Note',
        content: 'Cliquez pour éditer...',
        width: 200,
        height: 140,
        backgroundColor: '#fef3c7',
        textColor: '#000000'
      },
      concept: {
        title: 'Concept',
        content: 'Concept ICT...',
        width: 220,
        height: 120,
        backgroundColor: '#dbeafe',
        textColor: '#000000'
      },
      arrow: {
        title: 'Flèche',
        content: '',
        width: 100,
        height: 40,
        backgroundColor: 'transparent',
        textColor: '#000000'
      },
      'shape-rect': {
        title: 'Rectangle',
        content: '',
        width: 160,
        height: 80,
        backgroundColor: '#e0e7ff',
        textColor: '#000000'
      },
      'shape-circle': {
        title: 'Cercle',
        content: '',
        width: 120,
        height: 120,
        backgroundColor: '#d1fae5',
        textColor: '#000000'
      }
    }

    const config = elementConfigs[elementType as keyof typeof elementConfigs] || elementConfigs.note

    const newNote: NoteData = {
      id: uuidv4(),
      title: config.title,
      content: config.content,
      x: position.x,
      y: position.y,
      width: config.width,
      height: config.height,
      backgroundColor: config.backgroundColor,
      textColor: config.textColor,
      courseId: selectedCourse || undefined,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    try {
      const response = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newNote)
      })

      if (response.ok) {
        const savedNote = await response.json()
        setNotes(prev => [...prev, savedNote])
        setSelectedNoteId(savedNote.id)
      }
    } catch (error) {
      console.error('Error creating note:', error)
      setNotes(prev => [...prev, newNote])
      setSelectedNoteId(newNote.id)
    }
  }

  const updateNote = async (updates: Partial<NoteData> & { id: string }) => {
    const updatedNotes = notes.map(note => 
      note.id === updates.id 
        ? { ...note, ...updates, updatedAt: new Date() }
        : note
    )
    setNotes(updatedNotes)

    try {
      await fetch(`/api/notes/${updates.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updates, updatedAt: new Date() })
      })
    } catch (error) {
      console.error('Error updating note:', error)
    }
  }

  const createCourse = () => {
    const courseName = prompt('Nom du cours :')
    if (!courseName) return

    const newCourse: CourseData = {
      id: uuidv4(),
      name: courseName,
      color: '#3b82f6',
      createdAt: new Date(),
      updatedAt: new Date()
    }

    setCourses(prev => [...prev, newCourse])
    setSelectedCourse(newCourse.id)

    fetch('/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCourse)
    }).catch(error => console.error('Error creating course:', error))
  }

  const exportToPDF = async () => {
    const filteredNotes = selectedCourse 
      ? notes.filter(note => note.courseId === selectedCourse)
      : notes

    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: filteredNotes })
      })

      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `notes-${new Date().toISOString().split('T')[0]}.pdf`
        a.click()
        window.URL.revokeObjectURL(url)
      }
    } catch (error) {
      console.error('Error exporting PDF:', error)
      alert('Erreur lors de l\'export PDF')
    }
  }

  const filteredNotes = selectedCourse 
    ? notes.filter(note => note.courseId === selectedCourse)
    : notes

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-lg">Chargement...</div>
      </div>
    )
  }

  if (appError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen space-y-4">
        <div className="text-red-600 text-center">
          <div className="text-lg font-semibold">🚨 Erreur de l'application</div>
          <div className="text-sm mt-2">{appError}</div>
        </div>
        <button
          onClick={() => {
            setIsLoading(true)
            loadData()
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          🔄 Réessayer
        </button>
      </div>
    )
  }

  const handleElementDrop = (elementType: string, position: { x: number; y: number }) => {
    createNote(position, elementType)
  }

  const handleToggleConnectionMode = () => {
    setIsConnecting(!isConnecting)
    setConnectingFromId(null)
  }

  const handleNoteConnectionClick = (noteId: string) => {
    if (!isConnecting) return

    if (!connectingFromId) {
      // Premier clic : sélectionner la note source
      setConnectingFromId(noteId)
    } else if (connectingFromId !== noteId) {
      // Deuxième clic : créer la connexion
      const newConnection: ConnectionData = {
        id: uuidv4(),
        fromId: connectingFromId,
        toId: noteId,
        color: '#6b7280',
        style: 'straight',
        strokeWidth: 2
      }
      
      setConnections(prev => [...prev, newConnection])
      setConnectingFromId(null)
      setIsConnecting(false)
      
      // TODO: Sauvegarder en base de données
    } else {
      // Clic sur la même note : annuler
      setConnectingFromId(null)
    }
  }

  const handleConnectionCreate = (connection: { source: string; target: string }) => {
    const newConnection: ConnectionData = {
      id: uuidv4(),
      fromId: connection.source,
      toId: connection.target,
      color: '#6b7280',
      style: 'straight',
      strokeWidth: 2
    }
    
    setConnections(prev => [...prev, newConnection])
    // TODO: Sauvegarder en base de données
  }

  return (
    <div className="h-screen w-screen overflow-hidden">
      <Sidebar 
        onElementDrop={handleElementDrop}
        isConnecting={isConnecting}
        onToggleConnectionMode={handleToggleConnectionMode}
      />
      
      <div className="h-full">
        <ReactFlowCanvas
          notes={filteredNotes}
          connections={connections}
          onNoteUpdate={updateNote}
          onNoteCreate={createNote}
          onNoteSelect={setSelectedNoteId}
          onNoteConnectionClick={handleNoteConnectionClick}
          onConnectionCreate={handleConnectionCreate}
          selectedNoteId={selectedNoteId}
          isConnecting={isConnecting}
          connectingFromId={connectingFromId}
        />
      </div>

      {selectedNote && (
        <NoteEditor
          note={selectedNote}
          onUpdate={(updates) => updateNote({ ...updates, id: selectedNote.id })}
          onClose={() => setSelectedNoteId(null)}
        />
      )}
    </div>
  )
}