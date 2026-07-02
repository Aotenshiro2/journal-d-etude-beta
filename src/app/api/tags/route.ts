import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

export async function GET(req: NextRequest) {
  // getUserId gère cookies (journal) ET Bearer token (extension → TagPickerPopup)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tags = await prisma.tag.findMany({
    where: { userId },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })

  return NextResponse.json(tags)
}
