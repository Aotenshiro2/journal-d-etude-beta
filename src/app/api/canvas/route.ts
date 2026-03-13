import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const noteId = req.nextUrl.searchParams.get('noteId')
  if (!noteId) return NextResponse.json({ error: 'noteId required' }, { status: 400 })

  // Verify note belongs to user
  const note = await prisma.note.findFirst({ where: { id: noteId, userId: user.id } })
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let canvas = await prisma.canvas.findUnique({
    where: { noteId },
    include: {
      nodes: true,
      edges: true,
    },
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

  // Check divergence
  const isDiverged = note.contentHash && canvas.noteContentHash && note.contentHash !== canvas.noteContentHash

  return NextResponse.json({ ...canvas, isDiverged: !!isDiverged })
}
