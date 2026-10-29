import { NextRequest, NextResponse } from 'next/server'
import { clePublique, emailConfirme, ErreurStripe } from '@/lib/academie/achat'
import { compteDuJeton, tronquer } from '@/lib/academie/http'
import { messageErreur } from '@/lib/liveclub/pur'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { creerSessionAbonnement, prixDesOffres, ventePubliquePilotage, clePilotage } from '@/lib/pilotage-abonnement'
import { estAdminPilotage } from '@/lib/pilotage-niveau'
import { offreDemandee, retourPilotage } from '@/lib/pilotage-paliers'

/**
 * POST /api/pilotage/achat : la session Stripe Embedded Checkout d'un
 * abonnement de Pilotage (brief E1, 30/10/2026), mode subscription, sur le
 * Stripe Ao Knowledge (memes cles que l'academie). Route PUBLIQUE
 * (middleware.ts) : on peut payer sans compte, Checkout demande l'email.
 *
 * Corps : { offre: 'premium-mensuel' | 'premium-annuel' | 'duo-mensuel' | 'duo-annuel', retour: '/offres', essai?: true }
 * Bearer facultatif : connecte, l'email confirme est prerempli et le compte
 * part en client_reference_id (lu dans le jeton, jamais dans le corps).
 * Retour : https://pilotage.aoknowledge.com/offres (ou http://localhost:3210/offres
 * selon l'origine) avec ?session_id=.
 * Tant que PILOTAGE_ACHAT_PUBLIC n'est pas a 1, seule une demande essai d'un
 * compte admin (profiles.role ou compte de l'equipe) passe : l'achat test de Brice.
 *
 * 200 { ok, client_secret, session_id, cle_publique }
 * 400 'corps' | 403 'ferme' | 503 'config' (cle absente, sans permission, prix pas crees) | 'indisponible' | 502 'stripe'
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const METHODES = 'POST, OPTIONS'

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

export async function POST(req: NextRequest) {
  const headers = { ...corsHeaders(req, METHODES), 'Cache-Control': 'no-store' }
  const refus = (erreur: string, status: number) => NextResponse.json({ ok: false, erreur }, { status, headers })

  let corps: Record<string, unknown>
  try { corps = (await req.json()) as Record<string, unknown> } catch { return refus('corps', 400) }
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return refus('corps', 400)
  const slug = offreDemandee(corps.offre)
  const retourUrl = retourPilotage(corps.retour, req.headers.get('origin'))
  if (!slug || !retourUrl) return refus('corps', 400)
  const essai = corps.essai === true

  // Un jeton refuse ou Supabase injoignable : on vend quand meme, sans compte (l'email de Checkout ouvrira le droit).
  let userId: string | null = null
  let email: string | null = null
  try {
    userId = await compteDuJeton(req)
    if (userId) email = await emailConfirme(userId)
  } catch (err) {
    console.warn(`[pilotage/achat] compte illisible, vente sans compte : ${messageErreur(err)}`)
    userId = null
    email = null
  }

  if (!ventePubliquePilotage()) {
    if (!essai || !userId) return refus('ferme', 403)
    let admin = false
    try { admin = await estAdminPilotage(userId) } catch (err) {
      console.warn(`[pilotage/achat] role illisible : ${messageErreur(err)}`)
      return refus('indisponible', 503)
    }
    if (!admin) return refus('ferme', 403)
  }

  const cle = clePilotage()
  const publique = clePublique()
  if (!cle || !publique) {
    console.warn(`[pilotage/achat] config absente (${!cle ? 'cle Checkout' : ''}${!cle && !publique ? ', ' : ''}${!publique ? 'cle publique' : ''})`)
    return refus('config', 503)
  }

  let prix: string | undefined
  try {
    prix = (await prixDesOffres()).get(slug)
  } catch (err) {
    console.warn(`[pilotage/achat] base illisible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!prix) {
    console.warn(`[pilotage/achat] prix Stripe absent pour ${slug} (scripts/creer-produits-stripe-pilotage.mjs pas lance, ou migration 20261031120000 pas appliquee)`)
    return refus('config', 503)
  }

  try {
    const s = await creerSessionAbonnement(cle, { slug, prix, retourUrl, userId, email, essai })
    console.info(`[pilotage/achat] session creee offre=${slug} compte=${userId ? tronquer(userId) : 'aucun'}${essai ? ' essai' : ''}`)
    return NextResponse.json({ ok: true, client_secret: s.clientSecret, session_id: s.id, cle_publique: publique }, { headers })
  } catch (err) {
    if (err instanceof ErreurStripe && (err.permission || err.statut === 401)) {
      console.warn(`[pilotage/achat] cle Stripe sans la permission Checkout Sessions (${err.statut})`)
      return refus('config', 503)
    }
    if (err instanceof ErreurStripe && err.conditions) {
      console.warn('[pilotage/achat] Stripe exige une URL de conditions dans les reglages publics du compte (consent_collection)')
      return refus('config', 503)
    }
    console.warn(`[pilotage/achat] Stripe a refuse la session offre=${slug} : ${err instanceof ErreurStripe ? err.message : messageErreur(err)}`)
    return refus('stripe', 502)
  }
}
