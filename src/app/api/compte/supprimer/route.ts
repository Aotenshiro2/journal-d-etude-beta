import { NextRequest, NextResponse } from 'next/server'
import { corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { compteCompletDuJeton, MOT_CONFIRMATION, supprimerCompte } from '@/lib/compte-membre'
import { messageErreur } from '@/lib/liveclub/pur'

/**
 * POST /api/compte/supprimer : le membre supprime SON compte depuis
 * /mon-espace/parametres (rubrique Données). Geste explicite du membre, qui
 * a ecrit SUPPRIMER : c'est l'effacement de niveau 3 de l'equipe
 * (effacement.ts, docs/EFFACEMENT-DONNEES.md section 3 bis), sur la seule
 * personne du jeton.
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>,
 *   corps { confirmation: 'SUPPRIMER' }
 *
 * Reponses :
 *   200 { ok: true, message }                 fait ; message = recapitulatif pour la personne
 *   400 { ok: false, erreur: 'confirmation' } mot de confirmation absent ou faux
 *   401 { ok: false, erreur: 'jeton' }
 *   409 { ok: false, erreur: 'email' }        compte sans email confirme
 *   409 { ok: false, erreur: 'refus' }        cas a traiter par l'equipe : rien n'a ete fait
 *   503 { ok: false, erreur: 'panne' | 'indisponible' }
 * L'equipe recoit le compte rendu par Agent AOK dans tous les cas.
 */

export const maxDuration = 60

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

  const corps = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (corps?.confirmation !== MOT_CONFIRMATION) return refus('confirmation', 400)
  if (!compte.email) return refus('email', 409)

  console.log(`[compte/supprimer] demande du compte ${tronquer(compte.id)}`)
  const r = await supprimerCompte({ id: compte.id, email: compte.email })
  if (r.ok) return NextResponse.json({ ok: true, message: r.message }, { headers })
  return refus(r.erreur, r.erreur === 'refus' ? 409 : 503)
}
