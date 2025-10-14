import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// GET /api/instructors/[id] - Récupérer un instructeur par ID
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const instructor = await prisma.instructor.findUnique({
      where: { id: params.id },
      include: {
        courses: {
          include: {
            notes: true
          }
        }
      }
    })

    if (!instructor) {
      return NextResponse.json(
        { error: 'Instructor not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(instructor)
  } catch (error) {
    console.error('Error fetching instructor:', error)
    return NextResponse.json(
      { error: 'Failed to fetch instructor' },
      { status: 500 }
    )
  }
}

// PUT /api/instructors/[id] - Mettre à jour un instructeur
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()

    const instructor = await prisma.instructor.update({
      where: { id: params.id },
      data: {
        name: body.name,
        email: body.email,
        avatar: body.avatar,
        color: body.color,
        updatedAt: new Date()
      }
    })

    return NextResponse.json(instructor)
  } catch (error) {
    console.error('Error updating instructor:', error)
    return NextResponse.json(
      { error: 'Failed to update instructor' },
      { status: 500 }
    )
  }
}

// DELETE /api/instructors/[id] - Supprimer un instructeur
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Vérifier si l'instructeur existe
    const instructor = await prisma.instructor.findUnique({
      where: { id: params.id }
    })

    if (!instructor) {
      return NextResponse.json(
        { error: 'Instructor not found' },
        { status: 404 }
      )
    }

    // Supprimer l'instructeur (les cours associés seront mis à NULL grâce à onDelete: SetNull)
    await prisma.instructor.delete({
      where: { id: params.id }
    })

    return NextResponse.json({ message: 'Instructor deleted successfully' })
  } catch (error) {
    console.error('Error deleting instructor:', error)
    return NextResponse.json(
      { error: 'Failed to delete instructor' },
      { status: 500 }
    )
  }
}