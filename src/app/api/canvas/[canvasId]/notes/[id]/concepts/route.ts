import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ canvasId: string; id: string }> }
) {
  try {
    const { canvasId, id: noteId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { conceptName, category, description } = await request.json()

    const existingNote = await prisma.note.findFirst({
      where: { id: noteId, canvasId, userId: user.id }
    })

    if (!existingNote) {
      return NextResponse.json({ error: 'Note not found in this canvas' }, { status: 404 })
    }

    let concept = await prisma.concept.findFirst({ where: { name: conceptName } })

    if (!concept) {
      concept = await prisma.concept.create({
        data: { name: conceptName, category, description, frequency: 1 }
      })
    } else {
      await prisma.concept.update({
        where: { id: concept.id },
        data: { frequency: { increment: 1 } }
      })
    }

    const existingLink = await prisma.noteConcept.findFirst({
      where: { noteId, conceptId: concept.id }
    })

    if (existingLink) {
      return NextResponse.json({ message: 'Concept already linked to this note', concept }, { status: 409 })
    }

    const noteConcept = await prisma.noteConcept.create({
      data: { noteId, conceptId: concept.id },
      include: { concept: true }
    })

    return NextResponse.json(noteConcept, { status: 201 })
  } catch (error) {
    console.error('Error adding concept to canvas note:', error)
    return NextResponse.json({ error: 'Failed to add concept' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ canvasId: string; id: string }> }
) {
  try {
    const { canvasId, id: noteId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const conceptId = searchParams.get('conceptId')

    if (!conceptId) {
      return NextResponse.json({ error: 'Concept ID is required' }, { status: 400 })
    }

    const existingNote = await prisma.note.findFirst({
      where: { id: noteId, canvasId, userId: user.id }
    })

    if (!existingNote) {
      return NextResponse.json({ error: 'Note not found in this canvas' }, { status: 404 })
    }

    await prisma.noteConcept.delete({
      where: { noteId_conceptId: { noteId, conceptId } }
    })

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
