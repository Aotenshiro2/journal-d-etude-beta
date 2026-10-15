import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { retirerTarifReserve } from '@/lib/liveclub/reserves'
import { messageErreur } from '@/lib/liveclub/pur'

/**
 * POST /api/cockpit/liveclub/reserves : le bouton « Retirer » de la liste des
 * tarifs reserves du cockpit (Brice, 13/10). La table
 * cockpit_liveclub_tarifs_reserves n'a aucun grant d'ecriture navigateur :
 * comme les autres gestes du Live Club, le cockpit passe par cette route.
 *
 * Corps : { reserve_id: uuid }.
 * Reponse : { ok: true, message } ou { ok: false, erreur }.
 *
 * Meme garde que /api/cockpit/liveclub/membre : Bearer Supabase +
 * cockpit_allowlist. Meme fonction que la carte de l'agent
 * (proposer_retirer_tarif_reserve) : la ligne est retiree, puis, si rien
 * n'est paye, le lien de paiement est desactive et un tarif cree pour la
 * personne est archive. Une reservation payee ne touche pas a l'abonnement.
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

  // Le garde reel : l'allowlist du cockpit, par UUID. Etre authentifie ne
  // prouve rien, le projet Supabase est partage avec un site public.
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) return refus('Réservé au cockpit', 403)

  const body = await req.json().catch(() => ({}))
  const id = typeof body?.reserve_id === 'string' ? body.reserve_id.trim().toLowerCase() : ''
  if (!UUID_RE.test(id)) return refus('reserve_id invalide (uuid attendu).', 400)

  try {
    const issue = await retirerTarifReserve({ reserveId: id, email: null }, `cockpit:${userId}`)
    if (!issue.ok) return refus(issue.refus, 409)
    console.log(`[cockpit/liveclub/reserves] ${userId} retrait ${id}`)
    return NextResponse.json({ ok: true, message: issue.message }, { headers })
  } catch (err) {
    console.error(`[cockpit/liveclub/reserves] retrait impossible : ${messageErreur(err)}`)
    return refus("La base n'a pas répondu : rien n'a été retiré. Réessaie dans un instant.", 502)
  }
}
