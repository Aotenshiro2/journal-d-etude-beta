// Droits d'accès au mode mentorat (décision Brice 28/08) : réservé aux
// membres — Live Club actif, Skool premium ou vip, ou accès accordé à la main
// (anciens formats « tout inclus », cas particuliers). Un simple inscrit
// newsletter n'y a pas droit.
//
// Source de vérité : les tables cockpit_* du même Postgres, alimentées chaque
// matin par AOK-Push-Membres (Stripe Mélanie + Skool). cockpit_membre_emails
// rattache TOUS les emails connus d'un membre : un élève connecté au journal
// avec son deuxième email est quand même reconnu. Le backend décide, jamais
// l'extension.
import { prisma } from './db'

export type MentoratReason = 'manuel' | 'liveclub' | 'skool-vip' | 'skool-premium' | 'carnet-premium'

// Le produit « Carnet Premium » (5,99 €/mois) sur le Stripe aoknowledge —
// créé le 28/08/2026. La vérification en direct donne l'accès IMMÉDIAT après
// paiement, sans attendre la synchro cockpit du lendemain matin.
const CARNET_PREMIUM_PRODUCT = 'prod_V9jniZCCbIJsmV'

async function hasCarnetPremium(email: string): Promise<boolean> {
  const key = process.env.STRIPE_KEY_CARNET
  if (!key) return false // clé absente : les autres voies d'accès suffisent
  try {
    const headers = { Authorization: `Bearer ${key}` }
    const custRes = await fetch(
      `https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=10`,
      { headers }
    )
    if (!custRes.ok) return false
    const customers: { id: string }[] = (await custRes.json()).data ?? []
    for (const c of customers) {
      const subRes = await fetch(
        `https://api.stripe.com/v1/subscriptions?customer=${c.id}&limit=20`,
        { headers }
      )
      if (!subRes.ok) continue
      const subs: { status: string; items: { data: { price: { product: string } }[] } }[] =
        (await subRes.json()).data ?? []
      for (const s of subs) {
        if (
          (s.status === 'active' || s.status === 'trialing' || s.status === 'past_due') &&
          s.items.data.some(i => i.price.product === CARNET_PREMIUM_PRODUCT)
        ) {
          return true
        }
      }
    }
  } catch (err) {
    console.error('[entitlements] Stripe carnet-premium check failed:', err)
  }
  return false
}

export interface MentoratAccess {
  entitled: boolean
  reason: MentoratReason | null
  email: string | null
}

export async function checkMentoratAccess(userId: string): Promise<MentoratAccess> {
  // L'email du compte connecté (Supabase Auth, même base)
  const users = await prisma.$queryRaw<{ email: string | null }[]>`
    select email from auth.users where id = ${userId}::uuid limit 1
  `
  const email = users[0]?.email?.toLowerCase().trim() ?? null
  if (!email) return { entitled: false, reason: null, email: null }

  // 1. Accès accordé à la main (prioritaire : couvre les cas hors cockpit)
  const grant = await prisma.mentoratGrant.findFirst({
    where: { email, revokedAt: null },
  })
  if (grant) return { entitled: true, reason: 'manuel', email }

  // 2. Droits automatiques via le cockpit, par n'importe lequel de ses emails
  const rows = await prisma.$queryRaw<{ tier_skool: string | null; abonnement_en_cours: boolean | null }[]>`
    select e.tier_skool, e.abonnement_en_cours
    from cockpit_membre_emails me
    join cockpit_membres_etat e on e.membre_id = me.membre_id
    where lower(me.email) = ${email}
    limit 1
  `
  const m = rows[0]
  if (m) {
    if (m.abonnement_en_cours) return { entitled: true, reason: 'liveclub', email }
    if (m.tier_skool === 'vip') return { entitled: true, reason: 'skool-vip', email }
    if (m.tier_skool === 'premium') return { entitled: true, reason: 'skool-premium', email }
  }

  // 3. Abonnement Carnet Premium (Stripe aoknowledge, vérif en direct :
  // l'accès s'ouvre dans la minute qui suit le paiement)
  if (await hasCarnetPremium(email)) {
    return { entitled: true, reason: 'carnet-premium', email }
  }

  return { entitled: false, reason: null, email }
}
