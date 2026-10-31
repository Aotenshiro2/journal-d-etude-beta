import { NextRequest, NextResponse } from 'next/server'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie } from '@/lib/academie/http'
import { demanderCode } from '@/lib/emails-confirmation'
import { CODE_ESSAIS_MAX, CODE_VALIDITE_MINUTES, lireCorps, normaliserEmail } from '@/lib/emails-confirmation-pur'

/**
 * POST /api/compte/emails/ajouter : le membre ajoute une AUTRE adresse email a
 * son compte (Mon espace, Comptes lies, carte « Adresses email ». GO de Brice
 * du 31/10/2026). Un code a 6 chiffres part a CETTE adresse ; l'adresse ne
 * compte (verified) qu'une fois le code tape (/api/compte/emails/confirmer).
 * Sert aussi a « Renvoyer le code » : le code precedent ne marche plus.
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>, corps { email }.
 * Le compte est TOUJOURS celui du jeton.
 *
 * Reponses :
 *   200 { ok: true, minutes, essais }   code envoye (valable `minutes`, `essais` essais)
 *   400 'email'                         adresse illisible (format, longueur, caractere interdit)
 *   401 'jeton'
 *   409 'connexion'                     c'est l'email de connexion du compte
 *   409 'deja_verifiee'                 deja verifiee sur ce compte
 *   409 'rattachee'                     verifiee ou de connexion sur un autre compte (meme refus qu'avant)
 *   429 'limite'                        trop d'envois (compte, adresse ou total)
 *   502 'envoi'                         le mail n'est pas parti (rien de change)
 *   503 'config' | 'indisponible'
 * Logs : compte tronque, ref de l'adresse (8 caracteres d'un HMAC), issue.
 * JAMAIS l'adresse ni le code.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const METHODES = 'POST, OPTIONS'

const STATUTS: Record<string, number> = {
  connexion: 409, deja_verifiee: 409, rattachee: 409, limite: 429, envoi: 502, config: 503, indisponible: 503,
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)

  let userId: string | null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[compte/emails] verification du jeton impossible : ${err instanceof Error ? err.name : 'erreur'}`)
    return refus('indisponible', 503)
  }
  if (!userId) return refus('jeton', 401)

  const corps = lireCorps(await req.text().catch(() => ''))
  const email = normaliserEmail(corps?.email)
  if (!email) return refus('email', 400)

  const r = await demanderCode(userId, email)
  if (r.ok) return NextResponse.json({ ok: true, minutes: CODE_VALIDITE_MINUTES, essais: CODE_ESSAIS_MAX }, { headers })
  return refus(r.erreur, STATUTS[r.erreur] ?? 503)
}
