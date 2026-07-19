import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

// 0.1.5b — « Mapper » : get-or-create le canvas de collection du groupe et
// upsert ADDITIVEMENT ses membres (les notes actuellement dans le groupe).
// On n'enlève jamais automatiquement — retirer un membre sera un geste
// explicite dans la collection. Le titre suit le label du groupe tant qu'il vit.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { groupId } = await params
  const group = await prisma.canvasNode.findFirst({
    where: { id: groupId, kind: 'group', canvas: { userId: user.id } },
    select: { id: true, label: true },
  })
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let canvas = await prisma.canvas.findFirst({ where: { sourceGroupId: groupId } })
  if (!canvas) {
    canvas = await prisma.canvas.create({
      data: { type: 'collection', userId: user.id, sourceGroupId: groupId, title: group.label ?? 'Collection' },
    })
  } else if (group.label && canvas.title !== group.label) {
    // Le groupe vit encore : son nom reste la référence
    canvas = await prisma.canvas.update({ where: { id: canvas.id }, data: { title: group.label } })
  }

  // Membres actuels du groupe (cartes-notes rattachées) → upsert additif
  const memberNodes = await prisma.canvasNode.findMany({
    where: { parentId: groupId, noteId: { not: null } },
    select: { noteId: true },
  })
  const noteIds = memberNodes.map((n) => n.noteId as string)
  if (noteIds.length > 0) {
    await prisma.collectionNote.createMany({
      data: noteIds.map((noteId) => ({ canvasId: canvas!.id, noteId })),
      skipDuplicates: true,
    })
  }

  return NextResponse.json({ canvasId: canvas.id, added: noteIds.length })
}
