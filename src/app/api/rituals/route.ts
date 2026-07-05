import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth' // Bearer (extension) + cookies (journal)

const TEXT_FIELDS = ['physical', 'emotional', 'dominantThought', 'objective', 'errors', 'lesson', 'recenter'] as const

export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rituals = await prisma.ritual.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
  return NextResponse.json(rituals)
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Body optionnel : l'extension peut créer une séance déjà remplie (warmup)
  let seed: Record<string, unknown> = {}
  try { seed = await req.json() } catch { /* pas de body */ }
  const data: Record<string, string | number | boolean> = {}
  for (const f of TEXT_FIELDS) if (typeof seed[f] === 'string') data[f] = seed[f] as string
  if (typeof seed.emotionLevel === 'number') data.emotionLevel = Math.max(0, Math.min(100, Math.round(seed.emotionLevel)))
  const ritual = await prisma.ritual.create({ data: { userId, ...data } })
  return NextResponse.json(ritual, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  if (typeof body.id !== 'string') return NextResponse.json({ error: 'id requis' }, { status: 400 })
  const existing = await prisma.ritual.findFirst({ where: { id: body.id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const data: Record<string, string | number | boolean | null> = {}
  for (const f of TEXT_FIELDS) {
    if (body[f] !== undefined) data[f] = typeof body[f] === 'string' ? body[f] : null
  }
  if (body.emotionLevel !== undefined) {
    const n = Number(body.emotionLevel)
    data.emotionLevel = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null
  }
  if (typeof body.closed === 'boolean') data.closed = body.closed

  const ritual = await prisma.ritual.update({ where: { id: body.id }, data })
  return NextResponse.json(ritual)
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  await prisma.ritual.deleteMany({ where: { id, userId } })
  return NextResponse.json({ ok: true })
}
