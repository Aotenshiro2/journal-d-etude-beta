import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { extractWikilinks } from '@/lib/wikilinks'
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
  const note = await prisma.note.findFirst({ where: { id, userId } })
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const messages = await prisma.message.findMany({
    where: { noteId: id },
    orderBy: { order: 'asc' },
    include: { tags: { include: { tag: true } } },
  })

  return NextResponse.json(messages)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const note = await prisma.note.findFirst({ where: { id, userId } })
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { content, type } = await req.json()
  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 })
  // Contrat 0.1.2 : un bloc texte vide (HTML sans texte) n'entre jamais en base
  if ((type ?? 'text') === 'text' && !content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()) {
    return NextResponse.json({ error: 'empty text block rejected' }, { status: 400 })
  }

  const lastMessage = await prisma.message.findFirst({
    where: { noteId: id }, orderBy: { order: 'desc' },
  })
  const nextOrder = (lastMessage?.order ?? -1) + 1

  const message = await prisma.message.create({
    data: { noteId: id, content, order: nextOrder, type: type ?? 'text' },
  })

  // 0.1.4 — [[concept]] : chaque wikilink relie le bloc au concept (MessageTag).
  // Seuls les concepts EXISTANTS sont liés (la création explicite passe par
  // l'autocomplete de la capture bar → POST /api/tags) : pas de tags-typos.
  const linkNames = extractWikilinks(content)
  if (linkNames.length > 0) {
    const tags = await prisma.tag.findMany({ where: { userId, name: { in: linkNames } }, select: { id: true } })
    if (tags.length > 0) {
      await prisma.messageTag.createMany({
        data: tags.map(t => ({ messageId: message.id, tagId: t.id })),
        skipDuplicates: true,
      })
    }
  }

  return NextResponse.json(message, { status: 201 })
}
