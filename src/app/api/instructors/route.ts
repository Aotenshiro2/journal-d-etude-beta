import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// GET /api/instructors - Récupérer tous les instructeurs
export async function GET() {
  try {
    const instructors = await prisma.instructor.findMany({
      include: {
        courses: {
          include: {
            notes: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return NextResponse.json(instructors)
  } catch (error) {
    console.error('Error fetching instructors:', error)
    return NextResponse.json(
      { error: 'Failed to fetch instructors' },
      { status: 500 }
    )
  }
}

// POST /api/instructors - Créer un nouvel instructeur
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const instructor = await prisma.instructor.create({
      data: {
        id: body.id,
        name: body.name,
        email: body.email,
        avatar: body.avatar,
        color: body.color || '#6366f1',
        createdAt: body.createdAt ? new Date(body.createdAt) : new Date(),
        updatedAt: body.updatedAt ? new Date(body.updatedAt) : new Date()
      }
    })

    return NextResponse.json(instructor, { status: 201 })
  } catch (error) {
    console.error('Error creating instructor:', error)
    return NextResponse.json(
      { error: 'Failed to create instructor' },
      { status: 500 }
    )
  }
}