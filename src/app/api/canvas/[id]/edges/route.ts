import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const canvas = await prisma.canvas.findFirst({ where: { id, userId: user.id } })
  if (!canvas) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  try {
    const edge = await prisma.canvasEdge.create({
      data: {
        canvasId: id,
        fromId: body.fromId,
        toId: body.toId,
        label: body.label ?? null,
        style: body.style ?? 'curved',
      },
    })
    return NextResponse.json(edge, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Edge already exists' }, { status: 409 })
  }
}
