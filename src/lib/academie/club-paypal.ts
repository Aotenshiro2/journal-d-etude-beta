// Le 10% Club paye par PayPal (29/10/2026) : PayPal Orders v2 cote serveur,
// l'acces « formation-complete » et l'email d'acces. Regles pures :
// club-paypal-pur.ts.
//
// Variables (journal, Vercel) :
//   PAYPAL_CLIENT_ID       identifiant de l'application REST PayPal (public :
//                          rendu a la page pour charger le JS SDK).
//   PAYPAL_CLIENT_SECRET   son secret (OAuth client_credentials). Jamais rendu,
//                          jamais dans un log.
//   PAYPAL_ENV=sandbox     bac a sable (api-m.sandbox.paypal.com). Absente :
//                          production (api-m.paypal.com).
//   CLUB_PAYPAL_PUBLIC=1   ouvre la vente a tous. Sans elle, seule une demande
//                          « essai » d'un compte admin cree une commande (1 EUR).
//   RESEND_API_KEY_LIVECLUB (ou RESEND_API_KEY) : la cle Resend des emails du
//                          Live Club, meme domaine d'envoi (support@).
//   CLUB_FROM_EMAIL        expediteur, par defaut « AO Knowledge <support@aoknowledge.com> ».
//
// Pas de webhook PayPal dans ce lot (l'enregistrer modifierait la config
// PayPal de Brice) : la page capture juste apres l'accord de l'acheteur, et
// une capture EN ATTENTE est signalee a l'equipe (Telegram, Agent AOK).

import { Resend } from 'resend'
import { prisma } from '@/lib/db'
import { oublierDroitsDuCompte } from '@/lib/trouver-cours'
import {
  OFFRE_CLUB, corpsCommande, htmlEmailClub, issuePayPal, modeleEmailClub, requeteCapture, texteEmailClub,
  type Titulaire,
} from './club-paypal-pur'
import { SQL_COMPTES_DE_EMAIL, SQL_POSER_ACHAT_PAYPAL, SQL_PRIX_OFFRE } from './requetes'

const DELAI_MS = 15_000

export const clientIdPayPal = () => process.env.PAYPAL_CLIENT_ID?.trim() || null
const secretPayPal = () => process.env.PAYPAL_CLIENT_SECRET?.trim() || null

/** La config complete (identifiant ET secret), sinon null : la route rend 503 'config'. */
export function configPayPal(): { clientId: string; secret: string } | null {
  const clientId = clientIdPayPal()
  const secret = secretPayPal()
  return clientId && secret ? { clientId, secret } : null
}

export const ventePubliqueClub = () => process.env.CLUB_PAYPAL_PUBLIC?.trim() === '1'

export const hotePayPal = () => process.env.PAYPAL_ENV?.trim().toLowerCase() === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com'

/** Une erreur PayPal : le statut et l'« issue » seulement (le message peut reprendre un email ou un custom_id). */
export class ErreurPayPal extends Error {
  constructor(public statut: number, public issue: string) {
    super(`paypal ${statut} ${issue}`)
    this.name = 'ErreurPayPal'
  }
}

// ---------------------------------------------------------------------------
// OAuth client_credentials, jeton garde en memoire jusqu'a 1 min de sa fin
// ---------------------------------------------------------------------------

let jetonGarde: { pour: string; jeton: string; expire: number } | null = null

async function jetonPayPal(c: { clientId: string; secret: string }): Promise<string> {
  const pour = `${hotePayPal()}|${c.clientId}`
  if (jetonGarde && jetonGarde.pour === pour && Date.now() < jetonGarde.expire) return jetonGarde.jeton
  const r = await fetch(`${hotePayPal()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(DELAI_MS),
  })
  let j: Record<string, unknown> = {}
  try { j = (await r.json()) as Record<string, unknown> } catch { /* corps illisible */ }
  if (!r.ok || typeof j.access_token !== 'string') {
    jetonGarde = null
    throw new ErreurPayPal(r.status === 200 ? 502 : r.status, typeof j.error === 'string' && /^[a-z_]{3,60}$/.test(j.error) ? j.error : 'oauth')
  }
  const duree = typeof j.expires_in === 'number' ? j.expires_in : 300
  jetonGarde = { pour, jeton: j.access_token, expire: Date.now() + Math.max(0, duree - 60) * 1000 }
  return j.access_token
}

async function appeler(
  c: { clientId: string; secret: string },
  chemin: string,
  o: { corps?: Record<string, unknown>; requestId?: string; methode?: 'GET' | 'POST' } = {},
): Promise<Record<string, unknown>> {
  const jeton = await jetonPayPal(c)
  const r = await fetch(`${hotePayPal()}${chemin}`, {
    method: o.methode ?? (o.corps ? 'POST' : 'GET'),
    headers: {
      Authorization: `Bearer ${jeton}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(o.requestId ? { 'PayPal-Request-Id': o.requestId } : {}),
    },
    body: o.corps ? JSON.stringify(o.corps) : undefined,
    signal: AbortSignal.timeout(DELAI_MS),
  })
  let j: Record<string, unknown> = {}
  try { j = (await r.json()) as Record<string, unknown> } catch { /* corps vide ou illisible */ }
  if (r.status === 401) jetonGarde = null
  if (!r.ok) throw new ErreurPayPal(r.status, issuePayPal(j))
  return j
}

// ---------------------------------------------------------------------------
// Commande et capture
// ---------------------------------------------------------------------------

