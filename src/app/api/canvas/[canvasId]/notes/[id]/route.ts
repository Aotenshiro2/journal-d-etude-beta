import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ canvasId: string; id: string }> }
) {
  try {
    const { canvasId, id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const data = await request.json()

    const existingNote = await prisma.note.findFirst({
      where: { id, canvasId, userId: user.id }
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
        concepts: { include: { concept: true } }
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
  { params }: { params: Promise<{ canvasId: string; id: string }> }
) {
  try {
    const { canvasId, id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const existingNote = await prisma.note.findFirst({
      where: { id, canvasId, userId: user.id }
    })

    if (!existingNote) {
      return NextResponse.json({ error: 'Note not found in this canvas' }, { status: 404 })
    }

    await prisma.note.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting canvas note:', error)
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
  }
}
