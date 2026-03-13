import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import AppHeader from '@/components/AppHeader'
import StudyLayout from '@/components/StudyLayout'
import { MessageData, CanvasData } from '@/types'

export default async function StudyNotePage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const note = await prisma.note.findFirst({
    where: { id: noteId, userId: user.id },
    include: {
      messages: {
        orderBy: { order: 'asc' },
        include: { tags: { include: { tag: true } } },
      },
    },
  })

  if (!note) notFound()

  // Get or create canvas
  let canvas = await prisma.canvas.findUnique({
    where: { noteId },
    include: { nodes: true, edges: true },
  })

  if (!canvas) {
    canvas = await prisma.canvas.create({
      data: {
        type: 'note-study',
        userId: user.id,
        noteId,
        noteContentHash: note.contentHash,
      },
      include: { nodes: true, edges: true },
    })
  }

  const isDiverged = !!(
    note.contentHash &&
    canvas.noteContentHash &&
    note.contentHash !== canvas.noteContentHash
  )

  const noteWithMessages = {
    ...note,
    messages: note.messages as MessageData[],
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
      id: n.id,
      canvasId: n.canvasId,
      messageId: n.messageId,
      noteId: n.noteId,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
    })),
    edges: canvas.edges.map((e) => ({
      id: e.id,
      canvasId: e.canvasId,
      fromId: e.fromId,
      toId: e.toId,
      label: e.label,
      style: e.style,
    })),
  }

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      <AppHeader
        user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}
        backHref="/study"
        backLabel="Mes notes"
        title={note.title}
      />
      <StudyLayout
        note={noteWithMessages}
        canvas={canvasData}
        isDiverged={isDiverged}
      />
    </div>
  )
}
