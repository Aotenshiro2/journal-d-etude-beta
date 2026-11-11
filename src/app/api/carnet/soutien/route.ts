import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { appeler, emailConfirme, ErreurStripe } from '@/lib/academie/achat'
import { tronquer } from '@/lib/academie/http'
import { abonnementCarnetDe, checkMentoratAccess, oublierSoutienCarnet } from '@/lib/entitlements'
import { messageErreur } from '@/lib/liveclub/pur'
import { clePilotage, portailDuClient } from '@/lib/pilotage-abonnement'
import { estAdminPilotage } from '@/lib/pilotage-niveau'
import {
  RETOUR_SOUTIEN, TARIFS_CARNET, corpsSessionSoutienCarnet, decisionSoutien, estRaisonComprise, periodeCarnet, prixCarnet,
  soutienOuvert, urlCheckoutSure,
} from '@/lib/soutien-pur'

/**
 * /api/carnet/soutien : « Soutenir le Carnet » dans « Mon forfait » de
 * l'extension (brief du 11/11/2026, labo du soutien). Bearer du Carnet ; pas de
 * CORS (les fetch d'une extension MV3 passent outre).
 *
 * GET : ce que l'ecran montre.
 *   200 { ok, compris, ouvert, soutien, actif, portail, offres: { mois: 5.99, an: 57.5 } }
 *   compris : le Premium vient d'une formule (Live Club, Formation, ETM, VIP, acces manuel) ;
 *   ouvert  : la vente du soutien est ouverte a ce compte (SOUTIEN_APPS_PUBLIC=1, ou compte admin) ;
 *   soutien : un abonnement Carnet Premium actif marque soutien (null : Stripe illisible) ;
 *   actif   : un abonnement Carnet Premium actif, soutien ou non (null : illisible) ;
 *   portail : le portail Stripe pour gerer ou arreter le soutien (soutien seulement), sinon null.
 *   La ligne « Soutenir le Carnet » se montre si compris && ouvert && actif === false.
 *
 * POST { periode: 'mois' | 'an' } : la session Checkout HEBERGEE de l'abonnement
 * Carnet Premium EXISTANT (memes prix, aucun produit neuf), marquee soutien=1.
 *   200 { ok, url }   (checkout.stripe.com, a ouvrir dans un onglet)
 *   400 'corps' | 401 'compte' | 403 'ferme' | 409 'deja' | 'pas_compris'
 *   503 'config' | 'indisponible' | 502 'stripe'
 *
 * Cle : STRIPE_CARNET_CHECKOUT_KEY_AOKNOWLEDGE (Checkout Sessions et Customer
 * portal en ecriture), sinon celle de Pilotage (meme compte Stripe). Lecture des
 * abonnements : STRIPE_KEY_CARNET_AOK (entitlements.ts).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const cleSoutienCarnet = (): string | null => process.env.STRIPE_CARNET_CHECKOUT_KEY_AOKNOWLEDGE?.trim() || clePilotage()

const json = (corps: Record<string, unknown>, status = 200) =>
  NextResponse.json(corps, { status, headers: { 'Cache-Control': 'no-store' } })
const refus = (erreur: string, status: number) => json({ ok: false, erreur }, status)

/** Ce que l'on sait du compte : formule, abonnement Carnet, admin. */
async function etatDuCompte(userId: string) {
  const [acces, admin] = await Promise.all([checkMentoratAccess(userId), estAdminPilotage(userId)])
  const email = acces.email ?? (await emailConfirme(userId))
  const carnet = await abonnementCarnetDe(email)
  return { compris: estRaisonComprise(acces.reason), admin, email, carnet }
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return refus('compte', 401)
  try {
    const e = await etatDuCompte(userId)
    const portail = e.carnet?.soutien ? await portailDuClient(cleSoutienCarnet(), e.carnet.client, RETOUR_SOUTIEN) : null
    const ouvertATous = soutienOuvert(process.env)
    return json({
      ok: true,
      // Avant l'ouverture, un compte admin ou de l'equipe voit la ligne pour l'essayer (sa raison n'est pas une formule).
      compris: e.compris || (e.admin && !ouvertATous),
      ouvert: ouvertATous || e.admin,
      soutien: e.carnet ? e.carnet.soutien : null,
      actif: e.carnet ? e.carnet.actif : null,
      portail,
      offres: { ...TARIFS_CARNET },
    })
  } catch (err) {
    console.warn(`[carnet/soutien] etat illisible compte=${tronquer(userId)} : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  let corps: Record<string, unknown> = {}
  try { corps = (await req.json()) as Record<string, unknown> } catch { return refus('corps', 400) }
  const periode = periodeCarnet(corps?.periode)
  if (!periode) return refus('corps', 400)

  let e: Awaited<ReturnType<typeof etatDuCompte>> | null = null
  if (userId) {
    try { e = await etatDuCompte(userId) } catch (err) {
      console.warn(`[carnet/soutien] etat illisible compte=${tronquer(userId)} : ${messageErreur(err)}`)
      return refus('indisponible', 503)
    }
    // Sans lecture sure de l'abonnement, on ne vend pas : deux abonnements seraient pires qu'un refus.
    if (!e.carnet) return refus('indisponible', 503)
  }
  const ouvert = soutienOuvert(process.env)
  const d = decisionSoutien({
    connecte: Boolean(userId),
    ouvert,
    admin: Boolean(e?.admin),
    dejaAbonne: Boolean(e?.carnet?.actif),
    compris: Boolean(e?.compris),
  })
  if (!d.ok || !userId || !e) return refus(d.ok ? 'compte' : d.erreur, d.ok ? 401 : d.status)

  const cle = cleSoutienCarnet()
  if (!cle) {
    console.warn('[carnet/soutien] config absente (cle Checkout)')
    return refus('config', 503)
  }
  const essai = !ouvert
  try {
    const s = await appeler(cle, '/v1/checkout/sessions', corpsSessionSoutienCarnet({ prix: prixCarnet(process.env, periode), userId, email: e.email, essai }))
    const url = urlCheckoutSure(s.url)
    if (!url) throw new ErreurStripe(502, 'reponse', false)
    if (e.email) oublierSoutienCarnet(e.email) // le retour relira l'abonnement neuf
    console.info(`[carnet/soutien] session creee periode=${periode} compte=${tronquer(userId)}${essai ? ' essai' : ''}`)
    return json({ ok: true, url })
  } catch (err) {
    if (err instanceof ErreurStripe && (err.permission || err.statut === 401)) {
      console.warn(`[carnet/soutien] cle Stripe sans la permission Checkout Sessions (${err.statut})`)
      return refus('config', 503)
    }
    if (err instanceof ErreurStripe && err.conditions) {
      console.warn('[carnet/soutien] Stripe exige une URL de conditions dans les reglages publics du compte (consent_collection)')
      return refus('config', 503)
    }
    console.warn(`[carnet/soutien] Stripe a refuse la session : ${err instanceof ErreurStripe ? err.message : messageErreur(err)}`)
    return refus('stripe', 502)
  }
}
