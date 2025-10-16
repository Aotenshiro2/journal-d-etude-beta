import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const concepts = await prisma.concept.findMany({
      include: {
        notes: {
          select: {
            noteId: true
          }
        }
      },
      orderBy: [
        { frequency: 'desc' },
        { name: 'asc' }
      ]
    })
    
    // Calculer le nombre de notes liées pour chaque concept
    const conceptsWithStats = concepts.map(concept => ({
      ...concept,
      notesCount: concept.notes.length
    }))
    
    return NextResponse.json(conceptsWithStats)
  } catch (error) {
    console.error('Error fetching concepts:', error)
    
    // Retry logic for database connection issues
    if (error instanceof Error && error.message.includes('connection')) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      try {
        const concepts = await prisma.concept.findMany({
          include: {
            notes: {
              select: {
                noteId: true
              }
            }
          },
          orderBy: [
            { frequency: 'desc' },
            { name: 'asc' }
          ]
        })
        
        const conceptsWithStats = concepts.map(concept => ({
          ...concept,
          notesCount: concept.notes.length
        }))
        
        return NextResponse.json(conceptsWithStats)
      } catch (retryError) {
        console.error('Retry failed:', retryError)
      }
    }
    
    return NextResponse.json({ error: 'Failed to fetch concepts' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    
    // Vérifier si le concept existe déjà
    const existingConcept = await prisma.concept.findUnique({
      where: { name: data.name }
    })
    
    if (existingConcept) {
      return NextResponse.json({ 
        error: 'Un concept avec ce nom existe déjà',
        concept: existingConcept 
      }, { status: 409 })
    }
    
    const concept = await prisma.concept.create({
      data: {
        name: data.name,
        description: data.description || null,
        category: data.category || null,
        frequency: 1 // Nouveau concept démarre avec fréquence 1
      },
      include: {
        notes: {
          select: {
            noteId: true
          }
        }
      }
    })
    
    return NextResponse.json({
      ...concept,
      notesCount: 0
    }, { status: 201 })
  } catch (error) {
    console.error('Error creating concept:', error)
    return NextResponse.json({ error: 'Failed to create concept' }, { status: 500 })
  }
}