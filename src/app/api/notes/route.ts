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
  // Retourne toutes les notes synquées depuis l'extension (incluant les soft-deleted)
  if (searchParams.get('format') === 'sourceUrls') {
    const notes = await prisma.note.findMany({
      where: { userId, OR: [{ sourceUrl: { not: null } }, { extensionNoteId: { not: null } }] },
      select: { sourceUrl: true, extensionNoteId: true, deletedAt: true },
    })
    return NextResponse.json(notes)
  }

  const notes = await prisma.note.findMany({
    where: { userId, deletedAt: null },
    orderBy: { lastModifiedAt: 'desc' },
    select: {
      id: true,
      title: true,
      content: true,
      contentHash: true,
      source: true,
      sourceUrl: true,
      favicon: true,
      lastSyncAt: true,
      createdAt: true,
      firstSyncAt: true,
      lastModifiedAt: true,
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
  const { title, content, sourceUrl, favicon, source, lastSyncAt, messages, createdAt, extensionVersion, extensionNoteId } = body

  const contentHash = content ? crypto.createHash('sha256').update(content).digest('hex') : null

  let note
  // Upsert logic:
  // 1. If extensionNoteId provided → look by ID first (exact match for this extension note)
  // 2. Fallback URL → only match legacy notes (extensionNoteId IS NULL):
  //    - If extensionNoteId provided: claim a legacy entry for this URL (migration), or skip if none
  //    - If no extensionNoteId: match any note by URL (manual journal notes)
  const existingByNoteId = extensionNoteId
    ? await prisma.note.findFirst({ where: { userId, extensionNoteId } })
    : null
  const existing = existingByNoteId ?? (
    sourceUrl
      ? await prisma.note.findFirst({
          where: {
            userId,
            sourceUrl,
            // When extensionNoteId is provided, only match legacy notes (no extensionNoteId yet)
            // This allows N notes per URL once all legacy entries have been claimed
            ...(extensionNoteId ? { extensionNoteId: null } : {}),
          },
        })
      : null
  )

  if (existing) {
    note = await prisma.note.update({
      where: { id: existing.id },
      data: {
        title: title ?? existing.title,
        content: content ?? existing.content,
        contentHash,
        favicon: favicon ?? existing.favicon,
        lastSyncAt: lastSyncAt ? new Date(lastSyncAt) : new Date(),
        extensionVersion: extensionVersion ?? existing.extensionVersion,
        // Backfill createdAt si absent (notes synquées avant que ce champ existait)
        createdAt: createdAt ? new Date(createdAt) : existing.createdAt,
        // Backfill extensionNoteId if it was missing (legacy notes synced before this change)
        ...(extensionNoteId && !existing.extensionNoteId ? { extensionNoteId } : {}),
        lastModifiedAt: new Date(),
      },
    })
  } else if (sourceUrl || extensionNoteId) {
    note = await prisma.note.create({
      data: {
        title: title ?? 'Nouvelle note',
        content: content ?? '',
        contentHash,
        userId,
        source: source ?? 'extension',
        sourceUrl: sourceUrl ?? null,
        favicon,
        lastSyncAt: lastSyncAt ? new Date(lastSyncAt) : new Date(),
        createdAt: createdAt ? new Date(createdAt) : null,
        extensionVersion: extensionVersion ?? null,
        extensionNoteId: extensionNoteId ?? null,
      },
    })
  } else {
    note = await prisma.note.create({
      data: {
        title: title ?? 'Nouvelle note',
        content: content ?? '',
        contentHash,
        userId,
        source: source ?? 'manual',
        favicon,
        lastSyncAt: lastSyncAt ? new Date(lastSyncAt) : null,
      },
    })
  }

  // Handle messages
  if (Array.isArray(messages) && messages.length > 0) {
    if (source === 'extension') {
      // Extension → remplace toujours tous les messages pour capturer les images
      // Filtrer les éléments null/undefined qui causent des erreurs de validation Prisma
      const validMessages = (messages as unknown[])
        .filter((msg) => msg != null)
        .map((msg: { content?: string; type?: string }, i: number) => ({
          noteId: note.id,
          content: typeof msg === 'string' ? msg : (msg.content ?? ''),
          order: i,
          type: (msg as { type?: string }).type ?? detectType(typeof msg === 'string' ? msg : (msg.content ?? '')),
        }))
      // Transaction batch (compatible PgBouncer transaction mode)
      // Si createMany échoue → deleteMany est rollbacké, messages existants préservés
      await prisma.$transaction([
        prisma.message.deleteMany({ where: { noteId: note.id } }),
        prisma.message.createMany({ data: validMessages }),
      ])

      // Process message-level tags (MessageTag upsert)
      const messagesWithTags = (messages as Array<{ tags?: string[]; content?: string }>)
        .filter(m => m != null && Array.isArray(m.tags) && m.tags.length > 0)
      if (messagesWithTags.length > 0) {
        const createdMessages = await prisma.message.findMany({
          where: { noteId: note.id },
          orderBy: { order: 'asc' },
          select: { id: true, order: true },
        })
        for (let i = 0; i < messages.length; i++) {
          const msgPayload = messages[i] as { tags?: string[] }
          if (!Array.isArray(msgPayload.tags) || msgPayload.tags.length === 0) continue
          const dbMessage = createdMessages.find(m => m.order === i)
          if (!dbMessage) continue
          for (const tagName of msgPayload.tags) {
            if (!tagName || typeof tagName !== 'string') continue
            const tag = await prisma.tag.upsert({
              where: { name_userId: { name: tagName, userId } },
              create: { name: tagName, userId },
              update: {},
            })
            await prisma.messageTag.upsert({
              where: { messageId_tagId: { messageId: dbMessage.id, tagId: tag.id } },
              create: { messageId: dbMessage.id, tagId: tag.id },
              update: {},
            })
          }
        }
      }
    } else {
      // Manual (journal) → conserver la logique incrémentale existante
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

export async function DELETE(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.note.deleteMany({ where: { userId } })
  return NextResponse.json({ deleted: true })
}
