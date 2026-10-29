import { NextRequest, NextResponse } from 'next/server'
import { configPayPal, creerCommande, ErreurPayPal, prixClub, ventePubliqueClub } from '@/lib/academie/club-paypal'
import { decisionCommande, emailClub, montantAttendu, type Titulaire } from '@/lib/academie/club-paypal-pur'
import { roleAcademie } from '@/lib/academie/droits'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { estAdmin } from '@/lib/academie/pur'
import { messageErreur } from '@/lib/liveclub/pur'

/**
 * POST /api/club/paypal/commande : la commande PayPal (Orders v2) du 10% Club,
 * appelee par le createOrder des boutons PayPal de /club (29/10/2026). Route
 * PUBLIQUE : on peut payer sans compte, l'acces s'attache alors a l'email tape.
 *
 * Corps : { email?, renonciation: true, essai?: true }. Bearer facultatif :
 * connecte, le compte part en custom_id (u:<uuid>, lu dans le jeton, jamais
 * dans le corps) et l'email du corps est ignore ; sinon custom_id = e:<email>.
 * Le montant n'est jamais lu dans le corps : 1 EUR en essai, sinon le prix de
 * l'offre formation-complete en base (1 999 a defaut).
 * Tant que CLUB_PAYPAL_PUBLIC n'est pas a 1, seule une demande essai d'un
 * compte admin (profiles.role, estAdmin) passe. Ouverte, l'essai reste admin.
 *
 * 200 { ok, order_id }
 * 400 'corps' | 'renonciation' | 'email' | 401 'jeton' (essai sans compte)
 * 403 'ferme' | 'droit' | 503 'config' | 'indisponible' | 502 'paypal'
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req) })
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)

  let corps: Record<string, unknown>
  try { corps = (await req.json()) as Record<string, unknown> } catch { return refus('corps', 400) }
  if (!corps || typeof corps !== 'object') return refus('corps', 400)
  if (corps.renonciation !== true) return refus('renonciation', 400)
  const essai = corps.essai === true
  const ouvert = ventePubliqueClub()
  if (!ouvert && !essai) return refus('ferme', 403)

  const config = configPayPal()
  if (!config) {
    console.warn('[club/paypal/commande] config absente (PAYPAL_CLIENT_ID ou PAYPAL_CLIENT_SECRET)')
    return refus('config', 503)
  }

  // Le compte du jeton. Vente ouverte, un jeton illisible n'empeche pas
  // d'acheter avec l'email tape ; l'essai, lui, exige un admin sur.
  let userId: string | null = null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    if (essai) {
      console.warn(`[club/paypal/commande] jeton inverifiable (essai) : ${messageErreur(err)}`)
      return refus('indisponible', 503)
    }
    console.warn(`[club/paypal/commande] compte illisible, vente sans compte : ${messageErreur(err)}`)
  }

  let admin = false
  if (essai && userId) {
    try {
      admin = estAdmin(await roleAcademie(userId))
    } catch (err) {
      console.warn(`[club/paypal/commande] role illisible compte=${tronquer(userId)} : ${messageErreur(err)}`)
      return refus('indisponible', 503)
    }
  }
  const decision = decisionCommande({ ouvert, essai, connecte: !!userId, admin })
  if (decision === 'jeton') return refus('jeton', 401)
  if (decision === 'droit') {
    console.warn(`[club/paypal/commande] essai refuse (pas admin) compte=${userId ? tronquer(userId) : 'aucun'}`)
    return refus('droit', 403)
  }
  if (decision === 'ferme') return refus('ferme', 403)

  let titulaire: Titulaire
  if (userId) titulaire = { userId }
  else {
    const email = emailClub(corps.email)
    if (!email) return refus('email', 400)
    titulaire = { email }
  }

  let prixBase: number | null = null
  if (!essai) {
    try {
      prixBase = await prixClub()
    } catch (err) {
      console.warn(`[club/paypal/commande] base illisible : ${messageErreur(err)}`)
      return refus('indisponible', 503)
    }
    if (prixBase === null) console.warn('[club/paypal/commande] prix absent en base, 1 999 EUR par defaut')
  }
  const montantEur = montantAttendu({ essai, prixBase })

  try {
    const orderId = await creerCommande(config, { titulaire, montantEur, essai })
    console.info(`[club/paypal/commande] commande creee ${orderId} compte=${userId ? tronquer(userId) : 'email'} ${montantEur} EUR${essai ? ' essai' : ''}`)
    return NextResponse.json({ ok: true, order_id: orderId }, { headers })
  } catch (err) {
    if (err instanceof ErreurPayPal && (err.statut === 401 || err.statut === 403)) {
      console.warn(`[club/paypal/commande] identifiants PayPal refuses (${err.statut} ${err.issue})`)
      return refus('config', 503)
    }
    console.warn(`[club/paypal/commande] PayPal a refuse la commande : ${err instanceof ErreurPayPal ? err.message : messageErreur(err)}`)
    return refus('paypal', 502)
  }
}
