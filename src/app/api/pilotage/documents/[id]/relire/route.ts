import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { finaliserLecture, lireComptes, natureDuDocument, preparerLecture } from '@/lib/documents-pilotage'
import { extraireTextePdf, originalDocument } from '@/lib/documents-serveur'
import { texteDuClasseur } from '@/lib/classeur-xlsx'

export const maxDuration = 30

/**
 * POST /api/pilotage/documents/:id/relire (Pilotage 0.4, 10/11/2026, « Relire
 * mes documents ») : l'original du coffre relu avec le lecteur à jour, SANS IA.
 *
 * Corps : { comptes?: [{ id, nom, firmName?, brokerName?, identifiants? }] }
 * (les comptes de Pilotage, pour le rapprochement, comme `lire`).
 * Rend { lecture, empreintes, document } quand un lecteur sans aide reconnaît
 * le document ; { lecture: null, avecAide: true, document } quand il faudrait
 * une lecture intelligente : elle n'est PAS faite ici (aucune lecture comptée,
 * le membre redépose le fichier s'il la veut).
 *
 * Lecture seule : rien n'est écrit, ni dans le coffre ni dans la table ; Pilotage
 * propose ce qui est nouveau et le membre valide (doctrine du 25/09).
 * Le document d'un autre membre répond 404, comme un id inconnu.
 */

const METHODES = 'POST, OPTIONS'
const RE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cors = corsHeaders(req, METHODES)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Non connecté.' }, { status: 401, headers: cors })
  const { id } = await params
  if (!RE_ID.test(id)) return NextResponse.json({ error: 'Document introuvable.' }, { status: 404, headers: cors })
  const body = await req.json().catch(() => ({}))
  const comptes = lireComptes(body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).comptes : null)

  try {
    const original = await originalDocument(userId, id)
    if ('absent' in original) return NextResponse.json({ error: 'Document introuvable.' }, { status: 404, headers: cors })
    if ('erreur' in original) return NextResponse.json({ error: original.erreur }, { status: 502, headers: cors })
    const { nom, type, taille, octets } = original
    const document = { id, nom, taille, type }
    const nature = natureDuDocument(nom, type, octets)
    const textePdf = nature.famille === 'pdf' ? await extraireTextePdf(octets) : null
    const classeur = nature.famille === 'classeur' ? texteDuClasseur(octets) : null
    const prep = preparerLecture({ nom, nature, octets, textePdf, classeur })
    if (!('lecture' in prep)) return NextResponse.json({ lecture: null, avecAide: true, document }, { headers: cors })
    const fin = finaliserLecture(prep.lecture, comptes)
    return NextResponse.json({ lecture: fin.lecture, empreintes: fin.empreintes, document }, { headers: cors })
  } catch (err) {
    console.error('[pilotage/documents/relire]', err)
    return NextResponse.json({ error: 'Relecture impossible pour le moment, réessaie.' }, { status: 500, headers: cors })
  }
}
