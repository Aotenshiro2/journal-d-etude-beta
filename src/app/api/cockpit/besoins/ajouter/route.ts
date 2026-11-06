import { NextRequest } from 'next/server'
import { corsPreflight } from '@/lib/support-cors'
import { gardeCockpit, repondre } from '@/lib/besoins/garde'
import { ajouterBesoin } from '@/lib/besoins/cockpit'

export const maxDuration = 60

/**
 * POST /api/cockpit/besoins/ajouter (besoins des membres, lot 3, 06/11/2026) :
 * une demande dite hors de nos outils, saisie par l'equipe. Corps : { texte,
 * source, contact?: { nom?, email?, telegram? }, carteId?, outil?, nature?,
 * titre? }. Sans carteId : classement IA (sauf texte suspect) + regroupement.
 * Canal equipe, detecte_par equipe.
 * Reponses : 200 { ok, carte: { id, cle, titre, nouvelle } } ; 400 ; 401 ; 403 ; 404 ; 503.
 */

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const g = await gardeCockpit(req)
  if (!g.ok) return g.reponse
  return repondre(await ajouterBesoin(g.userId, await req.json().catch(() => null)), g.headers)
}
