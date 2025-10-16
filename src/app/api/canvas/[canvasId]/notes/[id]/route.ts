import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function PUT(
  request: NextRequest,
  { params }: { params: { canvasId: string; id: string } }
) {
  try {
    const { canvasId, id } = params
    const data = await request.json()
    
    // Vérifier que la note appartient bien au canvas
    const existingNote = await prisma.note.findFirst({
      where: {
        id: id,
        canvasId: canvasId
      }
    })
    
    if (!existingNote) {
      return NextResponse.json({ error: 'Note not found in this canvas' }, { status: 404 })
    }
    
    const note = await prisma.note.update({
      where: { id },
      data: {
        title: data.title,
        content: data.content,
        mainTakeaway: data.mainTakeaway,
        x: data.x,
        y: data.y,
        width: data.width,
        height: data.height,
        backgroundColor: data.backgroundColor,
        textColor: data.textColor,
        courseId: data.courseId,
        updatedAt: new Date()
      },
      include: {
        course: true,
        concepts: {
          include: {
            concept: true
          }
        }
      }
    })
    
    return NextResponse.json(note)
  } catch (error) {
    console.error('Error updating canvas note:', error)
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { canvasId: string; id: string } }
) {
  try {
    const { canvasId, id } = params
    
    // Vérifier que la note appartient bien au canvas
    const existingNote = await prisma.note.findFirst({
      where: {
        id: id,
        canvasId: canvasId
      }
    })
    
    if (!existingNote) {
      return NextResponse.json({ error: 'Note not found in this canvas' }, { status: 404 })
    }
    
    await prisma.note.delete({
      where: { id }
    })
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting canvas note:', error)
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
  }
}