import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: { canvasId: string } }
) {
  try {
    const canvasId = params.canvasId
    console.log('🔍 [API] GET /api/canvas/', canvasId, '/notes')

    console.log('🗄️ [API] Querying database for notes with canvasId:', canvasId)
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
    
    console.log('✅ [API] Found', notes.length, 'notes for canvas:', canvasId)
    return NextResponse.json(notes)
  } catch (error) {
    console.error('🚨 [API] Error fetching canvas notes:', error)
    
    // Retry logic for database connection issues
    if (error instanceof Error && error.message.includes('connection')) {
      console.log('🔄 [API] Retrying database connection...')
      await new Promise(resolve => setTimeout(resolve, 1000))
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
        console.log('✅ [API] Retry successful, found', notes.length, 'notes')
        return NextResponse.json(notes)
      } catch (retryError) {
        console.error('❌ [API] Retry failed:', retryError)
      }
    }
    
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { canvasId: string } }
) {
  try {
    const canvasId = params.canvasId
    const data = await request.json()
    
    console.log('📝 [API] POST /api/canvas/', canvasId, '/notes')
    console.log('📦 [API] Request data:', data)
    
    console.log('💾 [API] Creating note in database...')
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
    
    console.log('✅ [API] Note created successfully:', note.id)
    return NextResponse.json(note, { status: 201 })
  } catch (error) {
    console.error('🚨 [API] Error creating canvas note:', error)
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 })
  }
}