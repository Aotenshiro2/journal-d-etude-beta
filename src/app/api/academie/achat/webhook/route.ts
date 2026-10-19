import { NextRequest, NextResponse } from 'next/server'
import { cleAchat, enregistrerAchat, lireSession, retirerRembourse, secretWebhook } from '@/lib/academie/achat'
import { estSessionId, verifierSignature } from '@/lib/academie/achat-pur'
import { messageErreur } from '@/lib/liveclub/pur'

/**
 * POST /api/academie/achat/webhook : le webhook Stripe Ao Knowledge de la
 * vente a l'unite (19/10/2026). Route PUBLIQUE, signature verifiee
 * (STRIPE_WEBHOOK_SECRET_ACADEMIE, 5 min de tolerance).
 *
 * Evenements :
 *   checkout.session.completed, checkout.session.async_payment_succeeded :
 *     pose l'acces (filet de la confirmation de la page, meme ligne, une seule fois) ;
 *   charge.refunded : remboursement total = acces retire (retire_le, rien ne s'efface).
 * Les sessions hors academie sont ignorees (200). 500 = Stripe renvoie plus tard.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_CORPS = 512 * 1024

export async function POST(req: NextRequest) {
  const secret = secretWebhook()
  const cle = cleAchat()
  if (!secret || !cle) {
    console.warn('[academie/achat/webhook] secret ou cle absents')
    return NextResponse.json({ ok: false, erreur: 'config' }, { status: 503 })
  }
  const corps = await req.text()
  if (corps.length > MAX_CORPS || !verifierSignature(corps, req.headers.get('stripe-signature'), secret)) {
    return NextResponse.json({ ok: false, erreur: 'signature' }, { status: 400 })
  }

  let evenement: { type?: unknown; data?: { object?: Record<string, unknown> } }
  try { evenement = JSON.parse(corps) } catch { return NextResponse.json({ ok: false, erreur: 'corps' }, { status: 400 }) }
  const objet = evenement.data?.object ?? {}

  try {
    if (evenement.type === 'checkout.session.completed' || evenement.type === 'checkout.session.async_payment_succeeded') {
      const meta = (objet.metadata ?? {}) as Record<string, unknown>
      if (meta.source !== 'academie' || !estSessionId(objet.id)) return NextResponse.json({ ok: true, ignore: true })
      // Relue chez Stripe : l'etat de paiement le plus frais, et la charge.
      const r = await enregistrerAchat(await lireSession(cle, objet.id))
      if (!r.ok && r.raison === 'offre_inconnue') throw new Error('offre inconnue en base')
      if (r.ok && r.cree) console.info(`[academie/achat/webhook] acces pose module=${r.achat.moduleSlug}${r.achat.essai ? ' essai' : ''}`)
      return NextResponse.json({ ok: true, etat: r.ok ? 'ouvert' : r.raison })
    }
    if (evenement.type === 'charge.refunded') {
      const n = await retirerRembourse(cle, objet)
      if (n) console.info(`[academie/achat/webhook] remboursement : ${n} acces retire(s)`)
      return NextResponse.json({ ok: true, retires: n })
    }
    return NextResponse.json({ ok: true, ignore: true })
  } catch (err) {
    console.warn(`[academie/achat/webhook] ${String(evenement.type)} NON traite : ${messageErreur(err)}`)
    return NextResponse.json({ ok: false, erreur: 'indisponible' }, { status: 500 })
  }
}
