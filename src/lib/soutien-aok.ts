// Le soutien AOKnowledge cote serveur (11/11/2026, page aoknowledge.com/soutenir) :
// la cle Stripe, l'abonnement du compte relu chez Stripe. Regles pures :
// soutien-pur.ts (section « Le soutien AOKnowledge »).
//
// Cle : celle des sessions de soutien du Carnet (meme compte Ao Knowledge),
// STRIPE_CARNET_CHECKOUT_KEY_AOKNOWLEDGE, sinon celle de Pilotage. Elle doit
// avoir Checkout Sessions et Customer portal en ecriture, Customers et
// Subscriptions en lecture (la cle de Pilotage les a). Aucune variable neuve.

import { appeler, ErreurStripe } from '@/lib/academie/achat'
import { messageErreur } from '@/lib/liveclub/pur'
import { clePilotage } from '@/lib/pilotage-abonnement'
import { PRODUIT_SOUTIEN_AOK, lireAbonnementsApp, type AbonnementsApp } from '@/lib/soutien-pur'

export const cleSoutienAok = (): string | null => process.env.STRIPE_CARNET_CHECKOUT_KEY_AOKNOWLEDGE?.trim() || clePilotage()

// Cache par instance, par email : un soutien vu 5 min, une absence 1 min (le
// retour de Checkout doit voir le badge vite, meme sur une autre instance).
const CACHE_OUI_MS = 5 * 60 * 1000
const CACHE_NON_MS = 60 * 1000
const CACHE_MAX = 500
const cache = new Map<string, { vu: AbonnementsApp; expire: number }>()

export function oublierSoutienAok(email: string) {
  cache.delete(email.toLowerCase().trim())
}

const liste = (v: Record<string, unknown>): unknown[] => (Array.isArray(v.data) ? v.data : [])

/**
 * Le soutien AOK de l'email : un abonnement actif sur le produit « Soutien
 * AOKnowledge » (les clients de l'email exact, puis leurs abonnements). null =
 * cle absente ou Stripe illisible : on ne sait pas.
 */
export async function abonnementAokDe(email: string | null): Promise<AbonnementsApp | null> {
  const cle = cleSoutienAok()
  if (!cle || !email) return null
  const e = email.toLowerCase().trim()
  const enCache = cache.get(e)
  if (enCache && enCache.expire > Date.now()) return enCache.vu
  try {
    const clients = liste(await appeler(cle, `/v1/customers?email=${encodeURIComponent(e)}&limit=10`))
    let vu: AbonnementsApp = { actif: false, soutien: false, abonnement: null, client: null }
    for (const brut of clients) {
      const c = (brut ?? {}) as { id?: unknown; email?: unknown }
      if (typeof c.id !== 'string' || String(c.email ?? '').toLowerCase().trim() !== e) continue
      const subs = liste(await appeler(cle, `/v1/subscriptions?customer=${encodeURIComponent(c.id)}&limit=20`))
      const lu = lireAbonnementsApp(subs, PRODUIT_SOUTIEN_AOK)
      if (lu.actif) { vu = lu; break }
    }
    if (cache.size >= CACHE_MAX) cache.clear()
    cache.set(e, { vu, expire: Date.now() + (vu.actif ? CACHE_OUI_MS : CACHE_NON_MS) })
    return vu
  } catch (err) {
    console.warn(`[soutien/aok] abonnement illisible : ${err instanceof ErreurStripe ? err.message : messageErreur(err)}`)
    return null
  }
}
