import { NextRequest, NextResponse } from 'next/server'
import { cleAchat, ErreurStripe } from '@/lib/academie/achat'
import { compteDuJeton, tronquer } from '@/lib/academie/http'
import { messageErreur } from '@/lib/liveclub/pur'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { lireSessionCheckout, synchroniserAbonnement } from '@/lib/pilotage-abonnement'
import { palierDuMembre } from '@/lib/pilotage-niveau'
import { estSessionId, lireSessionPilotage, type Palier } from '@/lib/pilotage-paliers'

/**
 * GET /api/pilotage/achat/confirmer?session_id=cs_... : juste apres le
 * paiement, la page /offres de Pilotage demande le droit sans attendre le
 * webhook (brief E1, 30/10/2026). Route PUBLIQUE : la session et
 * l'abonnement sont relus chez Stripe, rien n'est cru de la requete.
 * Idempotent (la meme ligne academie_acces que le webhook).
 *
 * Bearer facultatif : connecte, `palier` est celui du compte (relu) ; sans
 * compte, 'premium' des que le droit est pose.
 * 200 { ok, palier, etat: 'ouvert' | 'en_attente', offre?, compte_lie? }
 * 400 'corps' | 404 'session' | 409 'non_paye' | 503 'config' | 'indisponible'
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const METHODES = 'GET, OPTIONS'

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

export async function GET(req: NextRequest) {
  const headers = { ...corsHeaders(req, METHODES), 'Cache-Control': 'no-store' }
  const refus = (erreur: string, status: number) => NextResponse.json({ ok: false, erreur }, { status, headers })

  const id = req.nextUrl.searchParams.get('session_id')
  if (!estSessionId(id)) return refus('corps', 400)
  const cle = cleAchat()
  if (!cle) return refus('config', 503)

  let session: Record<string, unknown>
  try {
    session = await lireSessionCheckout(cle, id)
  } catch (err) {
    if (err instanceof ErreurStripe && err.statut === 404) return refus('session', 404)
    if (err instanceof ErreurStripe && err.permission) return refus('config', 503)
    console.warn(`[pilotage/achat/confirmer] session illisible : ${err instanceof ErreurStripe ? err.message : messageErreur(err)}`)
    return refus('indisponible', 503)
  }

  let compte: string | null = null
  try { compte = await compteDuJeton(req) } catch { /* compte illisible : le palier de l'achat seul */ }
  const palierDuCompte = async (defaut: Palier): Promise<Palier> => {
    if (!compte) return defaut
    try { return (await palierDuMembre(compte)).palier } catch { return defaut }
  }

  const lu = lireSessionPilotage(session)
  if (!lu.ok) {
    if (lu.raison === 'pas_pilotage') return refus('session', 404)
    if (lu.raison === 'en_attente') return NextResponse.json({ ok: true, palier: await palierDuCompte('libre'), etat: 'en_attente' }, { headers })
    return refus('non_paye', 409)
  }

  let r
  try {
    r = await synchroniserAbonnement(cle, lu.abonnementId, { userId: lu.userId, email: lu.email, essai: lu.essai, renonciationLe: lu.renonciationLe })
  } catch (err) {
    if (err instanceof ErreurStripe && err.permission) {
      console.warn('[pilotage/achat/confirmer] cle Stripe sans la lecture des abonnements')
      return refus('config', 503)
    }
    console.warn(`[pilotage/achat/confirmer] droit NON pose : ${err instanceof ErreurStripe ? err.message : messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!r.ok) {
    console.warn(`[pilotage/achat/confirmer] session payee sans droit pose : ${r.raison}`)
    return refus(r.raison === 'offre_inconnue' ? 'indisponible' : 'non_paye', r.raison === 'offre_inconnue' ? 503 : 409)
  }
  if (r.etat !== 'ouvert') return NextResponse.json({ ok: true, palier: await palierDuCompte('libre'), etat: 'en_attente', offre: r.slug }, { headers })

  if (r.cree) console.info(`[pilotage/achat/confirmer] droit pose offre=${r.slug} compte=${r.userId ? tronquer(r.userId) : 'email'}${r.essai ? ' essai' : ''}`)
  const palier = await palierDuCompte('premium')
  return NextResponse.json({ ok: true, palier, etat: 'ouvert', offre: r.slug, compte_lie: compte !== null && palier !== 'libre' }, { headers })
}
