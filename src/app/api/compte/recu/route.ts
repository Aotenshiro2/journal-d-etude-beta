import { NextRequest, NextResponse } from 'next/server'
import { corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { compteCompletDuJeton, lireIdPaiement, recuDuPaiement } from '@/lib/compte-membre'
import { messageErreur } from '@/lib/liveclub/pur'

/**
 * POST /api/compte/recu : le reçu Stripe d'un paiement du membre (page
 * /mon-espace/parametres du site, rubrique Achats, et carte Live Club).
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>,
 *   corps { paiement_id: 'stripe:ch_...' | 'stripe:py_...' }
 * Le paiement doit etre l'un de ceux que aok_compte_de(<compte du jeton>)
 * montre au membre ; la charge est lue sur le compte Stripe du paiement.
 *
 * Reponses :
 *   200 { ok: true, url }                     receipt_url de la charge (page Stripe)
 *   400 { ok: false, erreur: 'demande' }      identifiant illisible
 *   401 { ok: false, erreur: 'jeton' }
 *   403 { ok: false, erreur: 'paiement' }     pas un paiement de ce compte
 *   404 { ok: false, erreur: 'recu' }         Stripe n'a pas de reçu pour ce paiement
 *   503 { ok: false, erreur: 'config' | 'indisponible' }
 * Logs : compte tronque. Jamais l'email, l'identifiant du paiement ni l'URL.
 */

export const maxDuration = 20

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req) })
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)

  let compte: Awaited<ReturnType<typeof compteCompletDuJeton>>
  try {
    compte = await compteCompletDuJeton(req.headers.get('authorization'))
  } catch (err) {
    console.warn(`[compte/recu] verification du jeton impossible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!compte) return refus('jeton', 401)

  const corps = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const paiement = lireIdPaiement(corps?.paiement_id)
  if (!paiement) return refus('demande', 400)

  const r = await recuDuPaiement(compte.id, paiement)
  if (r.ok) return NextResponse.json({ ok: true, url: r.url }, { headers })
  if (r.erreur !== 'recu') console.log(`[compte/recu] ${tronquer(compte.id)} : ${r.erreur}`)
  const statut = r.erreur === 'paiement' ? 403 : r.erreur === 'recu' ? 404 : 503
  return refus(r.erreur, statut)
}
