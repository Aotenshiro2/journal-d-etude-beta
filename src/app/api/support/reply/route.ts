import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'

/**
 * POST /api/support/reply — la prise de main humaine depuis le cockpit.
 *
 * Réservé à l'allowlist du cockpit (`cockpit_allowlist`, la même qui garde
 * tout l'écran) : être authentifié ne prouve rien, le projet Supabase est
 * partagé avec un site à inscription publique.
 *
 * Ajoute un message `role: 'human'` au fil et remet `escalatedAt` à null :
 * la demande d'humain est prise en main. Le membre voit la réponse dans le
 * chat de son extension (qui recharge le fil à l'ouverture).
 *
 * CORS : le cockpit (cockpit.aoknowledge.com) appelle depuis le navigateur,
 * contrairement à l'extension qui échappe au CORS par ses host_permissions.
 */

const MAX_MESSAGE_LEN = 4000

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  // Le garde réel : l'allowlist du cockpit, par UUID.
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) {
    return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers })
  }

  const body = await req.json().catch(() => ({}))
  const threadId = typeof body.threadId === 'string' ? body.threadId : null
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_LEN) : ''
  if (!threadId || !message) {
    return NextResponse.json({ error: 'threadId et message requis' }, { status: 400, headers })
  }

  const thread = await prisma.supportThread.findUnique({ where: { id: threadId } })
  if (!thread) return NextResponse.json({ error: 'Fil introuvable' }, { status: 404, headers })

  const messages = (Array.isArray(thread.messages) ? thread.messages : []) as unknown[]
  const nouveau = { role: 'human', content: message, at: new Date().toISOString() }

  const maj = await prisma.supportThread.update({
    where: { id: thread.id },
    data: {
      messages: [...messages, nouveau] as object[],
      // La demande d'humain est prise en main : la chip « veut un humain »
      // s'éteint dans le cockpit. Une nouvelle escalade la rallumera.
      escalatedAt: null,
    },
  })

  return NextResponse.json({ ok: true, messages: maj.messages }, { headers })
}
