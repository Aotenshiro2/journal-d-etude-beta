import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { lireColonnes, parserFichierTrades, separerNouveaux } from '@/lib/imports-trades'
import { confirmerImport, supprimerExecutions } from '@/lib/trades-serveur'

// Un gros export (5 Mo) se lit, se dédoublonne et se regroupe en quelques
// secondes : plus que les 10 s par défaut d'une fonction Vercel par prudence.
export const maxDuration = 60

/**
 * Import des trades d'un membre pour Pilotage (brief A, 29/10/2026).
 *
 * Les trades restent sur le compte AOK du membre (table TradeImport du
 * journal) : un reset de compte propfirm ne les efface pas. Pilotage les
 * rattache à un de SES comptes (`compteId`, chaîne opaque pour le journal) et
 * calcule lui-même ses ratios à partir de GET /api/pilotage/trades/positions.
 *
 * POST { csv, fichier?, compteId, colonnes?, confirmer? }
 * - sans `confirmer` : APERÇU, rien n'est écrit. `{ format, lus, nouveaux,
 *   dejaConnus, erreurs, entetes?, proposition?, apercu }` (30 premières
 *   exécutions). Un CSV inconnu sans `colonnes` rend `entetes` et une
 *   `proposition` de correspondance : l'écran la fait valider puis renvoie
 *   avec `colonnes`.
 * - `confirmer: true` (compteId obligatoire) : insertion des nouvelles
 *   exécutions seulement (dédoublonnage (userId, source, idExterne)),
 *   regroupement en positions, rapprochement avec le Carnet.
 *   `{ importes, positions, correspondances: [{ positionId, candidats:
 *   [{ segmentRef, noteId, noteTitle, ordre, startedAt, closedAt }] }], liees }`
 *   (ordre = place du segment dans sa note, à partir de 1 ; instants en ms,
 *   comme dans le Carnet).
 *
 * DELETE { compteId?, source? } : retire les exécutions du membre (fausse
 * manip, fichier de test). Sans filtre : toutes. Corps illisible : 400, rien
 * n'est retiré.
 */

const METHODES = 'POST, DELETE, OPTIONS'

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

/** Une chaîne courte non vide, sinon null. */
function texte(brut: unknown, max = 200): string | null {
  return typeof brut === 'string' && brut.trim() ? brut.trim().slice(0, max) : null
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req, METHODES)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Requête illisible.' }, { status: 400, headers: cors })
    const csv = typeof body.csv === 'string' ? body.csv : ''
    const fichier = texte(body.fichier)
    const compteId = texte(body.compteId)
    const colonnes = lireColonnes(body.colonnes)
    const confirmer = body.confirmer === true
    if (!csv.trim()) return NextResponse.json({ error: 'Fichier vide.' }, { status: 400, headers: cors })
    if (csv.length > 5_000_000) return NextResponse.json({ error: 'Fichier trop gros (5 Mo max).' }, { status: 400, headers: cors })
    if (confirmer && !compteId) return NextResponse.json({ error: 'Compte Pilotage manquant (compteId).' }, { status: 400, headers: cors })

    const { format, trades, erreurs, entetes, proposition } = parserFichierTrades(csv, fichier ?? undefined, colonnes)
    const lecture = { format, erreurs, ...(entetes ? { entetes } : {}), ...(proposition ? { proposition } : {}) }
    if (trades.length === 0) {
      return NextResponse.json(
        { ...lecture, lus: 0, nouveaux: 0, dejaConnus: 0, apercu: [], ...(confirmer ? { importes: 0, positions: [], correspondances: [], liees: 0 } : {}) },
        { headers: cors },
      )
    }

    // Qui est déjà en base ? (clé de dédup, bornée à ce membre, tous comptes
    // confondus : un trade n'appartient qu'à un compte)
    const existants = await prisma.tradeImport.findMany({
      where: { userId, source: trades[0].source, idExterne: { in: trades.map(t => t.idExterne) } },
      select: { idExterne: true },
    })
    const connus = new Set(existants.map(e => e.idExterne))
    const nouveaux = separerNouveaux(trades, connus)
    const comptes = { ...lecture, lus: trades.length, nouveaux: nouveaux.length, dejaConnus: trades.length - nouveaux.length }

    if (!confirmer) {
      return NextResponse.json({
        ...comptes,
        apercu: trades.slice(0, 30).map(t => ({
          symbole: t.symbole,
          direction: t.direction,
          quantite: t.quantite,
          entreLe: t.entreLe.toISOString(),
          sortiLe: t.sortiLe ? t.sortiLe.toISOString() : null,
          prixEntree: t.prixEntree,
          prixSortie: t.prixSortie,
          pnl: t.pnl,
          frais: t.frais,
          devise: t.devise,
          fuseau: t.fuseau ?? null,
          stopPrix: t.stopPrix ?? null,
          nouveau: !connus.has(t.idExterne),
        })),
      }, { headers: cors })
    }

    const resultat = await confirmerImport(userId, compteId, nouveaux, fichier)
    return NextResponse.json({ ...comptes, ...resultat }, { headers: cors })
  } catch (err) {
    console.error('[pilotage/trades/import POST]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500, headers: cors })
  }
}

export async function DELETE(req: NextRequest) {
  const cors = corsHeaders(req, METHODES)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })

  // Un corps qui ne se lit pas ne doit JAMAIS valoir « tout retirer ».
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: "Requête illisible : rien n'a été retiré." }, { status: 400, headers: cors })
  }
  try {
    const supprimes = await supprimerExecutions(userId, { compteId: texte(body.compteId), source: texte(body.source) })
    return NextResponse.json({ supprimes }, { headers: cors })
  } catch (err) {
    console.error('[pilotage/trades/import DELETE]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500, headers: cors })
  }
}
