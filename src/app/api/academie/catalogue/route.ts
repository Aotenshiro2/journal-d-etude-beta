import { NextRequest, NextResponse } from 'next/server'
import { droitsVisiteur } from '@/lib/academie/droits'
import { lireCatalogue } from '@/lib/academie/catalogue'
import { corsAcademie, entetesAcademie, refusAcademie } from '@/lib/academie/http'
import { construire } from '@/lib/academie/vue-moi'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * GET /api/academie/catalogue : la vue d'un VISITEUR sans compte (19/10/2026,
 * Brice : « on peut montrer le prix aux visiteurs non connectes »). Route
 * PUBLIQUE (middleware.ts), meme forme que /api/academie/moi :
 * { ok, visiteur: true, compte: { admin: false, etm: false, live_club: 'non_lu' }, incomplet: false, continuer: null, modules }
 * Droits = offres de base seulement (droitsVisiteur), aucune progression.
 * Ni identifiant Bunny ou Wistia, ni contenu : comme /moi.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const METHODES = 'GET, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

export async function GET(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  try {
    const [droits, catalogue] = await Promise.all([droitsVisiteur(), lireCatalogue()])
    const { modules } = construire(catalogue, droits, new Map())
    return NextResponse.json(
      { ok: true, visiteur: true, compte: { admin: false, etm: false, live_club: 'non_lu' }, incomplet: false, continuer: null, modules },
      { headers },
    )
  } catch (err) {
    console.warn(`[academie/catalogue] lecture impossible : ${relationAbsente(err) ? 'tables academie absentes' : messageErreur(err)}`)
    return refusAcademie('indisponible', 503, headers)
  }
}
