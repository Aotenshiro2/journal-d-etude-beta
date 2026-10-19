import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { cleAchat, enregistrerAchat, ErreurStripe, lireSession } from '@/lib/academie/achat'
import { estSessionId } from '@/lib/academie/achat-pur'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { SQL_IDENTITE } from '@/lib/academie/requetes'
import { messageErreur } from '@/lib/liveclub/pur'

/**
 * POST /api/academie/achat/confirmer : juste apres le paiement, la page
 * demande l'acces sans attendre le webhook (19/10/2026). Route PUBLIQUE :
 * la session est relue chez Stripe, rien n'est cru du corps. Idempotent (la
 * meme ligne que le webhook, index academie_acces_stripe_reference_idx).
 *
 * Corps : { session_id: 'cs_...' }, Bearer facultatif.
 * 200 { ok, etat: 'ouvert', module, email, compte_lie }
 *     compte_lie = l'acces est deja sur le compte connecte (meme uuid, ou
 *     l'email du paiement est un email verifie de ce compte) ;
 * 200 { ok, etat: 'en_attente' } : paiement differe, l'acces suivra (webhook) ;
 * 400 'corps' | 404 'session' | 409 'non_paye' | 503 'config' | 'indisponible'
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req) })
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)

  let corps: Record<string, unknown>
  try { corps = (await req.json()) as Record<string, unknown> } catch { return refus('corps', 400) }
  const id = corps.session_id
  if (!estSessionId(id)) return refus('corps', 400)

  const cle = cleAchat()
  if (!cle) return refus('config', 503)

  let session: Record<string, unknown>
  try {
    session = await lireSession(cle, id)
  } catch (err) {
    if (err instanceof ErreurStripe && err.statut === 404) return refus('session', 404)
    if (err instanceof ErreurStripe && err.permission) return refus('config', 503)
    console.warn(`[academie/achat/confirmer] session illisible : ${err instanceof ErreurStripe ? err.message : messageErreur(err)}`)
    return refus('indisponible', 503)
  }

  let r
  try {
    r = await enregistrerAchat(session)
  } catch (err) {
    console.warn(`[academie/achat/confirmer] acces NON pose : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!r.ok) {
    if (r.raison === 'en_attente') return NextResponse.json({ ok: true, etat: 'en_attente' }, { headers })
    if (r.raison === 'pas_academie') return refus('session', 404)
    if (r.raison === 'offre_inconnue') {
      console.warn('[academie/achat/confirmer] offre inconnue en base pour une session payee')
      return refus('indisponible', 503)
    }
    return refus('non_paye', 409)
  }

  // Le compte connecte porte-t-il deja cet acces ?
  let compteLie = false
  try {
    const userId = await compteDuJeton(req)
    if (userId) {
      if (r.achat.userId === userId) compteLie = true
      else if (r.achat.email) {
        const ident = (await prisma.$queryRawUnsafe<{ emails: string[] | null }[]>(SQL_IDENTITE, userId))[0]
        compteLie = (ident?.emails ?? []).includes(r.achat.email)
      }
    }
  } catch { /* compte illisible : la page proposera la connexion */ }

  if (r.cree) {
    console.info(`[academie/achat/confirmer] acces pose module=${r.achat.moduleSlug} compte=${r.achat.userId ? tronquer(r.achat.userId) : 'email'}${r.achat.essai ? ' essai' : ''}`)
  }
  return NextResponse.json(
    { ok: true, etat: 'ouvert', module: r.achat.moduleSlug, email: r.achat.email, compte_lie: compteLie },
    { headers },
  )
}
