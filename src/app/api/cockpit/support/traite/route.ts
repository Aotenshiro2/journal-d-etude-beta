import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { traiterFilHorsBot } from '@/lib/support-traite'

/**
 * POST /api/cockpit/support/traite : « Déjà traité » depuis l'onglet Support
 * (Brice, 05/11). Corps : { threadId }.
 *
 * Une demande d'humain reglee hors du bot (WhatsApp, email, en direct) : le
 * fil sort de l'attente, une ligne « [système] Traité hors du bot par <nom> »
 * au fil (elle rend aussi la main au bot), le reste de l'equipe le sait par
 * Agent AOK. Rien n'est dit au membre. Tous les fils (bot, site, extension).
 * Meme geste que le bouton « Déjà traité » sous l'alerte d'Agent AOK
 * (support-traite.ts).
 *
 * Garde : Bearer Supabase + cockpit_allowlist, CORS des origines AOK.
 * Reponses : 200 { ok, dejaTraite, messages, escalatedAt: null } ; 400 ; 401 ;
 * 403 ; 404 fil introuvable ; 503 base illisible.
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

  try {
    const issue = await traiterFilHorsBot(threadId, userId, '[cockpit/support/traite]')
    if (!issue.ok) return NextResponse.json({ error: 'Fil introuvable' }, { status: 404, headers })
    return NextResponse.json({ ok: true, dejaTraite: issue.dejaTraite, messages: issue.messages, escalatedAt: null }, { headers })
  } catch (err) {
    console.error('[cockpit/support/traite] base illisible', err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : '?')
    return NextResponse.json({ error: 'Base illisible : réessaie dans un instant.' }, { status: 503, headers })
  }
}
