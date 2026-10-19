// La vente a l'unite des modules de l'academie, sans reseau ni base
// (19/10/2026). Testable seul (scripts/verifier-achat-academie.mjs).
//
// Decision de Brice (19/10) : « celui qui cree le moins de friction et qui a
// le meilleur taux de conversion ». Donc Stripe Embedded Checkout dans une
// fenetre par-dessus la page, pas de compte exige avant de payer (Checkout
// demande l'email), paiements express (Apple Pay, Google Pay, Link) laisses
// aux reglages du compte Stripe.
//
// - corpsSession : les parametres de POST /v1/checkout/sessions ;
// - lireAchat : ce qu'une session Checkout payee ouvre (ou pourquoi rien) ;
// - verifierSignature : l'en-tete Stripe-Signature d'un webhook ;
// - retourSur : le chemin de la page ou revenir apres un paiement redirige.

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Le chemin de retour : une page de l'academie, sans redirection ouverte (memes regles que src/lib/retour.ts du site). */
export function retourSur(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null
  const chemin = valeur.trim()
  if (!chemin || chemin.length > 300) return null
  if (!chemin.startsWith('/academie/') || chemin.startsWith('//')) return null
  if (/[\\\u0000-\u001f\u007f?#]/.test(chemin)) return null
  return chemin
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const estUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/** L'identifiant d'une session Checkout (cs_live_..., cs_test_...). */
export const estSessionId = (v: unknown): v is string => typeof v === 'string' && /^cs_[A-Za-z0-9_]{10,250}$/.test(v)

export type OffreEnVente = {
  moduleSlug: string
  moduleTitre: string
  offreSlug: string
  stripePriceId: string
}

/** Le texte sous le bouton Payer (contenu numerique : acces immediat, art. L221-28 du code de la consommation). */
export const TEXTE_RETRACTATION =
  "En payant, tu demandes l'accès immédiat au module et tu renonces à ton droit de rétractation de 14 jours."

/**
 * Les parametres de la session Checkout (application/x-www-form-urlencoded).
 * retourUrl porte deja {CHECKOUT_SESSION_ID}. Connecte : email prerempli
 * (verifie) et compte en client_reference_id, pose par le serveur depuis le
 * jeton, jamais lu dans le corps de la requete.
 */
export function corpsSession(o: OffreEnVente, p: {
  retourUrl: string
  userId: string | null
  email: string | null
  essai: boolean
}): URLSearchParams {
  const c = new URLSearchParams()
  c.set('mode', 'payment')
  c.set('ui_mode', 'embedded')
  c.set('redirect_on_completion', 'if_required')
  c.set('return_url', p.retourUrl)
  c.set('line_items[0][price]', o.stripePriceId)
  c.set('line_items[0][quantity]', '1')
  c.set('locale', 'fr')
  c.set('customer_creation', 'always')
  c.set('custom_text[submit][message]', TEXTE_RETRACTATION)
  if (p.userId) {
    c.set('client_reference_id', p.userId)
    c.set('metadata[user_id]', p.userId)
  }
  if (p.email) c.set('customer_email', p.email)
  c.set('metadata[source]', 'academie')
  c.set('metadata[academie_module]', o.moduleSlug)
  c.set('metadata[academie_offre]', o.offreSlug)
  c.set('metadata[essai]', p.essai ? '1' : '0')
  // Le libelle du paiement : c'est lui que le pipeline du cockpit lit pour
  // classer la vente (push_membres_supabase.py, MOTIFS_OFFRES « ^academie aok »).
  c.set('payment_intent_data[description]', `Académie AOK : ${o.moduleTitre}`.slice(0, 900))
  c.set('payment_intent_data[metadata][source]', 'academie')
  c.set('payment_intent_data[metadata][academie_module]', o.moduleSlug)
  c.set('payment_intent_data[metadata][academie_offre]', o.offreSlug)
  return c
}

/** Ce qu'une session payee ouvre. */
export type AchatLu = {
  sessionId: string
  offreSlug: string
  moduleSlug: string
  userId: string | null
  email: string | null
  montantEur: number | null
  chargeId: string | null
  essai: boolean
  payeLe: Date
}

export type LectureAchat =
  | { ok: true; achat: AchatLu }
  | { ok: false; raison: 'pas_academie' | 'en_attente' | 'non_paye' | 'incomplet' }

function chaine(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** L'email tel que academie_acces l'accepte (minuscules, sans espaces), ou null. */
export function emailPropre(v: unknown): string | null {
  const e = chaine(v)?.toLowerCase() ?? null
  if (!e || e.length < 3 || e.length > 320 || e.indexOf('@') < 1) return null
  return e
}

/** L'identifiant de la charge, depuis payment_intent (deplie ou non). */
function chargeDe(pi: unknown): string | null {
  if (!pi || typeof pi !== 'object') return null
  const lc = (pi as Record<string, unknown>).latest_charge
  const id = typeof lc === 'string' ? lc : lc && typeof lc === 'object' ? (lc as Record<string, unknown>).id : null
  return typeof id === 'string' && /^(ch|py)_[A-Za-z0-9]{6,200}$/.test(id) ? id : null
}

/**
 * Une session Checkout (objet Stripe) : l'achat qu'elle ouvre, ou pourquoi
 * rien. Seules comptent les sessions de l'academie (metadata source et
 * academie_offre), complete ET payees. Un paiement differe (SEPA) arrive
 * complete mais 'unpaid' : en_attente, le webhook async_payment_succeeded
 * ecrira l'acces.
 */
export function lireAchat(s: Record<string, unknown>): LectureAchat {
  const meta = (s.metadata && typeof s.metadata === 'object' ? s.metadata : {}) as Record<string, unknown>
  const offre = chaine(meta.academie_offre)
  const moduleSlug = chaine(meta.academie_module)
  const id = chaine(s.id)
  if (meta.source !== 'academie' || !offre || !moduleSlug || !estSessionId(id) || s.mode !== 'payment') {
    return { ok: false, raison: 'pas_academie' }
  }
  if (s.status !== 'complete') return { ok: false, raison: 'incomplet' }
  if (s.payment_status === 'unpaid') return { ok: false, raison: 'en_attente' }
  if (s.payment_status !== 'paid') return { ok: false, raison: 'non_paye' }
  const details = (s.customer_details && typeof s.customer_details === 'object' ? s.customer_details : {}) as Record<string, unknown>
  const email = emailPropre(details.email) ?? emailPropre(s.customer_email)
  const ref = chaine(s.client_reference_id)
  const total = typeof s.amount_total === 'number' ? s.amount_total : null
  const cree = typeof s.created === 'number' ? new Date(s.created * 1000) : new Date()
  if (!email && !estUuid(ref)) return { ok: false, raison: 'incomplet' }
  return {
    ok: true,
    achat: {
      sessionId: id,
      offreSlug: offre,
      moduleSlug,
      userId: estUuid(ref) ? ref.toLowerCase() : null,
      email,
      montantEur: total === null ? null : Math.round(total) / 100,
      chargeId: chargeDe(s.payment_intent),
      essai: meta.essai === '1',
      payeLe: cree,
    },
  }
}

// ---------------------------------------------------------------------------
// Webhook : Stripe-Signature (t=...,v1=...), HMAC SHA-256 de « t.corps »
// ---------------------------------------------------------------------------

export const TOLERANCE_S = 300

export function verifierSignature(corps: string, entete: string | null, secret: string, maintenantS = Math.floor(Date.now() / 1000)): boolean {
  if (!entete || !secret) return false
  let t: number | null = null
  const v1: string[] = []
  for (const bout of entete.split(',')) {
    const i = bout.indexOf('=')
    if (i < 0) continue
    const k = bout.slice(0, i).trim()
    const v = bout.slice(i + 1).trim()
    if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v)
    else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) v1.push(v)
  }
  if (t === null || !v1.length || Math.abs(maintenantS - t) > TOLERANCE_S) return false
  const attendu = Buffer.from(createHmac('sha256', secret).update(`${t}.${corps}`, 'utf8').digest('hex'), 'hex')
  return v1.some(s => {
    const recu = Buffer.from(s, 'hex')
    return recu.length === attendu.length && timingSafeEqual(recu, attendu)
  })
}
