import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'
import { createClient as createBrowserClient } from '@supabase/supabase-js'

async function getUserId(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await supabase.auth.getUser(authHeader.slice(7))
    return user?.id ?? null
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const note = await prisma.note.findFirst({
    where: { id, userId },
    include: {
      messages: {
        orderBy: { order: 'asc' },
        include: { tags: { include: { tag: true } } },
      },
    },
  })

  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(note)
}
