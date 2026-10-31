import { NextRequest, NextResponse } from 'next/server'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie } from '@/lib/academie/http'
import { confirmerCode } from '@/lib/emails-confirmation'
import { lireCode, lireCorps, normaliserEmail } from '@/lib/emails-confirmation-pur'

/**
 * POST /api/compte/emails/confirmer : le membre tape le code recu a l'adresse
 * qu'il ajoute (GO de Brice du 31/10/2026, voir /api/compte/emails/ajouter).
 * Juste : l'adresse passe verified = true sur SON compte et ouvre ce qui a ete
 * paye avec elle (academie, Live Club). Une adresse verifiee d'un autre compte
 * n'est jamais touchee ; les lignes NON verifiees de la meme adresse sur
 * d'autres comptes sont supprimees.
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>, corps { email, code }.
 *
 * Reponses :
 *   200 { ok: true }                    adresse verifiee
 *   400 'demande'                       email ou code illisible (aucun essai compte)
 *   400 { erreur: 'code', restants }    code faux, essais restants
 *   401 'jeton'
 *   404 'aucun'                         pas de code en cours pour cette adresse sur ce compte
 *   409 'rattachee'                     l'adresse est prise par un autre compte entre-temps
 *   410 'expire'                        code expire (15 minutes)
 *   429 'epuise'                        5 essais faits : demander un nouveau code
 *   503 'config' | 'indisponible'
 * Logs : compte tronque, ref de l'adresse, issue. JAMAIS l'adresse ni le code.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const METHODES = 'POST, OPTIONS'

const STATUTS: Record<string, number> = {
  code: 400, aucun: 404, rattachee: 409, expire: 410, epuise: 429, config: 503, indisponible: 503,
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (erreur: string, status: number, extra?: Record<string, unknown>) => refusAcademie(erreur, status, headers, extra)

  let userId: string | null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[compte/emails] verification du jeton impossible : ${err instanceof Error ? err.name : 'erreur'}`)
    return refus('indisponible', 503)
  }
  if (!userId) return refus('jeton', 401)

  const corps = lireCorps(await req.text().catch(() => ''))
  const email = normaliserEmail(corps?.email)
  const code = lireCode(corps?.code)
  if (!email || !code) return refus('demande', 400)

  const r = await confirmerCode(userId, email, code)
  if (r.ok) return NextResponse.json({ ok: true }, { headers })
  if (r.erreur === 'code') return refus('code', 400, { restants: r.restants })
  return refus(r.erreur, STATUTS[r.erreur] ?? 503)
}
