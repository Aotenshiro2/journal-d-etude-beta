import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

const FIELDS = ['name', 'area', 'trigger', 'thoughts', 'emotions', 'behaviors', 'actions', 'decisionShift', 'perceptionShift', 'mistake', 'correction'] as const

async function uid() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function GET() {
  const userId = await uid()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const patterns = await prisma.pattern.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } })
  return NextResponse.json(patterns)
}

export async function POST() {
  const userId = await uid()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pattern = await prisma.pattern.create({ data: { userId } })
  return NextResponse.json(pattern, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const userId = await uid()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  if (typeof body.id !== 'string') return NextResponse.json({ error: 'id requis' }, { status: 400 })
  const existing = await prisma.pattern.findFirst({ where: { id: body.id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const data: Record<string, string | null> = {}
  for (const f of FIELDS) {
    if (body[f] !== undefined) data[f] = typeof body[f] === 'string' ? body[f] : null
  }
  const pattern = await prisma.pattern.update({ where: { id: body.id }, data })
  return NextResponse.json(pattern)
}

export async function DELETE(req: NextRequest) {
  const userId = await uid()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  await prisma.pattern.deleteMany({ where: { id, userId } })
  return NextResponse.json({ ok: true })
}
