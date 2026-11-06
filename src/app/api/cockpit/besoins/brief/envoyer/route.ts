import { NextRequest } from 'next/server'
import { corsPreflight } from '@/lib/support-cors'
import { gardeCockpit, repondre } from '@/lib/besoins/garde'
import { envoyerBrief } from '@/lib/besoins/cockpit'

export const maxDuration = 60

/**
 * POST /api/cockpit/besoins/brief/envoyer (besoins des membres, lot 4,
 * 06/11/2026) : { id }. Depose le brief en note Perso pour Sora
 * (l'Orchestrateur), sujet « [Besoin planifié] <titre> », qui le confie a la
 * bonne conversation. Aucun codeur ne part seul. Une note par version du
 * brief : un second clic rend la meme (deja: true).
 * Reponses : 200 { ok, noteId } ; 400 ; 401 ; 403 ; 404 ; 503.
 */

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const g = await gardeCockpit(req)
  if (!g.ok) return g.reponse
  return repondre(await envoyerBrief(await req.json().catch(() => null)), g.headers)
}
