import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const data = await request.json()
    const { id: noteId } = await params
    
    // Vérifier que la note existe
    const note = await prisma.note.findUnique({
      where: { id: noteId }
    })
    
    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }
    
    // Chercher ou créer le concept
    let concept = await prisma.concept.findUnique({
      where: { name: data.conceptName }
    })
    
    if (!concept) {
      // Créer le concept s'il n'existe pas
      concept = await prisma.concept.create({
        data: {
          name: data.conceptName,
          description: data.description || null,
          category: data.category || null,
          frequency: 1
        }
      })
    } else {
      // Incrémenter la fréquence du concept existant
      concept = await prisma.concept.update({
        where: { id: concept.id },
        data: { frequency: { increment: 1 } }
      })
    }
    
    // Vérifier si la liaison existe déjà
    const existingLink = await prisma.noteConcept.findUnique({
      where: {
        noteId_conceptId: {
          noteId: noteId,
          conceptId: concept.id
        }
      }
    })
    
    if (existingLink) {
      return NextResponse.json({ 
        error: 'Ce concept est déjà lié à cette note',
        concept 
      }, { status: 409 })
    }
    
    // Créer la liaison note-concept
    await prisma.noteConcept.create({
      data: {
        noteId: noteId,
        conceptId: concept.id
      }
    })
    
    // Retourner la note mise à jour avec ses concepts
    const updatedNote = await prisma.note.findUnique({
      where: { id: noteId },
      include: {
        course: true,
        concepts: {
          include: {
            concept: true
          }
        }
      }
    })
    
    return NextResponse.json({
      message: 'Concept lié avec succès',
      note: updatedNote,
      concept
    }, { status: 201 })
  } catch (error) {
    console.error('Error linking concept to note:', error)
    return NextResponse.json({ error: 'Failed to link concept' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { searchParams } = new URL(request.url)
    const conceptId = searchParams.get('conceptId')
    const { id: noteId } = await params
    
    if (!conceptId) {
      return NextResponse.json({ error: 'conceptId parameter required' }, { status: 400 })
    }
    
    // Vérifier que la liaison existe
    const existingLink = await prisma.noteConcept.findUnique({
      where: {
        noteId_conceptId: {
          noteId: noteId,
          conceptId: conceptId
        }
      }
    })
    
    if (!existingLink) {
      return NextResponse.json({ error: 'Liaison inexistante' }, { status: 404 })
    }
    
    // Supprimer la liaison
    await prisma.noteConcept.delete({
      where: {
        noteId_conceptId: {
          noteId: noteId,
          conceptId: conceptId
        }
      }
    })
    
    // Décrémenter la fréquence du concept
    await prisma.concept.update({
      where: { id: conceptId },
      data: { frequency: { decrement: 1 } }
    })
    
    // Retourner la note mise à jour
    const updatedNote = await prisma.note.findUnique({
      where: { id: noteId },
      include: {
        course: true,
        concepts: {
          include: {
            concept: true
          }
        }
      }
    })
    
    return NextResponse.json({
      message: 'Concept délié avec succès',
      note: updatedNote
    })
  } catch (error) {
    console.error('Error unlinking concept from note:', error)
    return NextResponse.json({ error: 'Failed to unlink concept' }, { status: 500 })
  }
}