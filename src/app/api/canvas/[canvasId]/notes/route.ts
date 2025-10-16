import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: { canvasId: string } }
) {
  try {
    const canvasId = params.canvasId
    console.error('Debug: GET /api/canvas/' + canvasId + '/notes')

    // Test 1: Simple count first
    console.error('Debug: Testing simple count...')
    const totalCount = await prisma.note.count()
    console.error('Debug: Total notes in DB:', totalCount)

    // Test 2: Count for this canvas
    const canvasCount = await prisma.note.count({
      where: { canvasId: canvasId }
    })
    console.error('Debug: Notes for canvas', canvasId + ':', canvasCount)

    // Test 3: Simple query without includes
    console.error('Debug: Testing simple query without includes...')
    const simpleNotes = await prisma.note.findMany({
      where: { canvasId: canvasId },
      select: {
        id: true,
        title: true,
        x: true,
        y: true,
        createdAt: true
      },
      take: 5
    })
    console.error('Debug: Simple notes found:', simpleNotes.length)

    // Test 4: Full query with includes
    console.error('Debug: Testing full query with includes...')
    const notes = await prisma.note.findMany({
      where: {
        canvasId: canvasId
      },
      include: {
        course: true,
        concepts: {
          include: {
            concept: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })
    
    console.error('Debug: Full notes found:', notes.length)
    return NextResponse.json(notes)
  } catch (error) {
    console.error('DETAILED ERROR fetching canvas notes:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      canvasId: params.canvasId
    })
    
    return NextResponse.json({ 
      error: 'Failed to fetch notes',
      details: error instanceof Error ? error.message : 'Unknown error',
      canvasId: params.canvasId,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { canvasId: string } }
) {
  try {
    const canvasId = params.canvasId
    const data = await request.json()
    
    const note = await prisma.note.create({
      data: {
        title: data.title,
        content: data.content,
        canvasId: canvasId, // Associer au canvas
        x: data.x,
        y: data.y,
        width: data.width,
        height: data.height,
        backgroundColor: data.backgroundColor,
        textColor: data.textColor,
        courseId: data.courseId
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
    
    return NextResponse.json(note, { status: 201 })
  } catch (error) {
    console.error('Error creating canvas note:', error)
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 })
  }
}