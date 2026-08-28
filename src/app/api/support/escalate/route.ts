import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

/**
 * POST /api/support/escalate — « je veux parler à un humain ».
 * Marque le fil escaladé (lisible plus tard dans le cockpit) et renvoie
 * l'adresse de contact : c'est le CLIENT qui ouvre le mailto avec la
 * transcription (v1 sans infra d'envoi d'email ; un envoi serveur type
 * Resend pourra remplacer ça plus tard sans changer l'extension).
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const threadId = typeof body.threadId === 'string' ? body.threadId : null
  if (threadId) {
    await prisma.supportThread.updateMany({
      where: { id: threadId, userId },
      data: { escalatedAt: new Date() },
    })
  }
  return NextResponse.json({ email: 'brice.d@aoknowledge.com' })
}
