import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const notes = await prisma.note.findMany({
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
    console.error('Error fetching notes:', error)
    
    // Retry logic for database connection issues
    if (error instanceof Error && error.message.includes('connection')) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      try {
        const notes = await prisma.note.findMany({
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
      } catch (retryError) {
        console.error('Retry failed:', retryError)
      }
    }
    
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    
    const note = await prisma.note.create({
      data: {
        title: data.title,
        content: data.content,
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
    console.error('Error creating note:', error)
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 })
  }
}