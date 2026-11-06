import { NextRequest, NextResponse } from 'next/server'
import { corsPreflight } from '@/lib/support-cors'
import { gardeCockpit, repondre } from '@/lib/besoins/garde'
import { apercuPrevenir, prevenirMembres } from '@/lib/besoins/cockpit'
import { lireId } from '@/lib/besoins/cockpit-pur'

// Un envoi par membre (Telegram, email) : plus aucun envoi ne commence apres BUDGET_MS.
export const maxDuration = 300
export const dynamic = 'force-dynamic'
const BUDGET_MS = 240_000

const METHODES = 'GET, POST, OPTIONS'

/**
 * Prevenir les membres d'une carte livree ou refusee (besoins des membres,
 * lot 4, 06/11/2026). Contrat : besoins-contrat-api.md.
 * - GET ?id=<carte> : l'apercu { statut, message, destinataires: [{ demandeId,
 *   libelle, canal }], dejaPrevenus } (un destinataire par MEMBRE pas encore
 *   prevenu). N'envoie rien.
 * - POST { id, message } : l'envoi du message (edite ou non par Brice), une
 *   fois par membre, sur SON clic seulement. Chaque membre est reserve
 *   atomiquement avant l'envoi (double clic sans double envoi), la carte
 *   relue. Reponse { envoyes, echecs, aLaMain, restants, details }.
 * Garde : Bearer Supabase + cockpit_allowlist, CORS (GET et POST au preflight).
 * Reponses : 200 ; 400 (carte ni livree ni refusee, corps) ; 401 ; 403 ; 404 ; 503.
 */

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

export async function GET(req: NextRequest) {
  const g = await gardeCockpit(req, METHODES)
  if (!g.ok) return g.reponse
  const id = lireId(new URL(req.url).searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id requis (uuid).' }, { status: 400, headers: g.headers })
  return repondre(await apercuPrevenir(id), g.headers)
}

export async function POST(req: NextRequest) {
  const g = await gardeCockpit(req, METHODES)
  if (!g.ok) return g.reponse
  return repondre(await prevenirMembres(await req.json().catch(() => null), BUDGET_MS), g.headers)
}
