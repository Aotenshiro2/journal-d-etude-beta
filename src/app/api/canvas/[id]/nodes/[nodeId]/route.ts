import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, nodeId } = await params
  const canvas = await prisma.canvas.findFirst({ where: { id, userId: user.id } })
  if (!canvas) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const node = await prisma.canvasNode.update({
    where: { id: nodeId },
    data: {
      x: body.x ?? undefined,
      y: body.y ?? undefined,
      width: body.width ?? undefined,
      height: body.height ?? undefined,
    },
  })

  return NextResponse.json(node)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, nodeId } = await params
  const canvas = await prisma.canvas.findFirst({ where: { id, userId: user.id } })
  if (!canvas) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.canvasNode.delete({ where: { id: nodeId } })
  return NextResponse.json({ ok: true })
}
