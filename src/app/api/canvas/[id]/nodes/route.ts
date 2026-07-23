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
    const kind = body.kind === 'group' ? 'group' : body.kind === 'text' ? 'text'
      : body.kind === 'concept' ? 'concept' : 'message'
    const isGroup = kind === 'group'

    // 0.1.6 — nœud-CONCEPT : incarne un tag sur le canvas. Relier une note à ce
    // nœud (outil crayon) applique le concept à la note (route edges).
    let conceptTagId: string | null = null
    if (kind === 'concept') {
      const tag = await prisma.tag.findFirst({ where: { id: body.tagId, userId: user.id } })
      if (!tag) return NextResponse.json({ error: 'tag inconnu' }, { status: 400 })
      conceptTagId = tag.id
    }

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
        ...(conceptTagId ? { tagId: conceptTagId } : {}),
        x: body.x ?? 100,
        y: body.y ?? 100,
        width: body.width ?? (isGroup ? 360 : kind === 'text' ? 220 : kind === 'concept' ? 160 : 280),
        height: body.height ?? (isGroup ? 260 : kind === 'text' ? 100 : kind === 'concept' ? 44 : 120),
      },
    })

    // Fix relecture (Brice 19/07) : réorganiser une note DÉJÀ relue la fait
    // re-rentrer dans « À relire ». La réorganisation nourrit la relecture —
    // c'est tout le sens de la vue document (l'ordre de l'élève, pas du prof).
    // Vaut pour l'étude d'une note ET les collections (même route).
    if (canvas.reviewedAt != null && (canvas.type === 'note-study' || canvas.type === 'collection')) {
      await prisma.canvas.update({
        where: { id },
        data: { reviewedAt: null, reviewReminderAt: null },
      })
    }

    return NextResponse.json(node, { status: 201 })
  } catch (err) {
    console.error('[API /canvas/nodes POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
