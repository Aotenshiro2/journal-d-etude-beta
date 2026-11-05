import { NextRequest, NextResponse } from 'next/server'
import { verifierSignature } from '@/lib/academie/achat-pur'
import { reouvertureApresPaiement } from '@/lib/liveclub/passage'
import { lireFacturePayee } from '@/lib/liveclub/reouverture-stripe-pur'
import { lireFactureFilleul, lireRemboursement } from '@/lib/liveclub/parrainage-pur'
import { parrainageApresPaiement, parrainageApresRemboursement } from '@/lib/liveclub/parrainage'
import { messageErreur } from '@/lib/liveclub/pur'

/**
 * POST /api/liveclub/stripe : webhook Stripe du compte de Melanie (Live Club),
 * PRET, PAS BRANCHE (Brice, 22/10/2026). Route PUBLIQUE (middleware.ts),
 * signature verifiee (STRIPE_WEBHOOK_SECRET_LIVECLUB, 5 min de tolerance).
 * Sans la variable : 503, rien ne se passe. Ce qu'il faut creer chez Stripe :
 * voir src/lib/liveclub/reouverture-stripe-pur.ts.
 *
 * Evenement : invoice.paid d'une facture d'abonnement. Deux traitements
 * independants, chacun une seule fois quel que soit le nombre d'envois :
 * - la reouverture apres un impaye : les comptes Telegram rattaches a ce client
 *   (ou a l'email de la facture), sortis pour impaye et pas encore revenus,
 *   recoivent la reouverture du passage quotidien (reouvertureApresPaiement,
 *   passage.ts : ban leve, lien en prive, sinon lien personnel vers le bot par
 *   email), une seule fois par reouverture ;
 * - (05/11) le PARRAINAGE : la premiere facture d'un abonnement payee avec le
 *   code promo d'un membre (parrainage.ts) note le filleul et sa commission et
 *   previent le parrain, une seule fois par abonnement ;
 * - (05/11) charge.refunded : les filleuls de ce client dont le premier
 *   paiement est rembourse en entier sont annules (parrainage.ts). A AJOUTER
 *   chez Stripe a la destination du webhook le jour ou elle est creee.
 * Tout autre evenement : 200, ignore. 500 = Stripe renvoie plus tard (et le
 * passage du lendemain matin reste le filet des deux). Jamais d'email ni
 * d'identifiant dans un log : des comptes seulement.
 */

export const dynamic = 'force-dynamic'
// Une reouverture : quelques appels Telegram et Stripe par compte.
export const maxDuration = 60

const MAX_CORPS = 512 * 1024

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET_LIVECLUB?.trim()
  if (!secret) {
    console.warn('[liveclub/stripe] STRIPE_WEBHOOK_SECRET_LIVECLUB absent : webhook non branche')
    return NextResponse.json({ ok: false, erreur: 'config' }, { status: 503 })
  }
  const corps = await req.text()
  if (corps.length > MAX_CORPS || !verifierSignature(corps, req.headers.get('stripe-signature'), secret)) {
    return NextResponse.json({ ok: false, erreur: 'signature' }, { status: 400 })
  }
  let evenement: unknown
  try { evenement = JSON.parse(corps) } catch { return NextResponse.json({ ok: false, erreur: 'corps' }, { status: 400 }) }

  const facture = lireFacturePayee(evenement)
  // (05/11) Un premier paiement avec une remise : peut-etre un filleul (aucun appel tant que ce n'est pas le cas).
  const filleulPossible = lireFactureFilleul(evenement) !== null
  // (05/11) Un remboursement (charge.refunded) : les filleuls de ce client relus (commission annulee).
  const remboursement = lireRemboursement(evenement)
  if (!facture && !filleulPossible && !remboursement) return NextResponse.json({ ok: true, ignore: true })

  let panne = false
  const reponse: Record<string, unknown> = { ok: true }

  if (facture) {
    try {
      const s = await reouvertureApresPaiement(facture.client, facture.email)
      const r = s.reouvertures
      if (r.liens_prives || r.emails || r.echecs || s.erreurs.length) {
        console.info(`[liveclub/stripe] reouverture : ${JSON.stringify({ comptes: s.comptes, ...r, erreurs: s.erreurs })}`)
      }
      // Une panne de lecture (rattachements, Stripe, journal) : Stripe renvoie
      // plus tard ; la reservation empeche un double envoi au rejeu.
      const PANNES = ['rattachements_illisibles', 'stripe_illisible', 'reouvertures_illisibles', 'factures_payees_illisibles', 'reouvertures_interrompu']
      if (s.erreurs.some(e => PANNES.includes(e))) panne = true
      Object.assign(reponse, { comptes: s.comptes, liens_prives: r.liens_prives, emails: r.emails })
    } catch (err) {
      console.warn(`[liveclub/stripe] invoice.paid NON traite : ${messageErreur(err)}`)
      panne = true
    }
  }

  if (filleulPossible) {
    // Ne jette pas. Table absente (migration pas passee) : rien, sans 500
    // (sinon Stripe rejouerait pendant des jours pour rien).
    const p = await parrainageApresPaiement(evenement)
    if (p.etat === 'panne') panne = true
    reponse.parrainage = p.issue ?? p.etat
  }

  if (remboursement) {
    const r = await parrainageApresRemboursement(evenement)
    if (r.etat === 'panne') panne = true
    reponse.filleuls_annules = r.annulees
  }

  if (panne) return NextResponse.json({ ok: false, erreur: 'indisponible' }, { status: 500 })
  return NextResponse.json(reponse)
}
