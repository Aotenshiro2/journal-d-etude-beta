import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import crypto from 'crypto'

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
      concepts: true,
      trades: true,
      folderId: true,
      tags: { select: { tag: { select: { name: true } } } },
    },
  })

  // Aplatir les tags de note en simple liste de noms (consommé par le pull extension)
  return NextResponse.json(
    notes.map(n => ({ ...n, tags: n.tags.map(t => t.tag.name) }))
  )
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
  const { title, content, sourceUrl, favicon, source, lastSyncAt, messages, createdAt, extensionVersion, extensionNoteId, tags, concepts, trades, folderId, folderName } = body

  // Dossier extension : upsert du nom pour que le pull puisse tout restaurer
  if (typeof folderId === 'string' && folderId && typeof folderName === 'string' && folderName.trim()) {
    await prisma.folder.upsert({
      where: { id: folderId },
      create: { id: folderId, userId, name: folderName.trim() },
      update: { name: folderName.trim() },
    })
  }

  const cleanConcepts: string[] | null = Array.isArray(concepts)
    ? concepts.filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 0)
    : null

  const cleanTrades = Array.isArray(trades) ? trades.filter((t: unknown) => t != null && typeof t === 'object') : null

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
        ...(cleanConcepts !== null ? { concepts: cleanConcepts } : {}),
        ...(cleanTrades !== null ? { trades: cleanTrades } : {}),
        ...(folderId !== undefined ? { folderId: folderId ?? null } : {}),
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
        concepts: cleanConcepts ?? [],
        ...(cleanTrades !== null ? { trades: cleanTrades } : {}),
        folderId: folderId ?? null,
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

  // Tags au niveau note (NoteTag) — même taxonomie Tag que les messages.
  // Sync extension = source de vérité : on remplace l'état complet (un tag retiré
  // dans l'extension disparaît aussi du journal).
  if (source === 'extension' && Array.isArray(tags)) {
    const cleanTags = tags.filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0)
    await prisma.noteTag.deleteMany({ where: { noteId: note.id } })
    for (const tagName of cleanTags) {
      const tag = await prisma.tag.upsert({
        where: { name_userId: { name: tagName, userId } },
        create: { name: tagName, userId },
        update: {},
      })
      await prisma.noteTag.create({ data: { noteId: note.id, tagId: tag.id } })
    }
  }

  // Handle messages
  if (Array.isArray(messages) && messages.length > 0) {
    if (source === 'extension') {
      // Extension → remplace toujours tous les messages pour capturer les images
      // Filtrer les éléments null/undefined qui causent des erreurs de validation Prisma
      const validMessages = (messages as unknown[])
        .filter((msg) => msg != null)
        .map((msg: { content?: string; type?: string; id?: string; tradeRef?: string }, i: number) => ({
          noteId: note.id,
          content: typeof msg === 'string' ? msg : (msg.content ?? ''),
          order: i,
          type: (msg as { type?: string }).type ?? detectType(typeof msg === 'string' ? msg : (msg.content ?? '')),
          // ID stable côté extension — les annotations de messages s'y réfèrent (messageRef)
          extensionMessageId: typeof msg === 'string' ? null : (msg.id ?? null),
          tradeRef: typeof msg === 'string' ? null : (msg.tradeRef ?? null),
        }))
      // Upsert par extensionMessageId pour PRÉSERVER Message.id d'une sync à l'autre.
      // ⚠️ Avant : deleteMany + createMany régénérait tous les id → les nœuds du canvas
      // d'étude (CanvasNode.messageId → Message.id) devenaient orphelins à CHAQUE sync,
      // détruisant la réorganisation de l'élève. On met désormais à jour en place.
      const existingMsgs = await prisma.message.findMany({
        where: { noteId: note.id },
        select: { id: true, extensionMessageId: true },
      })
      const idByExt = new Map(
        existingMsgs
          .filter((m) => m.extensionMessageId)
          .map((m) => [m.extensionMessageId as string, m.id])
      )
      const ops: Prisma.PrismaPromise<unknown>[] = []
      const keptIds = new Set<string>()
      for (const m of validMessages) {
        const existingId = m.extensionMessageId ? idByExt.get(m.extensionMessageId) : undefined
        if (existingId) {
          keptIds.add(existingId)
          ops.push(prisma.message.update({
            where: { id: existingId },
            data: { content: m.content, order: m.order, type: m.type, tradeRef: m.tradeRef },
          }))
        } else {
          ops.push(prisma.message.create({ data: m }))
        }
      }
      // Messages disparus de l'extension (et legacy sans extid) : on les retire.
      const toDelete = existingMsgs.filter((m) => !keptIds.has(m.id)).map((m) => m.id)
      if (toDelete.length > 0) {
        ops.unshift(prisma.message.deleteMany({ where: { id: { in: toDelete } } }))
      }
      // Transaction batch (compatible PgBouncer transaction mode)
      await prisma.$transaction(ops)

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
