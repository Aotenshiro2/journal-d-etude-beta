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
 *
 * 0.1.3 — « le nom SERT » : noteIds[] / messageIds[] optionnels — le contenu
 * du groupe promu porte alors le concept (NoteTag / MessageTag), ce qui
 * alimente /concepts (récurrence, co-occurrences, tendances A/B/C).
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

  let linkedNotes = 0
  let linkedMessages = 0

  const noteIds: string[] = Array.isArray(body.noteIds) ? body.noteIds.filter((x: unknown) => typeof x === 'string') : []
  if (noteIds.length > 0) {
    // Ceinture : ne lier que les notes appartenant à l'utilisateur
    const owned = await prisma.note.findMany({ where: { id: { in: noteIds }, userId }, select: { id: true } })
    if (owned.length > 0) {
      const res = await prisma.noteTag.createMany({
        data: owned.map(n => ({ noteId: n.id, tagId: tag.id })),
        skipDuplicates: true,
      })
      linkedNotes = res.count
    }
  }

  const messageIds: string[] = Array.isArray(body.messageIds) ? body.messageIds.filter((x: unknown) => typeof x === 'string') : []
  if (messageIds.length > 0) {
    const owned = await prisma.message.findMany({
      where: { id: { in: messageIds }, note: { userId } },
      select: { id: true },
    })
    if (owned.length > 0) {
      const res = await prisma.messageTag.createMany({
        data: owned.map(m => ({ messageId: m.id, tagId: tag.id })),
        skipDuplicates: true,
      })
      linkedMessages = res.count
    }
  }

  return NextResponse.json({ ...tag, linkedNotes, linkedMessages }, { status: 201 })
}
