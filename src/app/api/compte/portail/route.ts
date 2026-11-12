import { NextRequest, NextResponse } from 'next/server'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { messageErreur } from '@/lib/liveclub/pur'
import { abonnementsDuCompte, sessionPortail } from '@/lib/portail-abonnements'
import { clientDuMembre, lireClientDemande } from '@/lib/portail-abonnements-pur'

/**
 * /api/compte/portail : « Gérer mon abonnement » depuis Mon espace (site,
 * /mon-espace/parametres/achats ; correctif du 12/11/2026). Le portail client
 * Stripe du compte AOKnowledge : Carnet Premium, Pilotage Premium, Duo, soutien
 * (Carnet, Pilotage ou AOKnowledge). Le Live Club n'y est pas (compte Stripe de
 * Melanie) : il se gere depuis son bot Telegram, la page le dit.
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>. Le compte est
 * TOUJOURS celui du jeton.
 *
 * GET  : les abonnements en cours, ranges par client Stripe (un portail par
 *        client), lus a l'ouverture de la rubrique Achats :
 *        200 { ok: true, abonnements: [{ client: 'cus_...', abonnements: ['Pilotage Premium', ...] }], incomplet }
 *        `incomplet` : une source n'a pas pu se lire (la liste peut manquer un abonnement).
 * POST { client: 'cus_...' } : la session du portail pour CE client, s'il porte
 *        un abonnement du compte (relu ici, jamais cru sur parole) ; retour du
 *        portail sur Mon espace > Achats :
 *        200 { ok: true, url }   https://billing.stripe.com/... (courte duree)
 *
 * Refus : 400 'demande' | 401 'jeton' | 403 'abonnement' (pas un client de ce
 * compte) | 503 'portail' (Stripe ne l'ouvre pas, aucun lien de secours) |
 * 503 'indisponible'.
 * Logs : compte tronque. Jamais l'email, le client ni l'URL.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const METHODES = 'GET, POST, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

async function compte(req: NextRequest): Promise<string | null | 'indisponible'> {
  try {
    return await compteDuJeton(req)
  } catch (err) {
    console.warn(`[compte/portail] verification du jeton impossible : ${err instanceof Error ? err.name : 'erreur'}`)
    return 'indisponible'
  }
}

export async function GET(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const userId = await compte(req)
  if (userId === 'indisponible') return refusAcademie('indisponible', 503, headers)
  if (!userId) return refusAcademie('jeton', 401, headers)
  try {
    const r = await abonnementsDuCompte(userId)
    if (r.incomplet) console.log(`[compte/portail] ${tronquer(userId)} : lecture incomplete`)
    return NextResponse.json({ ok: true, abonnements: r.groupes, incomplet: r.incomplet }, { headers })
  } catch (err) {
    console.warn(`[compte/portail GET] ${tronquer(userId)} : ${messageErreur(err)}`)
    return refusAcademie('indisponible', 503, headers)
  }
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const userId = await compte(req)
  if (userId === 'indisponible') return refusAcademie('indisponible', 503, headers)
  if (!userId) return refusAcademie('jeton', 401, headers)

  const texte = await req.text().catch(() => '')
  let corps: unknown = null
  if (texte.length <= 500) {
    try { corps = JSON.parse(texte) } catch { corps = null }
  }
  const client = lireClientDemande(corps)
  if (!client) return refusAcademie('demande', 400, headers)

  try {
    const { groupes } = await abonnementsDuCompte(userId)
    if (!clientDuMembre(groupes, client)) {
      console.log(`[compte/portail] ${tronquer(userId)} : client hors du compte`)
      return refusAcademie('abonnement', 403, headers)
    }
    const url = await sessionPortail(client)
    if (!url) return refusAcademie('portail', 503, headers)
    return NextResponse.json({ ok: true, url }, { headers })
  } catch (err) {
    console.warn(`[compte/portail POST] ${tronquer(userId)} : ${messageErreur(err)}`)
    return refusAcademie('indisponible', 503, headers)
  }
}
