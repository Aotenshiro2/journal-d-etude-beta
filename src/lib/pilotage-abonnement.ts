// Les abonnements de Pilotage cote serveur (brief E1, 30/10/2026) : la session
// Stripe Embedded Checkout, le droit pose ou retire par email, le portail
// client. Les regles pures sont dans pilotage-paliers.ts.
//
// Meme compte Stripe (Ao Knowledge, Brice) et memes cles que la vente des
// modules de l'academie (academie/achat.ts) :
//   STRIPE_CHECKOUT_KEY_AOKNOWLEDGE      cle restreinte : Checkout Sessions en
//                                        ecriture, Subscriptions, Customers,
//                                        Invoices et Prices en lecture, Customer
//                                        portal en ecriture, Charges en
//                                        ecriture (libelle du paiement pour le
//                                        cockpit, facultatif) ;
//   STRIPE_PUBLISHABLE_KEY_AOKNOWLEDGE   cle publique rendue a la page ;
//   STRIPE_WEBHOOK_SECRET_PILOTAGE       secret du webhook /api/pilotage/achat/webhook ;
//   PILOTAGE_ACHAT_PUBLIC=1              ouvre la vente a tous (sinon : essai d'un compte admin seulement) ;
//   PILOTAGE_PORTAIL_LIEN                (facultatif) lien de connexion du portail client Stripe,
//                                        rendu quand la session du portail ne se cree pas.
//
// Le droit : une ligne academie_acces par abonnement (reference = sub_...,
// fin = fin de la periode payee + 3 jours, cote brice), mise a jour a chaque
// evenement en relisant l'abonnement chez Stripe (jamais l'evenement seul).

import { prisma } from '@/lib/db'
import { appeler, ErreurStripe } from '@/lib/academie/achat'
import { messageErreur } from '@/lib/liveclub/pur'
import {
  CATALOGUE, SITE_PILOTAGE, SLUGS_OFFRES_PILOTAGE, chargeDesPaiements, corpsSessionAbonnement, estSlugPilotage, lireAbonnement, produitDe,
  type ProduitPilotage, type SlugOffrePilotage,
} from '@/lib/pilotage-paliers'
import {
  SQL_ABONNEMENTS_DU_MEMBRE, SQL_FERMER_ABONNEMENT, SQL_POSER_ABONNEMENT, SQL_PRIX, SQL_RETIRER_ABONNEMENT,
} from '@/lib/pilotage-requetes'

export const ventePubliquePilotage = () => process.env.PILOTAGE_ACHAT_PUBLIC?.trim() === '1'
export const secretWebhookPilotage = () => process.env.STRIPE_WEBHOOK_SECRET_PILOTAGE?.trim() || null

// ---------------------------------------------------------------------------
// Les offres et la session
// ---------------------------------------------------------------------------

/** Les prix Stripe connus en base, par slug. */
export async function prixDesOffres(): Promise<Map<SlugOffrePilotage, string>> {
  const lignes = await prisma.$queryRawUnsafe<{ slug: string; stripe_price_id: string | null }[]>(SQL_PRIX, [...SLUGS_OFFRES_PILOTAGE])
  const m = new Map<SlugOffrePilotage, string>()
  for (const l of lignes) if (estSlugPilotage(l.slug) && l.stripe_price_id) m.set(l.slug, l.stripe_price_id)
  return m
}

export async function creerSessionAbonnement(cle: string, p: {
  slug: SlugOffrePilotage; prix: string; retourUrl: string; userId: string | null; email: string | null; essai: boolean
}): Promise<{ id: string; clientSecret: string }> {
  const s = await appeler(cle, '/v1/checkout/sessions', corpsSessionAbonnement(p))
  if (typeof s.id !== 'string' || typeof s.client_secret !== 'string') throw new ErreurStripe(502, 'reponse', false)
  return { id: s.id, clientSecret: s.client_secret }
}

export async function lireSessionCheckout(cle: string, id: string): Promise<Record<string, unknown>> {
  return appeler(cle, `/v1/checkout/sessions/${encodeURIComponent(id)}`)
}

// ---------------------------------------------------------------------------
// Le droit : relire l'abonnement chez Stripe, puis poser, fermer ou retirer
// ---------------------------------------------------------------------------

export type Synchro =
  | { ok: true; etat: 'ouvert'; slug: SlugOffrePilotage; cree: boolean; userId: string | null; email: string | null; essai: boolean }
  | { ok: true; etat: 'ferme' | 'retire'; slug: SlugOffrePilotage }
  | { ok: false; raison: 'pas_pilotage' | 'incomplet' | 'offre_inconnue' }

/** La charge de la facture (invoice_payments), ou null. Sans la permission Invoices, null. */
async function chargeDeFacture(cle: string, facture: string): Promise<string | null> {
  try {
    const l = await appeler(cle, `/v1/invoice_payments?invoice=${encodeURIComponent(facture)}&limit=5&expand[]=data.payment.payment_intent`)
    return chargeDesPaiements(l.data)
  } catch (err) {
    console.warn(`[pilotage/achat] charge de la facture illisible : ${err instanceof ErreurStripe ? err.message : messageErreur(err)}`)
    return null
  }
}

