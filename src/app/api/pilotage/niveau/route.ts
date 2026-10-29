import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { niveauDuMembre } from '@/lib/pilotage-niveau'

/**
 * GET /api/pilotage/niveau (Bearer, CORS de Pilotage) : le palier du membre
 * et ses compteurs (brief E1, 30/10/2026).
 *
 * { palier: 'libre' | 'premium' | 'equipe', raison,
 *   lectures: { utilisees, limite: number | null, offertes, jusquAu },
 *   coffre: { octets, limite }, portail: url | null,
 *   offres: { premiumMensuel: 5.99, premiumAnnuel: 57, duoMensuel: 8.99, duoAnnuel: 79 } }
 *
 * raison : 'equipe', 'premium-duo', 'pilotage-premium', une raison Club du
 * Carnet (liveclub, formation, etm, manuel, skool-vip, skool-premium), null en
 * libre. portail : une session du portail client Stripe (URL de courte duree)
 * quand le membre a un abonnement Pilotage, sinon null.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const METHODES = 'GET, OPTIONS'

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req, METHODES)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Non connecté.' }, { status: 401, headers: cors })
  try {
    const niveau = await niveauDuMembre(userId)
    return NextResponse.json(niveau, { headers: { ...cors, 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[pilotage/niveau]', err)
    return NextResponse.json({ error: 'Le palier ne se lit pas pour le moment.' }, { status: 503, headers: cors })
  }
}
