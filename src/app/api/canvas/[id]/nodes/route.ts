import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

async function verifyCanvas(canvasId: string, userId: string) {
  return prisma.canvas.findFirst({ where: { id: canvasId, userId } })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const canvas = await verifyCanvas(id, user.id)
  if (!canvas) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const body = await req.json()
    const kind = body.kind === 'group' ? 'group' : body.kind === 'text' ? 'text' : 'message'
    const isGroup = kind === 'group'
    const node = await prisma.canvasNode.create({
      data: {
        canvasId: id,
        messageId: body.messageId ?? null,
        noteId: body.noteId ?? null,
        kind,
        content: typeof body.content === 'string' ? body.content : null,
        label: typeof body.label === 'string' ? body.label : null,
        color: typeof body.color === 'string' ? body.color : null,
        parentId: typeof body.parentId === 'string' ? body.parentId : null,
        x: body.x ?? 100,
        y: body.y ?? 100,
        width: body.width ?? (isGroup ? 360 : kind === 'text' ? 220 : 280),
        height: body.height ?? (isGroup ? 260 : kind === 'text' ? 100 : 120),
      },
    })

    return NextResponse.json(node, { status: 201 })
  } catch (err) {
    console.error('[API /canvas/nodes POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
