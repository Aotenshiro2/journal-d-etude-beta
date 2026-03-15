import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'
import { createClient as createBrowserClient } from '@supabase/supabase-js'
import crypto from 'crypto'

async function getUserId(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await supabase.auth.getUser(token)
    return user?.id ?? null
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)

  // ?format=sourceUrls — utilisé par l'extension pour vérifier l'état réel de la sync
  // Retourne toutes les notes avec sourceUrl (incluant les soft-deleted)
  if (searchParams.get('format') === 'sourceUrls') {
    const notes = await prisma.note.findMany({
      where: { userId, sourceUrl: { not: null } },
      select: { sourceUrl: true, deletedAt: true },
    })
    return NextResponse.json(notes)
  }

  const notes = await prisma.note.findMany({
    where: { userId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      content: true,
      contentHash: true,
      source: true,
      sourceUrl: true,
      favicon: true,
      syncedAt: true,
      createdAt: true,
      updatedAt: true,
      userId: true,
    },
  })

  return NextResponse.json(notes)
}

function detectType(content: string): string {
  if (content.includes('<img')) return 'image'
  if (content.startsWith('<pre') || content.startsWith('<code')) return 'code'
  if (content.startsWith('<blockquote')) return 'quote'
  return 'text'
}

async function createMessagesFromHtml(noteId: string, html: string) {
  const blocks: { content: string; type: string }[] = []
  const blockRegex = /(<(?:p|h[1-6]|blockquote|pre|ul|ol)[^>]*>[\s\S]*?<\/(?:p|h[1-6]|blockquote|pre|ul|ol)>|<img[^>]*\/?>)/gi
  let match
  while ((match = blockRegex.exec(html)) !== null) {
    const content = match[1].trim()
    if (content) blocks.push({ content, type: detectType(content) })
  }
  if (blocks.length === 0) blocks.push({ content: html, type: 'text' })

  await prisma.message.createMany({
    data: blocks.map((b, i) => ({ noteId, content: b.content, order: i, type: b.type })),
  })
}

export async function POST(req: NextRequest) {
  try {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { title, content, sourceUrl, favicon, source, syncedAt, messages } = body

  const contentHash = content ? crypto.createHash('sha256').update(content).digest('hex') : null

  let note
  if (sourceUrl) {
    const existing = await prisma.note.findFirst({ where: { userId, sourceUrl } })
    if (existing) {
      note = await prisma.note.update({
        where: { id: existing.id },
        data: {
          title: title ?? existing.title,
          content: content ?? existing.content,
          contentHash,
          favicon: favicon ?? existing.favicon,
          syncedAt: syncedAt ? new Date(syncedAt) : new Date(),
          updatedAt: new Date(),
        },
      })
    } else {
      note = await prisma.note.create({
        data: {
          title: title ?? 'Nouvelle note',
          content: content ?? '',
          contentHash,
          userId,
          source: source ?? 'extension',
          sourceUrl,
          favicon,
          syncedAt: syncedAt ? new Date(syncedAt) : new Date(),
        },
      })
    }
  } else {
    note = await prisma.note.create({
      data: {
        title: title ?? 'Nouvelle note',
        content: content ?? '',
        contentHash,
        userId,
        source: source ?? 'manual',
        favicon,
        syncedAt: syncedAt ? new Date(syncedAt) : null,
      },
    })
  }

  // Handle messages
  if (Array.isArray(messages) && messages.length > 0) {
    const existingMessages = await prisma.message.findMany({
      where: { noteId: note.id },
      select: { order: true },
    })
    const existingOrders = new Set(existingMessages.map((m) => m.order))
    const newMsgs = messages
      .filter((_: unknown, i: number) => !existingOrders.has(i))
      .map((msg: { content?: string; type?: string }, i: number) => ({
        noteId: note.id,
        content: typeof msg === 'string' ? msg : (msg.content ?? ''),
        order: i,
        type: (msg as { type?: string }).type ?? detectType(typeof msg === 'string' ? msg : (msg.content ?? '')),
      }))
    if (newMsgs.length > 0) {
      await prisma.message.createMany({ data: newMsgs })
    }
  } else {
    const existingCount = await prisma.message.count({ where: { noteId: note.id } })
    if (existingCount === 0 && content) {
      await createMessagesFromHtml(note.id, content)
    }
  }

  return NextResponse.json(note, { status: 201 })
  } catch (err) {
    console.error('[API /notes POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
