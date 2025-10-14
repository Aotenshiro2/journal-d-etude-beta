import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const data = await request.json()
    const { id } = await params
    
    const note = await prisma.note.update({
      where: { id },
      data: {
        ...(data.title && { title: data.title }),
        ...(data.content && { content: data.content }),
        ...(data.x !== undefined && { x: data.x }),
        ...(data.y !== undefined && { y: data.y }),
        ...(data.width !== undefined && { width: data.width }),
        ...(data.height !== undefined && { height: data.height }),
        ...(data.backgroundColor && { backgroundColor: data.backgroundColor }),
        ...(data.textColor && { textColor: data.textColor }),
        ...(data.courseId !== undefined && { courseId: data.courseId }),
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
    console.error('Error updating note:', error)
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    await prisma.note.delete({
      where: { id }
    })
    
    return NextResponse.json({ message: 'Note deleted successfully' })
  } catch (error) {
    console.error('Error deleting note:', error)
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
  }
}