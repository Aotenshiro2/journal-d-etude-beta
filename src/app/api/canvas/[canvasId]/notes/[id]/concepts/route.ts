import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function POST(
  request: NextRequest,
  { params }: { params: { canvasId: string; id: string } }
) {
  try {
    const { canvasId, id: noteId } = params
    const { conceptName, category, description } = await request.json()
    
    // Vérifier que la note appartient bien au canvas
    const existingNote = await prisma.note.findFirst({
      where: {
        id: noteId,
        canvasId: canvasId
      }
    })
    
    if (!existingNote) {
      return NextResponse.json({ error: 'Note not found in this canvas' }, { status: 404 })
    }
    
    // Chercher ou créer le concept
    let concept = await prisma.concept.findFirst({
      where: { name: conceptName }
    })
    
    if (!concept) {
      concept = await prisma.concept.create({
        data: {
          name: conceptName,
          category: category,
          description: description,
          frequency: 1
        }
      })
    } else {
      // Incrémenter la fréquence
      await prisma.concept.update({
        where: { id: concept.id },
        data: { frequency: { increment: 1 } }
      })
    }
    
    // Vérifier si la liaison existe déjà
    const existingLink = await prisma.noteConcept.findFirst({
      where: {
        noteId: noteId,
        conceptId: concept.id
      }
    })
    
    if (existingLink) {
      return NextResponse.json({ 
        message: 'Concept already linked to this note',
        concept: concept
      }, { status: 409 })
    }
    
    // Créer la liaison note-concept
    const noteConcept = await prisma.noteConcept.create({
      data: {
        noteId: noteId,
        conceptId: concept.id
      },
      include: {
        concept: true
      }
    })
    
    return NextResponse.json(noteConcept, { status: 201 })
  } catch (error) {
    console.error('Error adding concept to canvas note:', error)
    return NextResponse.json({ error: 'Failed to add concept' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { canvasId: string; id: string } }
) {
  try {
    const { canvasId, id: noteId } = params
    const { searchParams } = new URL(request.url)
    const conceptId = searchParams.get('conceptId')
    
    if (!conceptId) {
      return NextResponse.json({ error: 'Concept ID is required' }, { status: 400 })
    }
    
    // Vérifier que la note appartient bien au canvas
    const existingNote = await prisma.note.findFirst({
      where: {
        id: noteId,
        canvasId: canvasId
      }
    })
    
    if (!existingNote) {
      return NextResponse.json({ error: 'Note not found in this canvas' }, { status: 404 })
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
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing concept from canvas note:', error)
    return NextResponse.json({ error: 'Failed to remove concept' }, { status: 500 })
  }
}