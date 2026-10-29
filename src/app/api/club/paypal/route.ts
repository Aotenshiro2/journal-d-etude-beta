import { NextRequest, NextResponse } from 'next/server'
import { clientIdPayPal, configPayPal, ventePubliqueClub } from '@/lib/academie/club-paypal'
import { corsAcademie, entetesAcademie, refusAcademie } from '@/lib/academie/http'

/**
 * GET /api/club/paypal : ce que la page /club demande avant de charger le JS
 * SDK de PayPal (29/10/2026). Route PUBLIQUE (middleware.ts).
 *
 * 200 { ok, client_id, ouvert } : client_id est public (il est dans l'adresse
 *     du SDK) ; ouvert = CLUB_PAYPAL_PUBLIC vaut 1 (sinon seul l'essai admin passe).
 * 503 'config' : PAYPAL_CLIENT_ID ou PAYPAL_CLIENT_SECRET absent.
 */

export const dynamic = 'force-dynamic'

const METHODES = 'GET, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

export function GET(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const clientId = clientIdPayPal()
  if (!configPayPal() || !clientId) {
    console.warn('[club/paypal] config absente (PAYPAL_CLIENT_ID ou PAYPAL_CLIENT_SECRET)')
    return refusAcademie('config', 503, headers)
  }
  return NextResponse.json({ ok: true, client_id: clientId, ouvert: ventePubliqueClub() }, { headers })
}
