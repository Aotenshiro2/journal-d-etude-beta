import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

const TEXT_FIELDS = ['physical', 'emotional', 'dominantThought', 'objective', 'errors', 'lesson', 'recenter'] as const

async function uid() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function GET() {
  const userId = await uid()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rituals = await prisma.ritual.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
  return NextResponse.json(rituals)
}

export async function POST() {
  const userId = await uid()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const ritual = await prisma.ritual.create({ data: { userId } })
  return NextResponse.json(ritual, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const userId = await uid()
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
  const userId = await uid()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  await prisma.ritual.deleteMany({ where: { id, userId } })
  return NextResponse.json({ ok: true })
}
