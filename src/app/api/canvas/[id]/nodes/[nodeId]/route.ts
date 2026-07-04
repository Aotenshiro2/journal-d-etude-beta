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
      label: typeof body.label === 'string' ? body.label : undefined,
      color: typeof body.color === 'string' ? body.color : undefined,
      // Surcharge de contenu (copie de travail) — null explicite = revenir à l'original
      ...(body.content !== undefined ? { content: body.content } : {}),
      // parentId : null explicite = detacher du groupe
      ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
      ...(body.orderInParent !== undefined ? { orderInParent: body.orderInParent } : {}),
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

  // Filet de securite : detacher les enfants d un groupe supprime
  // (le client convertit leurs positions en absolu AVANT d appeler ce DELETE)
  await prisma.canvasNode.updateMany({ where: { parentId: nodeId }, data: { parentId: null } })
  await prisma.canvasNode.delete({ where: { id: nodeId } })
  return NextResponse.json({ ok: true })
}
