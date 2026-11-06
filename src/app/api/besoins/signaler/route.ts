import { NextRequest, NextResponse } from 'next/server'
import { corsPreflight } from '@/lib/support-cors'
import { gardeMembre, repondre } from '@/lib/besoins/garde'
import { signalerBesoin } from '@/lib/besoins/membres'
import { CORPS_MAX_OCTETS } from '@/lib/besoins/bouton-pur'

// Classement Haiku, regroupement, capture : quelques secondes.
export const maxDuration = 60

/**
 * POST /api/besoins/signaler : le bouton « Il me manque quelque chose » de nos
 * outils (besoins des membres, lot 2, 06/11/2026). Contrat :
 * besoins-contrat-api.md. Corps : { app, texte, page?, capture? }.
 *
 * Le membre signale pour LUI (le compte de la session, jamais un champ du
 * corps). Texte recopie tel quel ; outil deduit de l'app ; classement Haiku
 * (sauf texte suspect : Brice prevenu) ; capture verifiee (octets magiques,
 * type, 1,5 Mo) et rangee dans un bucket prive ; 5 par 24 heures.
 * Reponses : 200 { ok, phrase } ; 400 ; 401 ; 413 ; 429 ; 503.
 */

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const g = await gardeMembre(req)
  if (!g.ok) return g.reponse
  const longueur = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(longueur) && longueur > CORPS_MAX_OCTETS) {
    return NextResponse.json({ error: 'Capture trop lourde : 1,5 Mo au plus.' }, { status: 413, headers: g.headers })
  }
  const corps = await req.json().catch(() => null)
  return repondre(await signalerBesoin(g.userId, corps), g.headers)
}
