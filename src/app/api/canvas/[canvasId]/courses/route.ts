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

    const courses = await prisma.course.findMany({
      where: { canvasId },
      include: { instructor: true, notes: true },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json(courses)
  } catch (error) {
    console.error('Error fetching canvas courses:', error)
    return NextResponse.json({ error: 'Failed to fetch courses' }, { status: 500 })
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

    const course = await prisma.course.create({
      data: {
        name: data.name,
        description: data.description,
        color: data.color,
        canvasId,
        instructorId: data.instructorId
      },
      include: { instructor: true, notes: true }
    })

    return NextResponse.json(course, { status: 201 })
  } catch (error) {
    console.error('Error creating canvas course:', error)
    return NextResponse.json({ error: 'Failed to create course' }, { status: 500 })
  }
}
