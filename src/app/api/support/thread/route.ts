import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'

/**
 * GET /api/support/thread — le dernier fil de support de l'utilisateur.
 *
 * Sert à l'extension pour ROUVRIR la conversation au lieu de repartir de
 * zéro à chaque ouverture du panneau : sans ça, une réponse humaine posée
 * depuis le cockpit n'atteindrait jamais le membre.
 *
 * `?app=` (optionnel) : filtre par app d'origine (site, masterclass,
 * pilotage, journal, extension) — chaque frontend rouvre SON fil, pas celui
 * d'une autre app. Sans paramètre : comportement d'origine (le plus récent
 * toutes apps confondues, ce que l'extension utilise).
 */
export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })

  const app = req.nextUrl.searchParams.get('app')?.slice(0, 32) || null
  const thread = await prisma.supportThread.findFirst({
    where: app ? { userId, app } : { userId },
    orderBy: { updatedAt: 'desc' },
  })
  if (!thread) return NextResponse.json({ threadId: null, messages: [] }, { headers: cors })

  return NextResponse.json({
    threadId: thread.id,
    messages: Array.isArray(thread.messages) ? thread.messages : [],
    escalatedAt: thread.escalatedAt,
  }, { headers: cors })
}
