import { NextRequest } from 'next/server'
import { corsPreflight } from '@/lib/support-cors'
import { gardeCockpit, repondre } from '@/lib/besoins/garde'
import { fusionnerBesoins } from '@/lib/besoins/cockpit'

/**
 * POST /api/cockpit/besoins/fusionner (besoins des membres, lot 3, 06/11/2026) :
 * { sourceId, cibleId }. La source prend fusionne_dans = la carte qui compte
 * pour la cible ; ses demandes et ses votes comptent pour elle.
 * Reponses : 200 { ok } ; 400 ; 401 ; 403 ; 404 ; 503.
 */

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const g = await gardeCockpit(req)
  if (!g.ok) return g.reponse
  return repondre(await fusionnerBesoins(await req.json().catch(() => null)), g.headers)
}
