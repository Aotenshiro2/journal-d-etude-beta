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
        fromHandle: typeof body.fromHandle === 'string' ? body.fromHandle : null,
        toHandle: typeof body.toHandle === 'string' ? body.toHandle : null,
        label: body.label ?? null,
        style: body.style ?? 'curved',
      },
    })
    // 0.1.6 — lien vers un nœud-CONCEPT : la note (ou le bloc) relié porte le
    // concept (NoteTag/MessageTag). Même mécanique que le groupe vivant ;
    // nourrit /concepts, aucun impact sur /notes.
    const [a, b] = await Promise.all([
      prisma.canvasNode.findUnique({ where: { id: body.fromId }, select: { kind: true, tagId: true, noteId: true, messageId: true } }),
      prisma.canvasNode.findUnique({ where: { id: body.toId }, select: { kind: true, tagId: true, noteId: true, messageId: true } }),
    ])
    const concept = a?.kind === 'concept' && a.tagId ? a : b?.kind === 'concept' && b.tagId ? b : null
    const content = concept === a ? b : a
    if (concept?.tagId && content) {
      if (content.noteId) {
        await prisma.noteTag.createMany({ data: [{ noteId: content.noteId, tagId: concept.tagId }], skipDuplicates: true })
      } else if (content.messageId) {
        await prisma.messageTag.createMany({ data: [{ messageId: content.messageId, tagId: concept.tagId }], skipDuplicates: true })
      }
    }

    return NextResponse.json(edge, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Edge already exists' }, { status: 409 })
  }
}
