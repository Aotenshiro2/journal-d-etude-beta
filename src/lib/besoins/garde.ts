// LES BESOINS DES MEMBRES, LOTS 2 A 4 (06/11/2026) : les gardes des routes.
//
// - Membres (/api/besoins/*) : la session Supabase AOK (Bearer comme
//   /api/support/chat, cookie pour le journal), CORS des origines AOK. Le
//   compte de la session est le SEUL membre pour qui la route agit.
// - Cockpit (/api/cockpit/besoins/*) : la session ET cockpit_allowlist,
//   comme /api/cockpit/support/traite. 401, 403, 503.
// Les routes en GET partent du navigateur avec Authorization : le preflight
// CORS annonce GET (methodes passees a corsHeaders et corsPreflight).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders } from '@/lib/support-cors'

export type Garde =
  | { ok: true; userId: string; headers: Record<string, string> }
  | { ok: false; reponse: NextResponse }

/** Un membre connecte (sa session). */
export async function gardeMembre(req: NextRequest, methodes?: string): Promise<Garde> {
  const headers = corsHeaders(req, methodes)
  const userId = await getUserId(req)
  if (!userId) return { ok: false, reponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers }) }
  return { ok: true, userId, headers }
}

/** Une personne du cockpit (session + cockpit_allowlist). */
export async function gardeCockpit(req: NextRequest, methodes?: string): Promise<Garde> {
  const headers = corsHeaders(req, methodes)
  const userId = await getUserId(req)
  if (!userId) return { ok: false, reponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers }) }
  try {
    const allow = await prisma.$queryRaw<{ ok: number }[]>`
      select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
    if (allow.length === 0) return { ok: false, reponse: NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers }) }
  } catch {
    return { ok: false, reponse: NextResponse.json({ error: 'Base illisible : réessaie dans un instant.' }, { status: 503, headers }) }
  }
  return { ok: true, userId, headers }
}

/** La reponse JSON d'une fonction du domaine, avec les en-tetes CORS. */
export function repondre(r: { status: number; corps: Record<string, unknown> }, headers: Record<string, string>): NextResponse {
  return NextResponse.json(r.corps, { status: r.status, headers })
}
