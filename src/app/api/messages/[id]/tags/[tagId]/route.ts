import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: messageId, tagId } = await params
  await prisma.messageTag.delete({
    where: { messageId_tagId: { messageId, tagId } },
  })

  return NextResponse.json({ ok: true })
}
