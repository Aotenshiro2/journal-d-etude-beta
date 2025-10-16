'use client'

import { useState, useEffect } from 'react'
import ReactFlowCanvas from '@/components/ReactFlowCanvas'
import NotePropertiesModal from '@/components/NotePropertiesModal'
import NoteContentEditor from '@/components/NoteContentEditor'
import Sidebar from '@/components/Sidebar'
import GroupingModal from '@/components/GroupingModal'
import TaggingModal from '@/components/TaggingModal'
import { NoteData, CourseData, ConnectionData, InstructorData } from '@/types'
import { useKeepAlive } from '@/hooks/useKeepAlive'
import { v4 as uuidv4 } from 'uuid'

export default function Home() {
  const [notes, setNotes] = useState<NoteData[]>([])
  const [courses, setCourses] = useState<CourseData[]>([])
  const [instructors, setInstructors] = useState<InstructorData[]>([])
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [selectedCourse, setSelectedCourse] = useState<string>('')
  const [selectedInstructor, setSelectedInstructor] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [connections, setConnections] = useState<ConnectionData[]>([])
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null)
  const [isGroupSelecting, setIsGroupSelecting] = useState(false)
  const [selectedNotes, setSelectedNotes] = useState<string[]>([])
  const [isTagging, setIsTagging] = useState(false)
  const [selectedNoteForTagging, setSelectedNoteForTagging] = useState<string | null>(null)
  const [showTaggingModal, setShowTaggingModal] = useState(false)
  const [appError, setAppError] = useState<string | null>(null)
  const [contentEditorNote, setContentEditorNote] = useState<NoteData | null>(null)
  const [showGroupingModal, setShowGroupingModal] = useState(false)

  // Keep-alive pour maintenir l'app active
  useKeepAlive({ interval: 300000 }) // Ping toutes les 5 minutes

  const selectedNote = selectedNoteId ? notes.find(n => n.id === selectedNoteId) || null : null

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setAppError(null)
      
      // Charger les données essentielles d'abord
      const [notesRes, coursesRes] = await Promise.all([
        fetch('/api/notes').catch(() => ({ ok: false, status: 'network error' })),
        fetch('/api/courses').catch(() => ({ ok: false, status: 'network error' }))
      ])
      
      if (notesRes.ok) {
        const notesData = await notesRes.json()
        setNotes(notesData)
      } else {
        console.warn('Failed to load notes:', notesRes.status)
        setNotes([])
      }
      
      if (coursesRes.ok) {
        const coursesData = await coursesRes.json()
        setCourses(coursesData)
      } else {
        console.warn('Failed to load courses:', coursesRes.status)
        setCourses([])
      }

      // Charger les instructeurs de manière optionnelle
      try {
        const instructorsRes = await fetch('/api/instructors')
        if (instructorsRes.ok) {
          const instructorsData = await instructorsRes.json()
          setInstructors(instructorsData)
        } else {
          console.warn('Failed to load instructors:', instructorsRes.status)
          setInstructors([])
        }
      } catch (instructorError) {
        console.warn('Instructors API not available:', instructorError)
        setInstructors([])
      }

    } catch (error) {
      console.error('Error loading data:', error)
      // Ne pas bloquer l'app, juste logger l'erreur
      setNotes([])
      setCourses([])
      setInstructors([])
    } finally {
      setIsLoading(false)
    }
  }

  const createNote = async (position: { x: number; y: number }, elementType: string = 'note') => {
    const elementConfigs = {
      note: {
        title: 'Note',
        content: 'Cliquez pour éditer...',
        width: 220,
        height: 180,
        backgroundColor: '#fef3c7',
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
          <div className="text-lg font-semibold">🚨 Erreur de l&apos;application</div>
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
    // Désactiver les autres modes si activés
    if (isGroupSelecting) {
      setIsGroupSelecting(false)
      setSelectedNotes([])
    }
    if (isTagging) {
      setIsTagging(false)
    }
  }

  const handleToggleGroupSelection = () => {
    setIsGroupSelecting(!isGroupSelecting)
    setSelectedNotes([])
    // Désactiver les autres modes si activés
    if (isConnecting) {
      setIsConnecting(false)
      setConnectingFromId(null)
    }
    if (isTagging) {
      setIsTagging(false)
    }
  }

  const handleToggleTaggingMode = () => {
    setIsTagging(!isTagging)
    // Désactiver les autres modes si activés
    if (isConnecting) {
      setIsConnecting(false)
      setConnectingFromId(null)
    }
    if (isGroupSelecting) {
      setIsGroupSelecting(false)
      setSelectedNotes([])
    }
  }

  const handleNoteGroupSelect = (noteId: string) => {
    if (!isGroupSelecting) return
    
    setSelectedNotes(prev => {
      if (prev.includes(noteId)) {
        // Désélectionner la note
        return prev.filter(id => id !== noteId)
      } else {
        // Sélectionner la note
        return [...prev, noteId]
      }
    })
  }

  const handleNoteTagClick = (noteId: string) => {
    if (!isTagging) return
    
    setSelectedNoteForTagging(noteId)
    setShowTaggingModal(true)
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

  const deleteNote = async (noteId: string) => {
    // Confirmation avant suppression
    const confirmDelete = window.confirm(
      'Êtes-vous sûr de vouloir supprimer cette note ? Cette action est irréversible.'
    )
    
    if (!confirmDelete) return

    try {
      const response = await fetch(`/api/notes/${noteId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        // Supprimer de l'état local
        setNotes(prev => prev.filter(note => note.id !== noteId))
        
        // Fermer l'éditeur si cette note était sélectionnée
        if (selectedNoteId === noteId) {
          setSelectedNoteId(null)
        }
        
        // Supprimer les connexions liées à cette note
        setConnections(prev => 
          prev.filter(conn => conn.fromId !== noteId && conn.toId !== noteId)
        )
      } else {
        throw new Error('Failed to delete note')
      }
    } catch (error) {
      console.error('Error deleting note:', error)
      alert('Erreur lors de la suppression de la note')
    }
  }

  const openContentEditor = (noteId: string) => {
    const note = notes.find(n => n.id === noteId)
    if (note) {
      setContentEditorNote(note)
    }
  }

  const closeContentEditor = () => {
    setContentEditorNote(null)
  }

  const handleGroupToCourse = async (courseId: string) => {
    if (selectedNotes.length === 0) return

    try {
      // Mettre à jour toutes les notes sélectionnées avec le nouveau courseId
      const updatePromises = selectedNotes.map(noteId => 
        updateNote({ id: noteId, courseId })
      )
      
      await Promise.all(updatePromises)
      
      // Réinitialiser la sélection et sortir du mode groupement
      setSelectedNotes([])
      setIsGroupSelecting(false)
      
      console.log(`${selectedNotes.length} notes groupées dans la formation`)
    } catch (error) {
      console.error('Erreur lors du groupement des notes:', error)
      alert('Erreur lors du groupement des notes')
    }
  }

  const handleCreateCourse = async (courseName: string, instructorId?: string) => {
    const newCourse: CourseData = {
      id: uuidv4(),
      name: courseName,
      color: '#3b82f6',
      instructorId,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    try {
      const response = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCourse)
      })

      if (response.ok) {
        const savedCourse = await response.json()
        setCourses(prev => [...prev, savedCourse])
        
        // Grouper les notes sélectionnées dans cette nouvelle formation
        await handleGroupToCourse(savedCourse.id)
      }
    } catch (error) {
      console.error('Erreur lors de la création de la formation:', error)
      alert('Erreur lors de la création de la formation')
    }
  }

  const handleCreateInstructor = async (instructorName: string) => {
    const newInstructor: InstructorData = {
      id: uuidv4(),
      name: instructorName,
      color: '#6366f1',
      createdAt: new Date(),
      updatedAt: new Date()
    }

    try {
      const response = await fetch('/api/instructors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newInstructor)
      })

      if (response.ok) {
        const savedInstructor = await response.json()
        setInstructors(prev => [...prev, savedInstructor])
      }
    } catch (error) {
      console.error('Erreur lors de la création du formateur:', error)
      alert('Erreur lors de la création du formateur')
    }
  }

  const handleAddConcept = async (noteId: string, conceptName: string, category?: string) => {
    try {
      const response = await fetch(`/api/notes/${noteId}/concepts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          conceptName,
          category,
          description: `Concept ${category || 'personnalisé'} ajouté depuis le tagging`
        })
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        if (response.status === 409) {
          console.log('Concept déjà lié:', errorData.message)
          return // Le concept est déjà lié, pas d'erreur
        }
        throw new Error(errorData.error || 'Erreur lors de l\'ajout du concept')
      }
      
      const result = await response.json()
      console.log('Concept ajouté avec succès:', result)
      
      // Rafraîchir les notes pour mettre à jour l'interface
      await fetchNotes()
    } catch (error) {
      console.error('Erreur lors de l\'ajout du concept:', error)
      alert('Erreur lors de l\'ajout du concept')
    }
  }

  const handleRemoveConcept = async (noteId: string, conceptNameOrId: string) => {
    try {
      // Si conceptNameOrId ressemble à un UUID, c'est un ID, sinon c'est un nom
      let conceptId = conceptNameOrId
      
      if (!conceptNameOrId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        // C'est un nom de concept, on doit récupérer l'ID
        const conceptsResponse = await fetch('/api/concepts')
        if (!conceptsResponse.ok) {
          throw new Error('Impossible de récupérer les concepts')
        }
        const concepts = await conceptsResponse.json()
        const concept = concepts.find((c: any) => c.name === conceptNameOrId)
        
        if (!concept) {
          throw new Error(`Concept "${conceptNameOrId}" introuvable`)
        }
        conceptId = concept.id
      }
      
      const response = await fetch(`/api/notes/${noteId}/concepts?conceptId=${conceptId}`, {
        method: 'DELETE'
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Erreur lors de la suppression du concept')
      }
      
      const result = await response.json()
      console.log('Concept supprimé avec succès:', result)
      
      // Rafraîchir les notes pour mettre à jour l'interface
      await fetchNotes()
    } catch (error) {
      console.error('Erreur lors de la suppression du concept:', error)
      alert('Erreur lors de la suppression du concept')
    }
  }

  return (
    <div className="h-screen w-screen overflow-hidden">
      <Sidebar 
        onElementDrop={handleElementDrop}
        isConnecting={isConnecting}
        onToggleConnectionMode={handleToggleConnectionMode}
        isGroupSelecting={isGroupSelecting}
        onToggleGroupSelection={handleToggleGroupSelection}
        isTagging={isTagging}
        onToggleTaggingMode={handleToggleTaggingMode}
      />
      
      <div className="h-full">
        <ReactFlowCanvas
          notes={filteredNotes}
          connections={connections}
          courses={courses}
          instructors={instructors}
          onNoteUpdate={updateNote}
          onNoteCreate={createNote}
          onNoteSelect={setSelectedNoteId}
          onNoteConnectionClick={handleNoteConnectionClick}
          onConnectionCreate={handleConnectionCreate}
          onNoteDelete={deleteNote}
          onNoteDoubleClick={openContentEditor}
          onNoteGroupSelect={handleNoteGroupSelect}
          onNoteTagClick={handleNoteTagClick}
          selectedNoteId={selectedNoteId}
          selectedNotes={selectedNotes}
          isConnecting={isConnecting}
          connectingFromId={connectingFromId}
          isGroupSelecting={isGroupSelecting}
          isTagging={isTagging}
        />
      </div>

      {selectedNote && !contentEditorNote && (
        <NotePropertiesModal
          note={selectedNote}
          onUpdate={(updates) => updateNote({ ...updates, id: selectedNote.id })}
          onClose={() => setSelectedNoteId(null)}
          onOpenContentEditor={() => openContentEditor(selectedNote.id)}
          courses={courses}
        />
      )}

      {contentEditorNote && (
        <NoteContentEditor
          note={contentEditorNote}
          onUpdate={(updates) => updateNote({ ...updates, id: contentEditorNote.id })}
          onClose={closeContentEditor}
        />
      )}

      {/* Indicateur de mode groupement */}
      {isGroupSelecting && (
        <div className="absolute top-4 right-4 z-50">
          <div className="bg-orange-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center space-x-2">
            <span>🎯</span>
            <span className="text-sm">
              Mode groupement - {selectedNotes.length} note{selectedNotes.length > 1 ? 's' : ''} sélectionnée{selectedNotes.length > 1 ? 's' : ''}
            </span>
            {selectedNotes.length > 0 && (
              <button
                onClick={() => setShowGroupingModal(true)}
                className="ml-2 px-2 py-1 bg-white text-orange-600 rounded text-xs hover:bg-gray-100 transition-colors pointer-events-auto"
              >
                Grouper
              </button>
            )}
          </div>
        </div>
      )}

      {/* Indicateur de mode tagging */}
      {isTagging && (
        <div className="absolute top-4 left-4 z-50 pointer-events-none">
          <div className="bg-purple-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center space-x-2">
            <span>💡</span>
            <span className="text-sm">
              Mode tagging - Cliquez sur une note pour ajouter des concepts
            </span>
          </div>
        </div>
      )}

      {/* Modal de groupement */}
      <GroupingModal
        isOpen={showGroupingModal}
        selectedNotes={selectedNotes}
        courses={courses}
        instructors={instructors}
        onClose={() => setShowGroupingModal(false)}
        onGroupToCourse={handleGroupToCourse}
        onCreateCourse={handleCreateCourse}
        onCreateInstructor={handleCreateInstructor}
      />

      {/* Modal de tagging */}
      <TaggingModal
        isOpen={showTaggingModal}
        note={selectedNoteForTagging ? notes.find(n => n.id === selectedNoteForTagging) || null : null}
        onClose={() => {
          setShowTaggingModal(false)
          setSelectedNoteForTagging(null)
        }}
        onAddConcept={handleAddConcept}
        onRemoveConcept={handleRemoveConcept}
      />
    </div>
  )
}