import { NextRequest } from 'next/server'
import { corsPreflight } from '@/lib/support-cors'
import { gardeMembre, repondre } from '@/lib/besoins/garde'
import { prevusPourMembre } from '@/lib/besoins/membres'

export const dynamic = 'force-dynamic'

const METHODES = 'GET, OPTIONS'

/**
 * GET /api/besoins/prevus?app=<app> : « Déjà prévu » sous le bouton « Il me
 * manque quelque chose » (besoins des membres, lot 2, 06/11/2026). 8 cartes
 * au plus de l'outil de cette app, au statut planifie ou en_cours : des
 * TITRES de cartes (valides par Brice en planifiant), jamais un texte de
 * membre. Lu a l'ouverture du formulaire (pas de minuterie).
 * Reponses : 200 { besoins: [{ id, titre, statut, votes, aVote }] } ; 400 ; 401 ; 503.
 */

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

export async function GET(req: NextRequest) {
  const g = await gardeMembre(req, METHODES)
  if (!g.ok) return g.reponse
  return repondre(await prevusPourMembre(g.userId, new URL(req.url).searchParams.get('app')), g.headers)
}
