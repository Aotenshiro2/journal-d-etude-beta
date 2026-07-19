import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

// 0.1.5b — le groupe a-t-il un canvas de collection avec du travail dedans ?
// Utilisé par la dissolution (avertir sans bloquer : le mapping est conservé).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { groupId } = await params
  const canvas = await prisma.canvas.findFirst({
    where: { sourceGroupId: groupId, userId: user.id },
    select: { title: true, _count: { select: { nodes: true } } },
  })
  return NextResponse.json({
    exists: !!canvas && canvas._count.nodes > 0,
    title: canvas?.title ?? 'Collection',
  })
}
