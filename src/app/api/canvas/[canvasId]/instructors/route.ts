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

    const instructors = await prisma.instructor.findMany({
      where: { canvasId },
      include: { courses: true },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json(instructors)
  } catch (error) {
    console.error('Error fetching canvas instructors:', error)
    return NextResponse.json({ error: 'Failed to fetch instructors' }, { status: 500 })
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

    const instructor = await prisma.instructor.create({
      data: {
        name: data.name,
        email: data.email,
        avatar: data.avatar,
        color: data.color,
        canvasId
      },
      include: { courses: true }
    })

    return NextResponse.json(instructor, { status: 201 })
  } catch (error) {
    console.error('Error creating canvas instructor:', error)
    return NextResponse.json({ error: 'Failed to create instructor' }, { status: 500 })
  }
}
