import { NextRequest, NextResponse } from 'next/server'
import { corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { compteCompletDuJeton } from '@/lib/compte-membre'
import { enregistrerDemandeSupport } from '@/lib/support-membre'
import { lireDemandeSupport } from '@/lib/support-membre-pur'
import { messageErreur } from '@/lib/liveclub/pur'

/**
 * POST /api/compte/support : une demande de la page /mon-espace/support du
 * site (lot 1, Brice 18/10/2026). Rangee en fil « attend un humain » dans
 * l'onglet Support du cockpit, annoncee a l'equipe par Agent AOK
 * (src/lib/support-membre.ts).
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>,
 *   corps { espace, message (1000 caracteres), captures?: ['<uuid>/<uuid>.webp'], paiement_id? }
 * Les captures sont deja deposees par le navigateur dans le dossier du compte
 * (bucket prive support-captures) : le serveur verifie qu'elles y sont.
 *
 * Reponses :
 *   200 { ok: true, prevenue }                demande enregistree (prevenue = l'equipe a recu l'alerte)
 *   400 { ok: false, erreur: 'demande' | 'espace' | 'message' | 'captures' | 'paiement' }
 *   401 { ok: false, erreur: 'jeton' }
 *   429 { ok: false, erreur: 'limite' }       5 demandes sur 24 heures
 *   503 { ok: false, erreur: 'indisponible' }
 * Logs : compte tronque et motif. Jamais l'email ni le texte.
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
    console.warn(`[compte/support] verification du jeton impossible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!compte) return refus('jeton', 401)

  const corps = await req.json().catch(() => null)
  const d = lireDemandeSupport(corps, compte.id)
  if (typeof d === 'string') return refus(d, 400)

  const r = await enregistrerDemandeSupport(compte, d)
  if (r.ok) {
    console.log(`[compte/support] demande de ${tronquer(compte.id)} (${d.espace}, ${d.captures.length} capture(s)), equipe ${r.prevenue ? 'prevenue' : 'NON prevenue'}`)
    return NextResponse.json({ ok: true, prevenue: r.prevenue }, { headers })
  }
  console.log(`[compte/support] ${tronquer(compte.id)} : ${r.erreur}`)
  const statut = r.erreur === 'limite' ? 429 : r.erreur === 'indisponible' ? 503 : 400
  return refus(r.erreur, statut)
}
