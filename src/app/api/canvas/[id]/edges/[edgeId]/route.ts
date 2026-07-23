import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; edgeId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, edgeId } = await params
  const canvas = await prisma.canvas.findFirst({ where: { id, userId: user.id } })
  if (!canvas) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // 0.1.6 — symétrie : délier une note d'un nœud-concept retire LE tag posé
  // par ce lien (jamais les tags posés ailleurs). Lu AVANT suppression.
  const edge = await prisma.canvasEdge.findUnique({
    where: { id: edgeId },
    select: {
      from: { select: { kind: true, tagId: true, noteId: true, messageId: true } },
      to: { select: { kind: true, tagId: true, noteId: true, messageId: true } },
    },
  })
  if (edge) {
    const concept = edge.from.kind === 'concept' && edge.from.tagId ? edge.from
      : edge.to.kind === 'concept' && edge.to.tagId ? edge.to : null
    const content = concept === edge.from ? edge.to : edge.from
    if (concept?.tagId && content) {
      if (content.noteId) await prisma.noteTag.deleteMany({ where: { noteId: content.noteId, tagId: concept.tagId } })
      else if (content.messageId) await prisma.messageTag.deleteMany({ where: { messageId: content.messageId, tagId: concept.tagId } })
    }
  }

  await prisma.canvasEdge.delete({ where: { id: edgeId } })
  return NextResponse.json({ ok: true })
}

// 0.1.6 — nommer un lien (le label vivait déjà en base, l'UI l'expose enfin)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; edgeId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, edgeId } = await params
  const canvas = await prisma.canvas.findFirst({ where: { id, userId: user.id } })
  if (!canvas) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const updated = await prisma.canvasEdge.update({
    where: { id: edgeId },
    data: { label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null },
  })
  return NextResponse.json(updated)
}
