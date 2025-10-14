'use client'

import { useState, useEffect } from 'react'
import Canvas from '@/components/Canvas'
import NoteEditor from '@/components/NoteEditor'
import Toolbar from '@/components/Toolbar'
import { NoteData, CourseData } from '@/types'
import { v4 as uuidv4 } from 'uuid'

export default function Home() {
  const [notes, setNotes] = useState<NoteData[]>([])
  const [courses, setCourses] = useState<CourseData[]>([])
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [selectedCourse, setSelectedCourse] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)

  const selectedNote = selectedNoteId ? notes.find(n => n.id === selectedNoteId) || null : null

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [notesRes, coursesRes] = await Promise.all([
        fetch('/api/notes'),
        fetch('/api/courses')
      ])
      
      if (notesRes.ok) {
        const notesData = await notesRes.json()
        setNotes(notesData)
      }
      
      if (coursesRes.ok) {
        const coursesData = await coursesRes.json()
        setCourses(coursesData)
      }
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const createNote = async (position: { x: number; y: number }) => {
    const newNote: NoteData = {
      id: uuidv4(),
      title: 'Nouvelle note',
      content: '',
      x: position.x,
      y: position.y,
      width: 300,
      height: 200,
      backgroundColor: '#ffffff',
      textColor: '#000000',
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

  return (
    <div className="h-screen w-screen overflow-hidden">
      <Toolbar
        courses={courses}
        selectedCourse={selectedCourse}
        onCourseSelect={setSelectedCourse}
        onNewCourse={createCourse}
        onExport={exportToPDF}
      />
      
      <div className="pt-16 h-full">
        <Canvas
          notes={filteredNotes}
          onNoteUpdate={updateNote}
          onNoteCreate={createNote}
          onNoteSelect={setSelectedNoteId}
          selectedNoteId={selectedNoteId}
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