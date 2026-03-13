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
  const updated = await prisma.canvas.update({
    where: { id },
    data: {
      noteContentHash: body.noteContentHash ?? undefined,
    },
    include: { nodes: true, edges: true },
  })

  return NextResponse.json(updated)
}
