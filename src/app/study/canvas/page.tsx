import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import AppHeader from '@/components/AppHeader'
import NoteMapCanvas from '@/components/NoteMapCanvas'
import { NoteData, CanvasData } from '@/types'

export default async function NoteMapPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const notes = await prisma.note.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      content: true,
      contentHash: true,
      favicon: true,
      sourceUrl: true,
      source: true,
      syncedAt: true,
      createdAt: true,
      updatedAt: true,
      userId: true,
    },
  })

  // Get or create note-map canvas
  let canvas = await prisma.canvas.findFirst({
    where: { userId: user.id, type: 'note-map', noteId: null },
    include: { nodes: true, edges: true },
  })

  if (!canvas) {
    canvas = await prisma.canvas.create({
      data: { type: 'note-map', userId: user.id },
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
        title="Carte des notes"
      />
      <NoteMapCanvas
        notes={notes as NoteData[]}
        canvas={canvasData}
      />
    </div>
  )
}
