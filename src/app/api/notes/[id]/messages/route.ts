import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const note = await prisma.note.findFirst({ where: { id, userId: user.id } })
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const messages = await prisma.message.findMany({
    where: { noteId: id },
    orderBy: { order: 'asc' },
    include: { tags: { include: { tag: true } } },
  })

  return NextResponse.json(messages)
}
