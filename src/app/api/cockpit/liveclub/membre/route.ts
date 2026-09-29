import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import {
  lireTelegramId, retirerDuLiveClub, reintegrerAuLiveClub, journaliserGesteLiveClub,
  type GesteLiveClub, type IssueGesteLiveClub,
} from '@/lib/stripe-actions'

/**
 * POST /api/cockpit/liveclub/membre : les boutons « retirer » et « réintégrer »
 * du cockpit sur le groupe Telegram Live Club (demande Brice du 29/09, sortie
 * de Metricgram, etape A : gestes MANUELS, rien d'automatique).
 *
 * Corps : { geste: 'retirer' | 'reintegrer', telegram_id, membre_id? }.
 * - retirer    : sortie SANS bannissement (unbanChatMember sans
 *   only_if_banned). Refus si exemption active ou si la personne est admin ou
 *   createur du groupe ; rien n'est fait si elle n'est pas dans le groupe.
 * - reintegrer : levee du ban s'il y en a un, puis lien d'invitation a usage
 *   unique (14 jours), RENDU dans invite_link pour que l'humain le transmette.
 *
 * Meme garde que /api/cockpit/mentorat : Bearer Supabase + cockpit_allowlist,
 * CORS des origines AOK. La logique Telegram est partagee avec l'agent
 * (src/lib/stripe-actions.ts). Chaque tentative authentifiee laisse une ligne
 * dans cockpit_liveclub_gestes, sans le lien.
 */

export const maxDuration = 30

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = corsHeaders(req)
  const refus = (erreur: string, status: number) =>
    NextResponse.json({ ok: false, erreur }, { status, headers })

  const userId = await getUserId(req)
  if (!userId) return refus('Unauthorized', 401)

  // Le garde réel : l allowlist du cockpit, par UUID. Être authentifié ne
  // prouve rien, le projet Supabase est partagé avec un site public.
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) return refus('Réservé au cockpit', 403)

  const body = await req.json().catch(() => ({}))
  const geste = body?.geste
  if (geste !== 'retirer' && geste !== 'reintegrer') {
    return refus('geste (retirer|reintegrer) requis', 400)
  }
  const acteur = `cockpit:${userId}`

  const membreBrut = body?.membre_id
  if (membreBrut != null && (typeof membreBrut !== 'string' || !UUID_RE.test(membreBrut))) {
    return refus('membre_id invalide (uuid attendu)', 400)
  }
  const membreId = typeof membreBrut === 'string' ? membreBrut.toLowerCase() : null

  const telegramId = lireTelegramId(body?.telegram_id)
  if (telegramId === null) {
    const invalide: IssueGesteLiveClub = {
      ok: false, geste: geste as GesteLiveClub, resultat: 'refuse', regle: 'requete_invalide',
      statutHttp: 400, details: {}, erreur: 'telegram_id invalide (le numéro u…, avec ou sans le u).',
    }
    await journaliserGesteLiveClub(invalide, { telegramId: null, membreId, acteur })
    return refus(invalide.erreur, 400)
  }

  let issue: IssueGesteLiveClub
  try {
    issue = geste === 'retirer'
      ? await retirerDuLiveClub(telegramId)
      : await reintegrerAuLiveClub(telegramId)
  } catch (err) {
    // Filet : les deux fonctions rendent leurs echecs, elles ne devraient
    // pas jeter. Le message ne porte jamais de lien (il n'existe pas encore).
    issue = {
      ok: false, geste, resultat: 'echec', regle: 'inattendu', statutHttp: 500, details: {},
      erreur: err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'Le geste a échoué.',
    }
  }

  await journaliserGesteLiveClub(issue, { telegramId, membreId, acteur })
  // Trace Vercel : qui, quoi, quelle issue. Jamais le lien.
  console.log(`[cockpit/liveclub/membre] ${userId} ${geste} u${telegramId} `
    + `${issue.ok ? 'fait' : `${issue.resultat} (${issue.regle})`}`)

  if (!issue.ok) return refus(issue.erreur, issue.statutHttp)
  return NextResponse.json(
    {
      ok: true,
      geste,
      ...(issue.invite_link ? { invite_link: issue.invite_link } : {}),
      message: issue.message,
    },
    { headers },
  )
}
