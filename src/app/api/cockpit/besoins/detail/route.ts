import { NextRequest, NextResponse } from 'next/server'
import { corsPreflight } from '@/lib/support-cors'
import { gardeCockpit, repondre } from '@/lib/besoins/garde'
import { detailBesoin } from '@/lib/besoins/cockpit'
import { lireId } from '@/lib/besoins/cockpit-pur'

export const dynamic = 'force-dynamic'

const METHODES = 'GET, OPTIONS'

/**
 * GET /api/cockpit/besoins/detail?id=<carte> (besoins des membres, lot 3,
 * 06/11/2026) : la carte, ses demandes (texte du membre, membre nomme,
 * capture en URL signee de 10 minutes), le brief. Contrat :
 * besoins-contrat-api.md. Lu a l'ouverture d'une carte.
 * Garde : Bearer Supabase + cockpit_allowlist, CORS (GET annonce au preflight).
 * Reponses : 200 ; 400 ; 401 ; 403 ; 404 ; 503 (base, ou migration 20261106150000 absente).
 */

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

export async function GET(req: NextRequest) {
  const g = await gardeCockpit(req, METHODES)
  if (!g.ok) return g.reponse
  const id = lireId(new URL(req.url).searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id requis (uuid).' }, { status: 400, headers: g.headers })
  return repondre(await detailBesoin(id), g.headers)
}
