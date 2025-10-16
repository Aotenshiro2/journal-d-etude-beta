import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: { canvasId: string } }
) {
  try {
    const canvasId = params.canvasId

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