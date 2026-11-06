import { NextRequest } from 'next/server'
import { corsPreflight } from '@/lib/support-cors'
import { gardeCockpit, repondre } from '@/lib/besoins/garde'
import { deplacerDemande } from '@/lib/besoins/cockpit'

/**
 * POST /api/cockpit/besoins/deplacer-demande (besoins des membres, lot 3,
 * 06/11/2026) : { demandeId, carteId }. La demande passe sur la carte (ou sur
 * celle qui la remplace si elle est fusionnee).
 * Reponses : 200 { ok } ; 400 (dont : deja sur la carte cible) ; 401 ; 403 ; 404 ; 503.
 */

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const g = await gardeCockpit(req)
  if (!g.ok) return g.reponse
  return repondre(await deplacerDemande(await req.json().catch(() => null)), g.headers)
}
