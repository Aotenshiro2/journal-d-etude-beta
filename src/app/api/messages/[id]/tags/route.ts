import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: messageId } = await params
  const body = await req.json()
  const { name, category, color } = body

  // Upsert tag
  let tag = await prisma.tag.findFirst({ where: { name, userId: user.id } })
  if (!tag) {
    tag = await prisma.tag.create({
      data: { name, category: category ?? null, color: color ?? '#3b82f6', userId: user.id },
    })
  }

  // Upsert message-tag
  await prisma.messageTag.upsert({
    where: { messageId_tagId: { messageId, tagId: tag.id } },
    create: { messageId, tagId: tag.id },
    update: {},
  })

  return NextResponse.json(tag, { status: 201 })
}
