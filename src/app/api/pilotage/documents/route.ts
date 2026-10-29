import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { listerDocuments } from '@/lib/documents-serveur'

/**
 * Le coffre des originaux d'un membre pour Pilotage (brief D1, 30/10/2026).
 *
 * GET rend { documents: [{ id, nom, type, taille, lectureType, compteId,
 * periode: { debut, fin } | null, createdAt }], total, octets }, du plus récent
 * au plus ancien. Ouvrir un original : GET /api/pilotage/documents/:id/lien ;
 * le retirer : DELETE /api/pilotage/documents/:id.
 */

const METHODES = 'GET, OPTIONS'

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req, METHODES)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Non connecté.' }, { status: 401, headers: cors })
  try {
    return NextResponse.json(await listerDocuments(userId), { headers: { ...cors, 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    console.error('[pilotage/documents GET]', err)
    return NextResponse.json({ error: 'Coffre illisible pour le moment, réessaie.' }, { status: 500, headers: cors })
  }
}
