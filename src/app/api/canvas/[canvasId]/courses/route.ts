import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: { canvasId: string } }
) {
  try {
    const canvasId = params.canvasId

    const courses = await prisma.course.findMany({
      where: {
        canvasId: canvasId
      },
      include: {
        instructor: true,
        notes: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    })
    
    return NextResponse.json(courses)
  } catch (error) {
    console.error('Error fetching canvas courses:', error)
    return NextResponse.json({ error: 'Failed to fetch courses' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { canvasId: string } }
) {
  try {
    const canvasId = params.canvasId
    const data = await request.json()
    
    const course = await prisma.course.create({
      data: {
        name: data.name,
        description: data.description,
        color: data.color,
        canvasId: canvasId, // Associer au canvas
        instructorId: data.instructorId
      },
      include: {
        instructor: true,
        notes: true
      }
    })
    
    return NextResponse.json(course, { status: 201 })
  } catch (error) {
    console.error('Error creating canvas course:', error)
    return NextResponse.json({ error: 'Failed to create course' }, { status: 500 })
  }
}