import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { entetesAcademie, corsAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { lienReservation, URL_RESERVATION_COACHING } from '@/lib/academie/club-paypal-pur'
import { droitsDuCompte, seancesDuCompte } from '@/lib/coaching/base'
import { resumerCoaching, vueMembre } from '@/lib/coaching/pur'
import { compteCompletDuJeton } from '@/lib/compte-membre'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * POST /api/compte/coaching : la rubrique « Mon coaching » de Mon espace
 * (09/11/2026, src/lib/coaching/). Le compte du jeton Bearer du site, ses
 * droits (packs achetes, seances offertes, ETM, heures payees sur Cal) et ses
 * seances, par son uuid et tous ses emails verifies.
 *
 * 200 { ok: true, visible, lignes: [{ phrase, detail, titre, coach_nom, reserver }],
 *       prochain, historique } : rien d'autre (ni email, ni note de l'equipe, ni
 *       identifiant, ni source d'une seance). visible = faux : la page cache la rubrique.
 * 401 { ok: false, erreur: 'jeton' } ; 503 { ok: false, erreur: 'migration' | 'indisponible' }.
 *
 * Le bouton pour reserver : le lien de reservation du pack s'il est pose
 * (COACHING_RESERVATION_URL pour coaching-8h, la meme variable que l'email
 * d'achat), sinon « ecrire au coach » (la page du support du site).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req) })
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req)
  let compte: Awaited<ReturnType<typeof compteCompletDuJeton>>
  try {
    compte = await compteCompletDuJeton(req.headers.get('authorization'))
  } catch (err) {
    console.warn(`[compte/coaching] verification du jeton impossible : ${messageErreur(err)}`)
    return refusAcademie('indisponible', 503, headers)
  }
  if (!compte) return refusAcademie('jeton', 401, headers)

  try {
    const [droits, seances] = await Promise.all([droitsDuCompte(prisma, compte.id), seancesDuCompte(prisma, compte.id)])
    const vue = vueMembre(resumerCoaching(droits, seances), {
      'coaching-8h': lienReservation(process.env.COACHING_RESERVATION_URL) ?? URL_RESERVATION_COACHING,
    })
    return NextResponse.json({ ok: true, ...vue }, { headers })
  } catch (err) {
    if (relationAbsente(err)) return refusAcademie('migration', 503, headers)
    console.error(`[compte/coaching] ${tronquer(compte.id)} : echec (${err instanceof Error ? err.name : 'erreur'})`)
    return refusAcademie('indisponible', 503, headers)
  }
}
