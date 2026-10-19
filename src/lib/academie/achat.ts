// La vente a l'unite des modules de l'academie : Stripe Ao Knowledge et
// l'ecriture de l'acces (19/10/2026). Regles pures : achat-pur.ts.
//
// Variables (journal, Vercel) :
//   STRIPE_CHECKOUT_KEY_AOKNOWLEDGE   cle restreinte du compte Ao Knowledge,
//                                     Checkout Sessions en ecriture et
//                                     PaymentIntents en lecture. A defaut,
//                                     STRIPE_AGENT_KEY_AOKNOWLEDGE est essayee
//                                     (sans la permission, Stripe repond 403
//                                     et la route rend 503 'config').
//   STRIPE_PUBLISHABLE_KEY_AOKNOWLEDGE  cle publique (pk_live_...), rendue a la
//                                     page pour monter le formulaire Stripe.
//   STRIPE_WEBHOOK_SECRET_ACADEMIE    secret de signature du webhook
//                                     /api/academie/achat/webhook (whsec_...).
//   ACADEMIE_ACHAT_PUBLIC=1           ouvre la vente a tous. Sans elle, seule
//                                     une demande « essai » (page ouverte avec
//                                     ?achat=essai) cree une session.
//
// Une session payee ouvre l'offre « module-<slug> » par academie_acces
// (source stripe, reference = cs_..., paiement_id = stripe:ch_..., cote
// brice). droitsAcademie la retrouve par user_id ou par l'email verifie du
// compte : rien d'autre a invalider (aucun cache sur les acces).

import { prisma } from '@/lib/db'
import { oublierDroitsDuCompte } from '@/lib/trouver-cours'
import { corpsSession, lireAchat, type AchatLu, type LectureAchat, type OffreEnVente } from './achat-pur'
import {
  SQL_COMPLETER_PAIEMENT, SQL_COMPTES_DE_EMAIL, SQL_EMAIL_CONFIRME, SQL_OFFRE_EN_VENTE, SQL_POSER_ACHAT, SQL_RETIRER_REMBOURSE,
} from './requetes'

const API = 'https://api.stripe.com'
// Meme version epinglee que stripe-actions.ts.
const STRIPE_VERSION = '2025-09-30.clover'
const DELAI_MS = 10_000

export function cleAchat(): string | null {
  return process.env.STRIPE_CHECKOUT_KEY_AOKNOWLEDGE?.trim() || process.env.STRIPE_AGENT_KEY_AOKNOWLEDGE?.trim() || null
}

export function clePublique(): string | null {
  const c = process.env.STRIPE_PUBLISHABLE_KEY_AOKNOWLEDGE?.trim() || ''
  return /^pk_(live|test)_[A-Za-z0-9]+$/.test(c) ? c : null
}

export const secretWebhook = () => process.env.STRIPE_WEBHOOK_SECRET_ACADEMIE?.trim() || null

export const ventePublique = () => process.env.ACADEMIE_ACHAT_PUBLIC?.trim() === '1'

/** Une erreur Stripe, sans son message (il peut reprendre un email). */
export class ErreurStripe extends Error {
  /** conditions : Stripe refuse consent_collection, l'URL des conditions manque dans les reglages publics du compte. */
  constructor(public statut: number, public type: string, public permission: boolean, public conditions = false) {
    super(`stripe ${statut} ${type}`)
    this.name = 'ErreurStripe'
  }
}

