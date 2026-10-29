import { NextRequest, NextResponse } from 'next/server'
import { verifierSignature } from '@/lib/academie/achat-pur'
import { messageErreur } from '@/lib/liveclub/pur'
import { lireSessionCheckout, secretWebhookPilotage, synchroniserAbonnement, clePilotage } from '@/lib/pilotage-abonnement'
import { abonnementDeFacture, estAbonnementId, estSessionId, lireSessionPilotage } from '@/lib/pilotage-paliers'

/**
 * POST /api/pilotage/achat/webhook : le webhook Stripe Ao Knowledge des
 * abonnements de Pilotage (brief E1, 30/10/2026). Route PUBLIQUE, signature
 * verifiee (STRIPE_WEBHOOK_SECRET_PILOTAGE, 5 min de tolerance). Le Carnet
 * Premium n'a pas de webhook (verification en direct, entitlements.ts) :
 * celui-ci est nouveau, a declarer chez Stripe avec ces quatre evenements.
 *
 * Evenements (l'abonnement est TOUJOURS relu chez Stripe) :
 *   checkout.session.completed : pose le droit (filet de la confirmation de la page) ;
 *   invoice.paid : renouvellement, la fin du droit avance ;
 *   customer.subscription.updated : changement d'offre, impaye (droit ferme), reprise ;
 *   customer.subscription.deleted : droit retire (retire_le, rien ne s'efface).
 * Ce qui n'est pas un abonnement de Pilotage est ignore (200). 500 = Stripe renvoie plus tard.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_CORPS = 512 * 1024

export async function POST(req: NextRequest) {
  const secret = secretWebhookPilotage()
  const cle = clePilotage()
  if (!secret || !cle) {
    console.warn('[pilotage/achat/webhook] secret ou cle absents')
    return NextResponse.json({ ok: false, erreur: 'config' }, { status: 503 })
  }
  const corps = await req.text()
  if (corps.length > MAX_CORPS || !verifierSignature(corps, req.headers.get('stripe-signature'), secret)) {
    return NextResponse.json({ ok: false, erreur: 'signature' }, { status: 400 })
  }

  let evenement: { type?: unknown; data?: { object?: Record<string, unknown> } }
  try { evenement = JSON.parse(corps) } catch { return NextResponse.json({ ok: false, erreur: 'corps' }, { status: 400 }) }
  const objet = evenement.data?.object ?? {}
  const type = String(evenement.type)

  try {
    let abonnement: string | null = null
    let extra: Parameters<typeof synchroniserAbonnement>[2] = {}
    if (type === 'checkout.session.completed') {
      const meta = (objet.metadata ?? {}) as Record<string, unknown>
      if (meta.source !== 'pilotage' || !estSessionId(objet.id)) return NextResponse.json({ ok: true, ignore: true })
      const lu = lireSessionPilotage(await lireSessionCheckout(cle, objet.id))
      if (!lu.ok) return NextResponse.json({ ok: true, etat: lu.raison })
      abonnement = lu.abonnementId
      extra = { userId: lu.userId, email: lu.email, essai: lu.essai, renonciationLe: lu.renonciationLe }
    } else if (type === 'invoice.paid') {
      abonnement = abonnementDeFacture(objet)
    } else if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
      abonnement = estAbonnementId(objet.id) ? objet.id : null
    } else {
      return NextResponse.json({ ok: true, ignore: true })
    }
    if (!abonnement) return NextResponse.json({ ok: true, ignore: true })

    const r = await synchroniserAbonnement(cle, abonnement, extra)
    if (!r.ok && r.raison === 'offre_inconnue') throw new Error('offre inconnue en base')
    if (!r.ok) return NextResponse.json({ ok: true, ignore: r.raison === 'pas_pilotage', etat: r.raison })
    if (r.etat !== 'ouvert' || r.cree) console.info(`[pilotage/achat/webhook] ${type} : droit ${r.etat} offre=${r.slug}`)
    return NextResponse.json({ ok: true, etat: r.etat })
  } catch (err) {
    console.warn(`[pilotage/achat/webhook] ${type} NON traite : ${messageErreur(err)}`)
    return NextResponse.json({ ok: false, erreur: 'indisponible' }, { status: 500 })
  }
}
