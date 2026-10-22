// Reouverture par webhook Stripe apres un impaye (Brice, 22/10/2026) :
// PRETE, PAS BRANCHEE. Regles PURES (aucun import), testees par
// scripts/verifier-reouverture-impaye.mjs.
//
// Aujourd'hui, la reouverture apres une facture payee passe par le bouton
// « J'ai réglé : revenir dans le groupe » du message de sortie (bot-membre.ts)
// ou par le passage du lendemain matin. Pour la rendre automatique, la route
// POST /api/liveclub/stripe recoit invoice.paid du compte Stripe de Melanie
// et lance la reouverture du passage pour CE client (reouvertureApresPaiement,
// passage.ts). A creer chez Stripe (compte melanie), le jour ou Brice le
// decide :
//   - Developpeurs, Webhooks, « Ajouter une destination » : evenement
//     invoice.paid seulement, URL https://journal.aoknowledge.com/api/liveclub/stripe ;
//   - son secret de signature (whsec_...) dans Vercel, projet journal,
//     production : STRIPE_WEBHOOK_SECRET_LIVECLUB, puis redeployer.
// Sans la variable, la route repond 503 et ne fait rien.

/** Le seul evenement ecoute. */
export const EVENEMENT_REOUVERTURE = 'invoice.paid'

export type FacturePayeeLue = {
  /** Le client Stripe (cus_...) du compte melanie. */
  client: string
  /** L'email de la facture (customer_email), pour retrouver un compte rattache par son email. */
  email: string | null
  /** L'abonnement de la facture (sub_...), null pour une facture hors abonnement. */
  abonnement: string | null
}

const CLIENT = /^cus_[A-Za-z0-9]{6,64}$/
const ABONNEMENT = /^sub_[A-Za-z0-9]{6,64}$/

function texte(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Lit un evenement Stripe deja verifie (signature) : une facture payee d'un
 * abonnement, avec son client. null = rien a faire (autre evenement, facture
 * non payee, sans client, ou hors abonnement : un achat ponctuel ne rouvre pas
 * le Live Club). L'abonnement est lu aux deux endroits que Stripe a utilises :
 * invoice.subscription (versions d'API d'avant 2025-03), puis
 * invoice.parent.subscription_details.subscription.
 */
export function lireFacturePayee(evenement: unknown): FacturePayeeLue | null {
  if (!evenement || typeof evenement !== 'object') return null
  const e = evenement as { type?: unknown; data?: { object?: unknown } }
  if (e.type !== EVENEMENT_REOUVERTURE) return null
  const o = e.data?.object
  if (!o || typeof o !== 'object') return null
  const f = o as {
    object?: unknown; status?: unknown; customer?: unknown; customer_email?: unknown; subscription?: unknown
    parent?: { subscription_details?: { subscription?: unknown } | null } | null
  }
  if (f.object !== 'invoice' || f.status !== 'paid') return null
  const client = texte(f.customer)
  if (!client || !CLIENT.test(client)) return null
  const sub = texte(f.subscription) ?? texte(f.parent?.subscription_details?.subscription)
  const abonnement = sub && ABONNEMENT.test(sub) ? sub : null
  if (!abonnement) return null
  const email = texte(f.customer_email)
  return { client, email: email ? email.toLowerCase() : null, abonnement }
}
