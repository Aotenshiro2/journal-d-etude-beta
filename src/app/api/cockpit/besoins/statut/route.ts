import { NextRequest } from 'next/server'
import { corsPreflight } from '@/lib/support-cors'
import { gardeCockpit, repondre } from '@/lib/besoins/garde'
import { changerStatut } from '@/lib/besoins/cockpit'

export const maxDuration = 60

/**
 * POST /api/cockpit/besoins/statut (besoins des membres, lots 3 et 4,
 * 06/11/2026) : { id, statut, raison? }. planifie : le serveur ecrit le brief
 * et le rend. livre, refuse : le statut SEULEMENT (raison = raison_refus pour
 * refuse). RIEN n'est envoye aux membres par cette route.
 * Reponses : 200 { ok, brief? } ; 400 ; 401 ; 403 ; 404 ; 503.
 */

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const g = await gardeCockpit(req)
  if (!g.ok) return g.reponse
  return repondre(await changerStatut(await req.json().catch(() => null)), g.headers)
}
