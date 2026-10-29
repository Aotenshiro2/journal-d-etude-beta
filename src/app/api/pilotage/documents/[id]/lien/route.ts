import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { lienDocument } from '@/lib/documents-serveur'

/**
 * GET /api/pilotage/documents/:id/lien (brief D1, 30/10/2026) : { url },
 * une URL signée de 10 minutes vers l'original, seulement pour un document du
 * membre (celui d'un autre répond 404, comme un id inconnu).
 */

const METHODES = 'GET, OPTIONS'
const RE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cors = corsHeaders(req, METHODES)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Non connecté.' }, { status: 401, headers: cors })
  const { id } = await params
  if (!RE_ID.test(id)) return NextResponse.json({ error: 'Document introuvable.' }, { status: 404, headers: cors })
  try {
    const lien = await lienDocument(userId, id)
    if ('absent' in lien) return NextResponse.json({ error: 'Document introuvable.' }, { status: 404, headers: cors })
    if ('erreur' in lien) return NextResponse.json({ error: lien.erreur }, { status: 502, headers: cors })
    return NextResponse.json({ url: lien.url }, { headers: { ...cors, 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    console.error('[pilotage/documents/lien GET]', err)
    return NextResponse.json({ error: "L'original ne s'ouvre pas pour le moment, réessaie." }, { status: 500, headers: cors })
  }
}