async function appeler(cle: string, chemin: string, corps?: URLSearchParams): Promise<Record<string, unknown>> {
  const r = await fetch(`${API}${chemin}`, {
    method: corps ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${cle}`,
      'Stripe-Version': STRIPE_VERSION,
      ...(corps ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: corps,
    signal: AbortSignal.timeout(DELAI_MS),
  })
  let j: Record<string, unknown> = {}
  try { j = (await r.json()) as Record<string, unknown> } catch { /* corps illisible */ }
  if (!r.ok) {
    const e = (j.error ?? {}) as Record<string, unknown>
    const message = typeof e.message === 'string' ? e.message : ''
    throw new ErreurStripe(r.status, typeof e.type === 'string' ? e.type : 'inconnu',
      r.status === 403 || /permission/i.test(message), /terms of service/i.test(message))
  }
  return j
}

// ---------------------------------------------------------------------------
// Creation de la session
// ---------------------------------------------------------------------------

export async function offreEnVente(slug: string): Promise<OffreEnVente | null> {
  const l = (await prisma.$queryRawUnsafe<{
    module_slug: string; module_titre: string; offre_slug: string; stripe_price_id: string
  }[]>(SQL_OFFRE_EN_VENTE, slug))[0]
  if (!l) return null
  return { moduleSlug: l.module_slug, moduleTitre: l.module_titre, offreSlug: l.offre_slug, stripePriceId: l.stripe_price_id }
}

export async function emailConfirme(userId: string): Promise<string | null> {
  const l = (await prisma.$queryRawUnsafe<{ email: string | null }[]>(SQL_EMAIL_CONFIRME, userId))[0]
  return l?.email ?? null
}

export async function creerSession(cle: string, o: OffreEnVente, p: {
  retourUrl: string; userId: string | null; email: string | null; essai: boolean
}): Promise<{ id: string; clientSecret: string }> {
  const s = await appeler(cle, '/v1/checkout/sessions', corpsSession(o, p))
  if (typeof s.id !== 'string' || typeof s.client_secret !== 'string') throw new ErreurStripe(502, 'reponse', false)
  return { id: s.id, clientSecret: s.client_secret }
}

// ---------------------------------------------------------------------------
// L'acces (confirmation de la page et webhook)
// ---------------------------------------------------------------------------

/** La session, payment_intent deplie (pour la charge) ; sans la permission PaymentIntents, sans lui. */
export async function lireSession(cle: string, id: string): Promise<Record<string, unknown>> {
  const chemin = `/v1/checkout/sessions/${encodeURIComponent(id)}`
  try {
    return await appeler(cle, `${chemin}?expand[]=payment_intent`)
  } catch (err) {
    if (err instanceof ErreurStripe && err.permission) return appeler(cle, chemin)
    throw err
  }
}

export type Enregistrement =
  | { ok: true; achat: AchatLu; cree: boolean }
  | { ok: false; raison: Exclude<LectureAchat, { ok: true }>['raison'] | 'offre_inconnue' }

/** Pose l'acces d'une session payee. Idempotent : la seconde fois, cree = false. */
export async function enregistrerAchat(session: Record<string, unknown>): Promise<Enregistrement> {
  const lu = lireAchat(session)
  if (!lu.ok) return lu
  const a = lu.achat
  const paiement = a.chargeId ? `stripe:${a.chargeId}` : null
  const note = a.essai ? 'Achat test (?achat=essai), avant ouverture publique' : null
  const l = (await prisma.$queryRawUnsafe<{ offre_connue: number; cree: number }[]>(
    SQL_POSER_ACHAT, a.userId, a.email, a.offreSlug, a.sessionId, a.montantEur, a.renonciationLe, note, paiement,
  ))[0]
  if (!l || l.offre_connue === 0) return { ok: false, raison: 'offre_inconnue' }
  if (l.cree === 0 && paiement) await prisma.$executeRawUnsafe(SQL_COMPLETER_PAIEMENT, a.sessionId, paiement)
  if (l.cree > 0) await oublierDroitsGardes(a)
  return { ok: true, achat: a, cree: l.cree > 0 }
}

/** Remboursement total d'une charge : les acces qu'elle a ouverts se retirent. */
export async function retirerRembourse(cle: string, charge: Record<string, unknown>): Promise<number> {
  if (charge.refunded !== true || typeof charge.id !== 'string') return 0
  const sessions: string[] = []
  if (typeof charge.payment_intent === 'string') {
    try {
      const liste = await appeler(cle, `/v1/checkout/sessions?limit=3&payment_intent=${encodeURIComponent(charge.payment_intent)}`)
      for (const s of Array.isArray(liste.data) ? liste.data : []) {
        const id = (s as Record<string, unknown>).id
        if (typeof id === 'string') sessions.push(id)
      }
    } catch { /* la charge seule suffit si paiement_id est pose */ }
  }
  const l = (await prisma.$queryRawUnsafe<{ retires: number }[]>(SQL_RETIRER_REMBOURSE, `stripe:${charge.id}`, sessions))[0]
  return l?.retires ?? 0
}

/** Vide le cache des droits des bots (trouver-cours.ts) pour le compte et les comptes de l'email du paiement. */
async function oublierDroitsGardes(a: AchatLu): Promise<void> {
  const ids = new Set<string>(a.userId ? [a.userId] : [])
  if (a.email) {
    try {
      for (const r of await prisma.$queryRawUnsafe<{ id: string }[]>(SQL_COMPTES_DE_EMAIL, a.email)) ids.add(r.id)
    } catch { /* le cache expire seul en 10 minutes */ }
  }
  for (const id of ids) oublierDroitsDuCompte(id)
}
