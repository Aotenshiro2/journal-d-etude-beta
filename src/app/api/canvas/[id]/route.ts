import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const canvas = await prisma.canvas.findFirst({ where: { id, userId: user.id } })
  if (!canvas) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()

  // État de relecture : `reviewed:true` = relue maintenant (sort de la file) ;
  // `reviewed:false` = repasser en « à relire » ; `reminderDays` = rappel dans N jours.
  const data: {
    noteContentHash?: string
    reviewedAt?: Date | null
    reviewReminderAt?: Date | null
  } = {}
  if (body.noteContentHash != null) data.noteContentHash = body.noteContentHash
  if (body.reviewed === true) { data.reviewedAt = new Date(); data.reviewReminderAt = null }
  if (body.reviewed === false) data.reviewedAt = null
  if (typeof body.reminderDays === 'number' && body.reminderDays > 0) {
    data.reviewReminderAt = new Date(Date.now() + body.reminderDays * 24 * 60 * 60 * 1000)
  }

  // Remettre le canvas à zéro : blocs (qui reviennent dans la liste), groupes et textes
  // libres supprimés. La note d'origine (Message) n'est PAS touchée. On repart « pas relu ».
  if (body.reset === true) {
    await prisma.canvasEdge.deleteMany({ where: { canvasId: id } })
    await prisma.canvasNode.deleteMany({ where: { canvasId: id } })
    data.reviewedAt = null
    data.reviewReminderAt = null
  }

  const updated = await prisma.canvas.update({
    where: { id },
    data,
    include: { nodes: true, edges: true },
  })

  return NextResponse.json(updated)
}
