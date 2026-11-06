import { NextRequest } from 'next/server'
import { corsPreflight } from '@/lib/support-cors'
import { gardeMembre, repondre } from '@/lib/besoins/garde'
import { livresPourMembre } from '@/lib/besoins/membres'

export const dynamic = 'force-dynamic'

const METHODES = 'GET, OPTIONS'

/**
 * GET /api/besoins/livres?app=<app> : « Livré grâce à vos demandes » dans les
 * ecrans Versions de nos outils (besoins des membres, suite du 06/11/2026,
 * piste D). 10 cartes au plus de l'outil de cette app, au statut livre, les
 * plus recentes d'abord : des TITRES de cartes (valides par Brice), le nombre
 * de personnes, jamais un texte de membre. Session requise, comme /prevus.
 * Reponses : 200 { besoins: [{ id, titre, livre_le, personnes }] } ; 400 ; 401 ; 503.
 */

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

export async function GET(req: NextRequest) {
  const g = await gardeMembre(req, METHODES)
  if (!g.ok) return g.reponse
  return repondre(await livresPourMembre(new URL(req.url).searchParams.get('app')), g.headers)
}
