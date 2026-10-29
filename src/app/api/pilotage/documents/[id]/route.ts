import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { supprimerDocument } from '@/lib/documents-serveur'

/**
 * DELETE /api/pilotage/documents/:id (brief D1, 30/10/2026) : retire
 * l'original du coffre puis sa ligne. Seulement un document du membre : celui
 * d'un autre répond 404, comme un id inconnu. Si le stockage refuse, la ligne
 * reste (502) pour qu'on puisse réessayer.
 */

const METHODES = 'DELETE, OPTIONS'
const RE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cors = corsHeaders(req, METHODES)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Non connecté.' }, { status: 401, headers: cors })
  const { id } = await params
  if (!RE_ID.test(id)) return NextResponse.json({ error: 'Document introuvable.' }, { status: 404, headers: cors })
  try {
    const resultat = await supprimerDocument(userId, id)
    if (resultat === 'absent') return NextResponse.json({ error: 'Document introuvable.' }, { status: 404, headers: cors })
    if (resultat === 'erreur') {
      return NextResponse.json({ error: "L'original n'a pas pu être retiré, réessaie." }, { status: 502, headers: cors })
    }
    return NextResponse.json({ supprime: true }, { headers: cors })
  } catch (err) {
    console.error('[pilotage/documents DELETE]', err)
    return NextResponse.json({ error: 'Suppression impossible pour le moment, réessaie.' }, { status: 500, headers: cors })
  }
}
