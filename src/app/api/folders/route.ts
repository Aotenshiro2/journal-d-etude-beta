import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

/** GET /api/folders — dossiers de l'utilisateur (restaurés par le pull extension). */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const folders = await prisma.folder.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(folders)
}
