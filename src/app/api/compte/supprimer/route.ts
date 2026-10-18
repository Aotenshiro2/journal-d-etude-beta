import { NextRequest, NextResponse } from 'next/server'
import { corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { compteCompletDuJeton, transmettreDemandeSuppression } from '@/lib/compte-membre'
import { messageErreur } from '@/lib/liveclub/pur'

/**
 * POST /api/compte/supprimer : le membre DEMANDE la suppression de son compte
 * depuis /mon-espace/parametres (rubrique Données). Rien n'est efface ici
 * (Brice, 18/10/2026 : « une demande via l'equipe est mieux, ca evite les
 * decisions impulsives ») : l'equipe est prevenue par Agent AOK avec l'email
 * confirme du compte du jeton, voit le niveau avec la personne puis
 * l'execute depuis le cockpit (docs/EFFACEMENT-DONNEES.md, section 3 bis).
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>, sans corps.
 *
 * Reponses :
 *   200 { ok: true }                          demande transmise a l'equipe
 *   401 { ok: false, erreur: 'jeton' }
 *   409 { ok: false, erreur: 'email' }        compte sans email confirme
 *   503 { ok: false, erreur: 'panne' | 'indisponible' }
 */

export const maxDuration = 30

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
    console.warn(`[compte/supprimer] verification du jeton impossible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!compte) return refus('jeton', 401)
  if (!compte.email) return refus('email', 409)

  console.log(`[compte/supprimer] demande transmise pour le compte ${tronquer(compte.id)}`)
  const r = await transmettreDemandeSuppression({ id: compte.id, email: compte.email })
  if (r.ok) return NextResponse.json({ ok: true }, { headers })
  return refus(r.erreur, 503)
}
