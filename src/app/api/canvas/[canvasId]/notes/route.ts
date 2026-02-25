import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ canvasId: string }> }
) {
  try {
    const { canvasId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const notes = await prisma.note.findMany({
      where: { canvasId, userId: user.id },
      include: {
        course: true,
        concepts: { include: { concept: true } }
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json(notes)
  } catch (error) {
    console.error('Error fetching canvas notes:', error)
    return NextResponse.json({
      error: 'Failed to fetch notes',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ canvasId: string }> }
) {
  try {
    const { canvasId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const data = await request.json()

    // Dédupliquer par sourceUrl + userId si la note vient de l'extension
    if (data.sourceUrl) {
      const existing = await prisma.note.findFirst({
        where: { sourceUrl: data.sourceUrl, userId: user.id }
      })
      if (existing) {
        // Upsert : mettre à jour le contenu existant
        const updated = await prisma.note.update({
          where: { id: existing.id },
          data: {
            title: data.title ?? existing.title,
            content: data.content ?? existing.content,
            mainTakeaway: data.mainTakeaway ?? existing.mainTakeaway,
            syncedAt: data.syncedAt ? new Date(data.syncedAt) : new Date(),
            favicon: data.favicon ?? existing.favicon,
          },
          include: {
            course: true,
            concepts: { include: { concept: true } }
          }
        })
        return NextResponse.json(updated, { status: 200 })
      }
    }

    // Auto-position en grille (5 colonnes, 280×220)
    const noteCount = await prisma.note.count({ where: { canvasId, userId: user.id } })
    const autoX = (noteCount % 5) * 280
    const autoY = Math.floor(noteCount / 5) * 220

    const note = await prisma.note.create({
      data: {
        title: data.title,
        content: data.content ?? '',
        canvasId,
        userId: user.id,
        x: data.x ?? autoX,
        y: data.y ?? autoY,
        width: data.width ?? 300,
        height: data.height ?? 200,
        backgroundColor: data.backgroundColor ?? '#ffffff',
        textColor: data.textColor ?? '#000000',
        courseId: data.courseId ?? null,
        mainTakeaway: data.mainTakeaway ?? null,
        // Extension sync fields
        source: data.source ?? null,
        sourceUrl: data.sourceUrl ?? null,
        favicon: data.favicon ?? null,
        syncedAt: data.syncedAt ? new Date(data.syncedAt) : null,
      },
      include: {
        course: true,
        concepts: { include: { concept: true } }
      }
    })

    return NextResponse.json(note, { status: 201 })
  } catch (error) {
    console.error('Error creating canvas note:', error)
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 })
  }
}
