import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import CollectionLayout from '@/components/CollectionLayout'
import { MessageData, CanvasData } from '@/types'

// 0.1.5 — Canvas de COLLECTION : un groupe de notes de l'accueil ouvert dans un
// espace de mapping commun, qui embarque les blocs de PLUSIEURS notes.
export default async function CollectionPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  // Get-or-create le canvas de collection. La vérité de la membership est la
  // table CollectionNote (0.1.5b) — le groupe de l'accueil peut avoir été
  // dissous, la collection vit sa vie.
  let canvasRow = await prisma.canvas.findFirst({ where: { sourceGroupId: groupId, userId: user.id } })
  if (!canvasRow) {
    // Premier accès sans passage par « Mapper » : le groupe doit exister
    const group = await prisma.canvasNode.findFirst({
      where: { id: groupId, kind: 'group', canvas: { userId: user.id } },
      select: { id: true, label: true },
    })
    if (!group) notFound()
    canvasRow = await prisma.canvas.create({
      data: { type: 'collection', userId: user.id, sourceGroupId: groupId, title: group.label ?? 'Collection' },
    })
  }

  // Sync de secours (additive) : si le groupe vit encore, ses membres actuels
  // rejoignent la collection — même logique que la route /sync
  const liveMembers = await prisma.canvasNode.findMany({
    where: { parentId: groupId, noteId: { not: null } },
    select: { noteId: true },
  })
  if (liveMembers.length > 0) {
    await prisma.collectionNote.createMany({
      data: liveMembers.map((n) => ({ canvasId: canvasRow!.id, noteId: n.noteId as string })),
      skipDuplicates: true,
    })
  }

  // Membres = la table CollectionNote (survit à la dissolution du groupe)
  const members = await prisma.collectionNote.findMany({
    where: { canvasId: canvasRow.id },
    select: { noteId: true },
  })
  const noteIds = members.map((m) => m.noteId)

  const notes = noteIds.length
    ? await prisma.note.findMany({
        where: { id: { in: noteIds }, userId: user.id, deletedAt: null },
        include: { messages: { orderBy: { order: 'asc' } } },
      })
    : []

  // Blocs agrégés de toutes les notes membres, étiquetés par note d'origine
  const noteTitleById = new Map(notes.map((n) => [n.id, n.title]))
  const messages: (MessageData & { sourceNoteTitle?: string })[] = notes.flatMap((n) =>
    (n.messages as unknown as MessageData[])
      .filter((m) => m.type !== 'meta')
      .map((m) => ({ ...m, sourceNoteTitle: noteTitleById.get(n.id) ?? '' }))
  )

  const canvas = await prisma.canvas.findUniqueOrThrow({
    where: { id: canvasRow.id },
    include: { nodes: true, edges: true },
  })

  const canvasData: CanvasData = {
    id: canvas.id,
    type: canvas.type,
    userId: canvas.userId,
    noteId: canvas.noteId,
    noteContentHash: canvas.noteContentHash,
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
    nodes: canvas.nodes.map((n) => ({
      id: n.id, canvasId: n.canvasId, messageId: n.messageId, noteId: n.noteId,
      kind: n.kind, content: n.content, label: n.label, color: n.color,
      parentId: n.parentId, orderInParent: n.orderInParent,
      x: n.x, y: n.y, width: n.width, height: n.height,
    })),
    edges: canvas.edges.map((e) => ({
      id: e.id, canvasId: e.canvasId, fromId: e.fromId, toId: e.toId,
      fromHandle: e.fromHandle, toHandle: e.toHandle, label: e.label, style: e.style,
    })),
  }

  return (
    <CollectionLayout
      title={canvas.title || 'Collection'}
      noteCount={notes.length}
      memberNotes={notes.map((n) => ({ id: n.id, title: n.title, favicon: n.favicon }))}
      messages={messages}
      canvas={canvasData}
    />
  )
}
