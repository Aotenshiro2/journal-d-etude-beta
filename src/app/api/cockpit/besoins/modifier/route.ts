import { NextRequest } from 'next/server'
import { corsPreflight } from '@/lib/support-cors'
import { gardeCockpit, repondre } from '@/lib/besoins/garde'
import { modifierBesoin } from '@/lib/besoins/cockpit'

/**
 * POST /api/cockpit/besoins/modifier (besoins des membres, lot 3, 06/11/2026) :
 * { id, titre?, outil?, nature?, noteEquipe? } (noteEquipe vide ou null = effacee).
 * Reponses : 200 { ok } ; 400 ; 401 ; 403 ; 404 ; 503.
 */

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const g = await gardeCockpit(req)
  if (!g.ok) return g.reponse
  return repondre(await modifierBesoin(await req.json().catch(() => null)), g.headers)
}
