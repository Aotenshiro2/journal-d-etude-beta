import { NextRequest } from 'next/server'
import { corsPreflight } from '@/lib/support-cors'
import { gardeMembre, repondre } from '@/lib/besoins/garde'
import { voterPourBesoin } from '@/lib/besoins/membres'

/**
 * POST /api/besoins/voter : « Moi aussi » sur une carte deja prevue (besoins
 * des membres, lot 2, 06/11/2026). Corps : { besoinId }. Un vote par membre
 * (le compte de la session) et par carte, idempotent.
 * Reponses : 200 { ok, votes } ; 400 ; 401 ; 404 carte pas planifiee ni en cours ; 503.
 */

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const g = await gardeMembre(req)
  if (!g.ok) return g.reponse
  return repondre(await voterPourBesoin(g.userId, await req.json().catch(() => null)), g.headers)
}
