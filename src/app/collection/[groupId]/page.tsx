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

  // Le groupe est un CanvasNode (kind='group') du canvas d'accueil de l'utilisateur
  const group = await prisma.canvasNode.findFirst({
    where: { id: groupId, kind: 'group', canvas: { userId: user.id } },
    select: { id: true, label: true },
  })
  if (!group) notFound()

  // Notes membres du groupe = les cartes-notes rattachées (parentId = groupId)
  const memberNodes = await prisma.canvasNode.findMany({
    where: { parentId: groupId, noteId: { not: null } },
    select: { noteId: true },
  })
  const noteIds = memberNodes.map((n) => n.noteId as string)

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

  // Get-or-create le canvas de collection (noteId=null, rattaché au groupe)
  let canvas = await prisma.canvas.findFirst({
    where: { sourceGroupId: groupId },
    include: { nodes: true, edges: true },
  })
  if (!canvas) {
    canvas = await prisma.canvas.create({
      data: { type: 'collection', userId: user.id, sourceGroupId: groupId },
      include: { nodes: true, edges: true },
    })
  }

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
      title={group.label || 'Collection'}
      noteCount={notes.length}
      messages={messages}
      canvas={canvasData}
    />
  )
}
