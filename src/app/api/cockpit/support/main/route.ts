import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { rendreLaMainAuBot } from '@/lib/liveclub/support-pont'

/**
 * POST /api/cockpit/support/main : « Rendre la main au bot » depuis l'onglet
 * Support (Brice, 16/10). Corps : { threadId }.
 *
 * Des que l'equipe repond dans un fil du bot des membres, elle a la main : le
 * bot ne repond plus aux messages ecrits du membre (support-pont-pur.ts,
 * quiRepond). Ce bouton la lui rend : une ligne « [système] » au fil, et le
 * fil sort de l'attente. Rien n'est dit au membre. Meme geste que le bouton
 * sous l'alerte d'Agent AOK et que la phrase « rends la main au bot ».
 *
 * Garde : Bearer Supabase + cockpit_allowlist, CORS des origines AOK.
 * Reponses : 200 { ok, dejaAuBot, messages, escalatedAt: null } ; 400 ; 401 ;
 * 403 ; 404 fil introuvable ; 409 pas un fil du bot des membres.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers })

  const body = await req.json().catch(() => ({}))
  const threadId = typeof body?.threadId === 'string' && UUID.test(body.threadId) ? body.threadId.toLowerCase() : null
  if (!threadId) return NextResponse.json({ error: 'threadId requis' }, { status: 400, headers })

  const issue = await rendreLaMainAuBot(threadId)
  if (!issue.ok) {
    return issue.raison === 'introuvable'
      ? NextResponse.json({ error: 'Fil introuvable' }, { status: 404, headers })
      : NextResponse.json({ error: "Ce fil n'est pas un fil du bot Live Club : il n'y a pas de bot à qui rendre la main." }, { status: 409, headers })
  }
  console.log(`[cockpit/support/main] ${userId} main rendue au bot (fil ${threadId.slice(0, 8)}${issue.dejaAuBot ? ', deja au bot' : ''})`)
  return NextResponse.json({ ok: true, dejaAuBot: issue.dejaAuBot, messages: issue.messages, escalatedAt: null }, { headers })
}
