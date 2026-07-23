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

  // tagId : lier un groupe à un concept (groupe VIVANT, 0.1.3). Ceinture : le tag
  // doit appartenir à l'utilisateur. null explicite = délier le groupe.
  if (body.tagId !== undefined && body.tagId !== null) {
    const tag = await prisma.tag.findFirst({ where: { id: body.tagId, userId: user.id } })
    if (!tag) return NextResponse.json({ error: 'tag inconnu' }, { status: 400 })
  }

  // L'état AVANT update — nécessaire pour la symétrie du groupe vivant
  const before = body.parentId !== undefined
    ? await prisma.canvasNode.findUnique({
        where: { id: nodeId },
        select: { parentId: true, noteId: true, messageId: true },
      })
    : null

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
      ...(body.tagId !== undefined ? { tagId: body.tagId } : {}),
    },
  })

  // ── Groupe VIVANT (0.1.3, option A validée par Brice le 17/07) ──────────────
  // Déposer dans un groupe promu applique son tag ; en sortir retire CE tag
  // (uniquement celui du groupe — les tags posés ailleurs ne bougent pas).
  if (before && body.parentId !== before.parentId) {
    const applyGroupTag = async (groupId: string | null, attach: boolean) => {
      if (!groupId) return
      const group = await prisma.canvasNode.findUnique({ where: { id: groupId }, select: { tagId: true } })
      if (!group?.tagId) return
      if (before.noteId) {
        if (attach) await prisma.noteTag.createMany({ data: [{ noteId: before.noteId, tagId: group.tagId }], skipDuplicates: true })
        else await prisma.noteTag.deleteMany({ where: { noteId: before.noteId, tagId: group.tagId } })
      } else if (before.messageId) {
        if (attach) await prisma.messageTag.createMany({ data: [{ messageId: before.messageId, tagId: group.tagId }], skipDuplicates: true })
        else await prisma.messageTag.deleteMany({ where: { messageId: before.messageId, tagId: group.tagId } })
      }
    }
    await applyGroupTag(before.parentId, false)      // sortie de l'ancien groupe
    await applyGroupTag(body.parentId ?? null, true) // entrée dans le nouveau
  }

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

  // 0.1.6 — supprimer un nœud-CONCEPT : ses edges cascadent en base, mais les
  // tags posés par ces liens doivent partir avec (symétrie du geste)
  const target = await prisma.canvasNode.findUnique({
    where: { id: nodeId },
    select: {
      kind: true, tagId: true,
      fromEdges: { select: { to: { select: { noteId: true, messageId: true } } } },
      toEdges: { select: { from: { select: { noteId: true, messageId: true } } } },
    },
  })
  if (target?.kind === 'concept' && target.tagId) {
    const linked = [...target.fromEdges.map(e => e.to), ...target.toEdges.map(e => e.from)]
    const noteIds = linked.filter(n => n.noteId).map(n => n.noteId as string)
    const messageIds = linked.filter(n => n.messageId).map(n => n.messageId as string)
    if (noteIds.length) await prisma.noteTag.deleteMany({ where: { noteId: { in: noteIds }, tagId: target.tagId } })
    if (messageIds.length) await prisma.messageTag.deleteMany({ where: { messageId: { in: messageIds }, tagId: target.tagId } })
  }

  // Filet de securite : detacher les enfants d un groupe supprime
  // (le client convertit leurs positions en absolu AVANT d appeler ce DELETE)
  await prisma.canvasNode.updateMany({ where: { parentId: nodeId }, data: { parentId: null } })
  await prisma.canvasNode.delete({ where: { id: nodeId } })
  return NextResponse.json({ ok: true })
}
