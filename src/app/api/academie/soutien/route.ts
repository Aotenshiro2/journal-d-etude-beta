import { NextRequest, NextResponse } from 'next/server'
import { appeler, emailConfirme, ErreurStripe } from '@/lib/academie/achat'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { messageErreur } from '@/lib/liveclub/pur'
import { portailDuClient } from '@/lib/pilotage-abonnement'
import { abonnementAokDe, cleSoutienAok, oublierSoutienAok } from '@/lib/soutien-aok'
import { PAGE_SOUTIEN_AOK, sessionSoutienAok } from '@/lib/soutien-pur'

/**
 * /api/academie/soutien : la page aoknowledge.com/soutenir (11/11/2026, go de
 * Brice, brief soutien-mail-et-page-soutenir). Bearer du site, exige (le badge
 * « Soutien » se pose sur le compte) ; CORS de l'academie.
 *
 * GET : ce que la page montre au compte connecte.
 *   200 { ok, soutien, portail }
 *   soutien : un soutien AOKnowledge actif (true / false), null = Stripe illisible ;
 *   portail : le portail Stripe pour le gerer ou l'arreter (soutien actif seulement), sinon null.
 *   401 'jeton' | 503 'indisponible'
 *
 * POST { montant } : la session Checkout HEBERGEE (abonnement mensuel au produit
 * « Soutien AOKnowledge »), prix existant pour 5, 10, 20 EUR, sinon price_data
 * (2 a 200 EUR entiers). Marque soutien=aok sur la session et l'abonnement,
 * conditions a accepter, retour /mon-espace?soutien=aok. Regles :
 * sessionSoutienAok (soutien-pur.ts).
 *   200 { ok, url }   (checkout.stripe.com)
 *   400 'corps' | 'montant' | 401 'compte' | 409 'email' | 'deja'
 *   503 'config' | 'indisponible' | 502 'stripe'
 *
 * Cle : cleSoutienAok (soutien-aok.ts), celle des sessions de soutien du Carnet.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const METHODES = 'GET, POST, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

export async function GET(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  let userId: string | null
  try { userId = await compteDuJeton(req) } catch (err) {
    console.warn(`[academie/soutien] jeton illisible : ${messageErreur(err)}`)
    return refusAcademie('indisponible', 503, headers)
  }
  if (!userId) return refusAcademie('jeton', 401, headers)
  try {
    const ab = await abonnementAokDe(await emailConfirme(userId))
    const portail = ab?.actif ? await portailDuClient(cleSoutienAok(), ab.client, PAGE_SOUTIEN_AOK) : null
    return NextResponse.json({ ok: true, soutien: ab ? ab.actif : null, portail }, { headers })
  } catch (err) {
    console.warn(`[academie/soutien] etat illisible compte=${tronquer(userId)} : ${messageErreur(err)}`)
    return refusAcademie('indisponible', 503, headers)
  }
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  let corps: unknown
  try { corps = await req.json() } catch { return refusAcademie('corps', 400, headers) }
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return refusAcademie('corps', 400, headers)

  const cle = cleSoutienAok()
  const vu: { compte: { userId: string; email: string | null } | null } = { compte: null }
  try {
    const r = await sessionSoutienAok(corps, {
      compte: async () => {
        const userId = await compteDuJeton(req)
        vu.compte = userId ? { userId, email: await emailConfirme(userId) } : null
        return vu.compte
      },
      abonnement: email => abonnementAokDe(email),
      creerSession: async c => {
        if (!cle) throw new ErreurStripe(503, 'config', true)
        return appeler(cle, '/v1/checkout/sessions', c)
      },
    })
    if (r.corps.ok && vu.compte) {
      if (vu.compte.email) oublierSoutienAok(vu.compte.email) // le retour relira l'abonnement neuf
      console.info(`[academie/soutien] session creee compte=${tronquer(vu.compte.userId)}`)
    }
    return NextResponse.json(r.corps, { status: r.status, headers })
  } catch (err) {
    if (err instanceof ErreurStripe && (err.permission || err.statut === 401)) {
      console.warn(`[academie/soutien] cle Stripe absente ou sans la permission Checkout Sessions (${err.statut})`)
      return refusAcademie('config', 503, headers)
    }
    if (err instanceof ErreurStripe && err.conditions) {
      console.warn('[academie/soutien] Stripe exige une URL de conditions dans les reglages publics du compte (consent_collection)')
      return refusAcademie('config', 503, headers)
    }
    if (err instanceof ErreurStripe) {
      console.warn(`[academie/soutien] Stripe a refuse la session : ${err.message}`)
      return refusAcademie('stripe', 502, headers)
    }
    console.warn(`[academie/soutien] indisponible : ${messageErreur(err)}`)
    return refusAcademie('indisponible', 503, headers)
  }
}
