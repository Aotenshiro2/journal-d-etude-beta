import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

const GRADES = new Set(['A', 'B', 'C'])
const CAUSE_CATEGORIES = new Set(['technique', 'connaissance', 'emotionnel'])
const REVIEW_DELAY_MS = 14 * 24 * 60 * 60 * 1000 // relecture à 2 semaines (masterclass edge)

/**
 * GET /api/annotations
 *   ?noteId=…      → annotations d'une note
 *   ?due=1         → annotations dont la relecture est échue (file de relecture)
 * Sinon : toutes les annotations de l'utilisateur.
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const noteId = searchParams.get('noteId')
  const due = searchParams.get('due')

  const annotations = await prisma.annotation.findMany({
    where: {
      userId,
      ...(noteId ? { noteId } : {}),
      ...(due ? { reviewedAt: null, reviewDueAt: { lte: new Date() } } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(annotations)
}

/**
 * POST /api/annotations
 * Body : { noteId?, messageRef?, grade: 'A'|'B'|'C', phrase, causeCategory? }
 * noteId accepte aussi un extensionNoteId (résolu côté serveur).
 * reviewDueAt est posé automatiquement à +14 jours si absent.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { noteId, messageRef, grade, phrase, causeCategory, reviewDueAt } = body

    if (!GRADES.has(grade)) {
      return NextResponse.json({ error: 'grade doit être A, B ou C' }, { status: 400 })
    }
    if (typeof phrase !== 'string' || !phrase.trim()) {
      return NextResponse.json({ error: 'phrase de justification requise' }, { status: 400 })
    }
    if (causeCategory != null && !CAUSE_CATEGORIES.has(causeCategory)) {
      return NextResponse.json({ error: 'causeCategory invalide' }, { status: 400 })
    }

    // Résoudre noteId : id journal direct, ou extensionNoteId (les annotations posées
    // depuis l'extension ne connaissent que leur propre id de note)
    let resolvedNoteId: string | null = null
    if (noteId) {
      const note = await prisma.note.findFirst({
        where: { userId, OR: [{ id: noteId }, { extensionNoteId: noteId }] },
        select: { id: true },
      })
      if (!note) return NextResponse.json({ error: 'Note introuvable' }, { status: 404 })
      resolvedNoteId = note.id
    }

    const annotation = await prisma.annotation.create({
      data: {
        userId,
        noteId: resolvedNoteId,
        messageRef: typeof messageRef === 'string' ? messageRef : null,
        grade,
        phrase: phrase.trim(),
        causeCategory: causeCategory ?? null,
        reviewDueAt: reviewDueAt ? new Date(reviewDueAt) : new Date(Date.now() + REVIEW_DELAY_MS),
      },
    })

    return NextResponse.json(annotation, { status: 201 })
  } catch (err) {
    console.error('[API /annotations POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/annotations — re-jugement / relecture
 * Body : { id, grade?, phrase?, causeCategory?, reviewed? }
 * reviewed: true → marque relue maintenant.
 */
export async function PATCH(req: NextRequest) {
  try {
    const userId = await getUserId(req)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { id, grade, phrase, causeCategory, reviewed } = body

    const existing = await prisma.annotation.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Annotation introuvable' }, { status: 404 })

    if (grade != null && !GRADES.has(grade)) {
      return NextResponse.json({ error: 'grade doit être A, B ou C' }, { status: 400 })
    }
    if (causeCategory != null && !CAUSE_CATEGORIES.has(causeCategory)) {
      return NextResponse.json({ error: 'causeCategory invalide' }, { status: 400 })
    }

    const annotation = await prisma.annotation.update({
      where: { id: existing.id },
      data: {
        ...(grade != null ? { grade } : {}),
        ...(typeof phrase === 'string' && phrase.trim() ? { phrase: phrase.trim() } : {}),
        ...(causeCategory !== undefined ? { causeCategory } : {}),
        ...(reviewed ? { reviewedAt: new Date() } : {}),
      },
    })

    return NextResponse.json(annotation)
  } catch (err) {
    console.error('[API /annotations PATCH]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