/** Le prix de l'offre du 10% Club en base, ou null (la regle pure retombe sur 1 999). */
export async function prixClub(): Promise<number | null> {
  const l = (await prisma.$queryRawUnsafe<{ prix: string | null }[]>(SQL_PRIX_OFFRE, OFFRE_CLUB))[0]
  const n = l?.prix === null || l?.prix === undefined ? NaN : Number(l.prix)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function creerCommande(
  c: { clientId: string; secret: string },
  p: { titulaire: Titulaire; montantEur: number; essai: boolean },
): Promise<string> {
  const o = await appeler(c, '/v2/checkout/orders', { corps: corpsCommande(p) })
  if (typeof o.id !== 'string') throw new ErreurPayPal(502, 'reponse')
  return o.id
}

export function lireCommandePayPal(c: { clientId: string; secret: string }, orderId: string): Promise<Record<string, unknown>> {
  return appeler(c, `/v2/checkout/orders/${encodeURIComponent(orderId)}`)
}

/**
 * Capture une commande approuvee. Idempotent chez PayPal (PayPal-Request-Id
 * fixe par commande) ; une commande deja capturee (appel concurrent) est
 * relue telle quelle.
 */
export async function capturerCommandePayPal(c: { clientId: string; secret: string }, orderId: string): Promise<Record<string, unknown>> {
  try {
    return await appeler(c, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      methode: 'POST', corps: {}, requestId: requeteCapture(orderId),
    })
  } catch (err) {
    if (err instanceof ErreurPayPal && err.issue === 'ORDER_ALREADY_CAPTURED') return lireCommandePayPal(c, orderId)
    throw err
  }
}

// ---------------------------------------------------------------------------
// L'acces et l'email
// ---------------------------------------------------------------------------

/** L'acces d'une capture terminee. Idempotent : la seconde fois, cree = false. offre_connue = false si l'offre manque en base. */
export async function poserAccesClub(p: {
  userId: string | null; email: string | null; orderId: string; montantEur: number; renonciationLe: Date
  note: string; captureId: string
}): Promise<{ offreConnue: boolean; cree: boolean }> {
  const l = (await prisma.$queryRawUnsafe<{ offre_connue: number; cree: number }[]>(
    SQL_POSER_ACHAT_PAYPAL, p.userId, p.email, OFFRE_CLUB, p.orderId, p.montantEur, p.renonciationLe, p.note, `paypal:${p.captureId}`,
  ))[0]
  const offreConnue = !!l && l.offre_connue > 0
  const cree = !!l && l.cree > 0
  if (cree) await oublierDroitsGardes(p.userId, p.email)
  return { offreConnue, cree }
}

/** Vide le cache des droits des bots (trouver-cours.ts) pour le compte et les comptes de l'email. */
async function oublierDroitsGardes(userId: string | null, email: string | null): Promise<void> {
  const ids = new Set<string>(userId ? [userId] : [])
  if (email) {
    try {
      for (const r of await prisma.$queryRawUnsafe<{ id: string }[]>(SQL_COMPTES_DE_EMAIL, email)) ids.add(r.id)
    } catch { /* le cache expire seul en 10 minutes */ }
  }
  for (const id of ids) oublierDroitsDuCompte(id)
}

/** L'email d'acces. Ne jette jamais : ok false et l'appelant le note (jamais l'adresse dans un log). */
export async function envoyerEmailClub(email: string, essai: boolean): Promise<{ ok: true } | { ok: false; erreur: string }> {
  const cle = process.env.RESEND_API_KEY_LIVECLUB?.trim() || process.env.RESEND_API_KEY?.trim()
  if (!cle) return { ok: false, erreur: 'RESEND_API_KEY_LIVECLUB et RESEND_API_KEY absentes' }
  const m = modeleEmailClub({ email, essai })
  try {
    const { error } = await new Resend(cle).emails.send({
      from: process.env.CLUB_FROM_EMAIL?.trim() || 'AO Knowledge <support@aoknowledge.com>',
      to: email,
      replyTo: 'support@aoknowledge.com',
      subject: m.sujet,
      html: htmlEmailClub(m),
      text: texteEmailClub(m),
    })
    if (error) return { ok: false, erreur: `Resend : ${String(error.name ?? 'erreur').slice(0, 80)}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, erreur: `Resend : ${err instanceof Error ? err.name : 'erreur'}` }
  }
}

/**
 * Signale un texte a l'equipe par Agent AOK (comptes de
 * cockpit_telegram_comptes, Brice et Melanie), comme les alertes « un membre
 * demande un humain » (alerte-equipe-telegram.ts). Ne jette jamais. Renvoie
 * le nombre de destinataires qui l'ont recu.
 */
export async function alerterEquipeClub(texte: string): Promise<number> {
  try {
    const { tgCockpit } = await import('@/lib/agent-cockpit-telegram')
    const destinataires = await prisma.$queryRaw<{ telegram_id: bigint }[]>`
      select telegram_id from public.cockpit_telegram_comptes order by cree_le`
    let livres = 0
    for (const d of destinataires) {
      const chat = Number(d.telegram_id)
      if (!Number.isSafeInteger(chat) || chat <= 0) continue
      if (await tgCockpit('sendMessage', { chat_id: chat, text: texte.slice(0, 4000), link_preview_options: { is_disabled: true } })) livres++
    }
    return livres
  } catch (err) {
    console.warn(`[club/paypal] alerte Telegram non envoyee : ${(err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 160)}`)
    return 0
  }
}