/**
 * Le libelle du paiement : une charge d'abonnement arrive chez Stripe avec
 * « Subscription creation », que la collecte du cockpit ne sait pas classer.
 * On y ecrit « Pilotage Premium : ... » (MOTIFS_OFFRES de
 * push_membres_supabase.py). Sans la permission Charges en ecriture : un
 * avertissement, le droit est pose quand meme.
 */
async function nommerPaiement(cle: string, charge: string, slug: SlugOffrePilotage): Promise<void> {
  if (!charge.startsWith('ch_')) return
  try {
    await appeler(cle, `/v1/charges/${encodeURIComponent(charge)}`, new URLSearchParams({ description: CATALOGUE[slug].libellePaiement }))
  } catch (err) {
    console.warn(`[pilotage/achat] libelle du paiement non pose : ${err instanceof ErreurStripe ? err.message : messageErreur(err)}`)
  }
}

/**
 * Relit l'abonnement chez Stripe et ecrit le droit. `extra` : ce que la
 * session Checkout sait (compte, email du paiement, case de retractation).
 * Idempotent : la confirmation de la page et le webhook ecrivent la meme ligne.
 */
export async function synchroniserAbonnement(cle: string, abonnementId: string, extra: {
  userId?: string | null; email?: string | null; essai?: boolean; renonciationLe?: Date | null
} = {}): Promise<Synchro> {
  const [brut, prix] = await Promise.all([
    appeler(cle, `/v1/subscriptions/${encodeURIComponent(abonnementId)}?expand[]=customer`),
    prixDesOffres(),
  ])
  const parPrix = new Map([...prix].map(([slug, p]) => [p, slug]))
  const ab = lireAbonnement(brut, p => parPrix.get(p) ?? null)
  if (!ab || !ab.offre) return { ok: false, raison: 'pas_pilotage' }

  if (ab.statut === 'canceled' || ab.statut === 'incomplete_expired') {
    await prisma.$queryRawUnsafe(SQL_RETIRER_ABONNEMENT, ab.id)
    return { ok: true, etat: 'retire', slug: ab.offre }
  }
  if (!ab.actif || !ab.fin) {
    await prisma.$executeRawUnsafe(SQL_FERMER_ABONNEMENT, ab.id)
    return { ok: true, etat: 'ferme', slug: ab.offre }
  }

  const userId = extra.userId ?? ab.userId
  const email = extra.email ?? ab.clientEmail
  if (!userId && !email) return { ok: false, raison: 'incomplet' }
  const essai = extra.essai ?? ab.essai
  const charge = ab.facture ? await chargeDeFacture(cle, ab.facture) : null
  const l = (await prisma.$queryRawUnsafe<{ offre_connue: number; cree: number; ecrit: number }[]>(
    SQL_POSER_ABONNEMENT,
    userId, email, ab.offre, ab.id, CATALOGUE[ab.offre].centimes / 100, ab.fin, extra.renonciationLe ?? null,
    essai ? 'Abonnement test (?achat=essai), avant ouverture publique' : null,
    charge ? `stripe:${charge}` : null,
  ))[0]
  if (!l || l.offre_connue === 0) return { ok: false, raison: 'offre_inconnue' }
  if (charge) await nommerPaiement(cle, charge, ab.offre)
  return { ok: true, etat: 'ouvert', slug: ab.offre, cree: l.cree > 0, userId, email, essai }
}

// ---------------------------------------------------------------------------
// Le membre : ses abonnements, le portail
// ---------------------------------------------------------------------------

export type AbonnementActif = { slug: SlugOffrePilotage; produit: ProduitPilotage; reference: string | null }

/** Les abonnements Pilotage actifs du compte (par uuid ou email verifie). */
export async function abonnementsDuMembre(userId: string, emails: string[]): Promise<AbonnementActif[]> {
  const lignes = await prisma.$queryRawUnsafe<{ slug: string; reference: string | null }[]>(
    SQL_ABONNEMENTS_DU_MEMBRE, userId, emails, [...SLUGS_OFFRES_PILOTAGE],
  )
  return lignes.flatMap(l => (estSlugPilotage(l.slug) ? [{ slug: l.slug, produit: produitDe(l.slug), reference: l.reference }] : []))
}

/**
 * L'URL du portail client Stripe pour l'abonnement (gerer, changer, arreter),
 * de retour sur /offres. Session creee a la demande (URL de courte duree) ;
 * si elle ne se cree pas, PILOTAGE_PORTAIL_LIEN (lien de connexion du portail
 * configure chez Stripe), sinon null.
 */
export async function portailDe(cle: string | null, reference: string | null): Promise<string | null> {
  const lien = process.env.PILOTAGE_PORTAIL_LIEN?.trim()
  const secours = lien && /^https:\/\/billing\.stripe\.com\//.test(lien) ? lien : null
  if (!cle || !reference?.startsWith('sub_')) return secours
  try {
    const ab = await appeler(cle, `/v1/subscriptions/${encodeURIComponent(reference)}`)
    const client = typeof ab.customer === 'string' ? ab.customer : null
    if (!client) return secours
    const s = await appeler(cle, '/v1/billing_portal/sessions', new URLSearchParams({ customer: client, return_url: `${SITE_PILOTAGE}/offres`, locale: 'fr' }))
    return typeof s.url === 'string' ? s.url : secours
  } catch (err) {
    console.warn(`[pilotage/niveau] portail indisponible : ${err instanceof ErreurStripe ? err.message : messageErreur(err)}`)
    return secours
  }
}
