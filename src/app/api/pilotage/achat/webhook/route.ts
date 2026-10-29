import { NextRequest, NextResponse } from 'next/server'
import { verifierSignature } from '@/lib/academie/achat-pur'
import { messageErreur } from '@/lib/liveclub/pur'
import { lireSessionCheckout, secretWebhookPilotage, synchroniserAbonnement, clePilotage } from '@/lib/pilotage-abonnement'
import { abonnementDeFacture, estAbonnementId, estSessionId, lireSessionPilotage } from '@/lib/pilotage-paliers'
import { mailAchatCarnet, mailAchatPilotage } from '@/lib/mails-achat'
import { evenementEnvoieMail } from '@/lib/mails-achat-pur'

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
 *
 * Mails d'achat (brief F1, 30/10/2026, mails-achat.ts) : checkout.session.completed
 * SEULEMENT (jamais un renouvellement), une fois par abonnement (anti-doublon
 * en base). Le point d'acces recoit les sessions de tout le compte : une
 * session d'abonnement sans metadata source dont l'abonnement porte le produit
 * du Carnet Premium (liens de paiement) envoie le mail du Carnet, sans toucher
 * aux droits. Un mail rate ne fait jamais echouer le webhook.
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
    let session: Record<string, unknown> | null = null
    if (type === 'checkout.session.completed') {
      const meta = (objet.metadata ?? {}) as Record<string, unknown>
      if (!estSessionId(objet.id)) return NextResponse.json({ ok: true, ignore: true })
      if (meta.source !== 'pilotage') {
        // Hors Pilotage : peut-etre un Carnet Premium (mail seulement, aucun droit ecrit).
        if (objet.mode !== 'subscription' || meta.source) return NextResponse.json({ ok: true, ignore: true })
        const mail = await mailAchatCarnet(cle, await lireSessionCheckout(cle, objet.id))
        return NextResponse.json({ ok: true, ignore: mail === 'pas_concerne', mail })
      }
      session = await lireSessionCheckout(cle, objet.id)
      const lu = lireSessionPilotage(session)
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
    if (r.etat === 'ouvert' && session && evenementEnvoieMail(type)) {
      const mail = await mailAchatPilotage({ session, abonnementId: abonnement, slug: r.slug, email: r.email, essai: r.essai, fin: r.fin })
      return NextResponse.json({ ok: true, etat: r.etat, mail })
    }
    return NextResponse.json({ ok: true, etat: r.etat })
  } catch (err) {
    console.warn(`[pilotage/achat/webhook] ${type} NON traite : ${messageErreur(err)}`)
    return NextResponse.json({ ok: false, erreur: 'indisponible' }, { status: 500 })
  }
}
