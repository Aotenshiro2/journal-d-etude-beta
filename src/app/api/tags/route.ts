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

/**
 * POST /api/tags — créer/retrouver un tag par nom (idempotent).
 * Utilisé par « promouvoir un groupe en tag » (proto-concept → taxonomie).
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : ''
  if (!name) return NextResponse.json({ error: 'name requis' }, { status: 400 })

  const tag = await prisma.tag.upsert({
    where: { name_userId: { name, userId } },
    create: {
      name,
      userId,
      ...(typeof body.category === 'string' ? { category: body.category } : {}),
      ...(typeof body.color === 'string' ? { color: body.color } : {}),
    },
    update: {},
  })

  return NextResponse.json(tag, { status: 201 })
}
