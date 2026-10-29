import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { liensAHarmoniser, planFusion, positionDe, totauxParCompte, vuePositions } from '@/lib/positions'
import { dansLesPositions, executionsDuMembre, segmentsDuMembre } from '@/lib/trades-serveur'

/**
 * Les positions du membre pour Pilotage (brief A, 29/10/2026). Tout est borné
 * au userId du jeton. La position importée est la vérité (montants, heures,
 * compte) : elle nourrit « Mon edge » ET la fiche de compte de Pilotage.
 *
 * GET ?compteId=&depuis=&jusqu= : les positions agrégées (toutes si pas de
 * compteId), de la plus récente à la plus ancienne, filtrées sur leur entrée.
 * `depuis` et `jusqu` : date (« 2026-10-01 », jour compris) ou instant ISO.
 * `{ positions, total, parCompte }` ; total = positions rendues ; parCompte =
 * les totaux de chaque compte sur la période (le filtre compteId ne s'y
 * applique pas) : `{ compteId, n, pnl, frais, devise, premierLe, dernierLe }`,
 * premierLe / dernierLe = entrée de la première / dernière position. Un compte
 * en deux monnaies donne deux lignes : on n'additionne pas des dollars et des euros.
 *
 * PATCH, une action, rend `{ positions }` (les positions concernées après coup) :
 * - { action: 'fusionner', ids: [positionId...] } : toutes au membre, même
 *   compte, même symbole, même sens, sinon 400 ;
 * - { action: 'separer', positionId } : chaque exécution redevient sa position
 *   (la plus ancienne garde le lien au Carnet) ;
 * - { action: 'lier', positionId, segmentRef } : segmentRef = l'id d'un segment
 *   d'une note du membre (Note.trades[].id), sinon 404 ; déjà lié à une autre
 *   position : 409 avec son `positionId` ;
 * - { action: 'delier', positionId }.
 * Fusionner et séparer posent positionManuelle : un réimport ne les défait pas.
 */

const METHODES = 'GET, PATCH, OPTIONS'

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

const JOUR_MS = 86_400_000

/** Une borne de date : null si absente, NaN si illisible. `fin` : la borne (exclue) qui suit. */
function lireBorne(brut: string | null, fin: boolean): number | null {
  if (!brut) return null
  const jourSeul = /^\d{4}-\d{2}-\d{2}$/.test(brut)
  const t = Date.parse(jourSeul ? `${brut}T00:00:00Z` : brut)
  if (Number.isNaN(t)) return NaN
  return fin ? t + (jourSeul ? JOUR_MS : 1) : t
}

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req, METHODES)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })

  const p = req.nextUrl.searchParams
  const compteId = p.get('compteId')?.trim() || null
  const depuis = lireBorne(p.get('depuis'), false)
  const jusqu = lireBorne(p.get('jusqu'), true)
  if (Number.isNaN(depuis) || Number.isNaN(jusqu)) {
    return NextResponse.json({ error: 'Date illisible (depuis / jusqu) : « 2026-10-01 » ou un instant ISO.' }, { status: 400, headers: cors })
  }

  try {
    const periode = vuePositions(await executionsDuMembre(userId)).filter(v => {
      const t = Date.parse(v.entreLe)
      return (depuis === null || t >= depuis) && (jusqu === null || t < jusqu)
    })
    const positions = compteId ? periode.filter(v => v.compteId === compteId) : periode
    return NextResponse.json({ positions, total: positions.length, parCompte: totauxParCompte(periode) }, { headers: cors })
  } catch (err) {
    console.error('[pilotage/trades/positions GET]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500, headers: cors })
  }
}

const texte = (brut: unknown) => (typeof brut === 'string' && brut.trim() ? brut.trim().slice(0, 200) : null)

export async function PATCH(req: NextRequest) {
  const cors = corsHeaders(req, METHODES)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })
  const refus = (error: string, status: number) => NextResponse.json({ error }, { status, headers: cors })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return refus('Requête illisible.', 400)
  const action = body.action

  try {
    if (action === 'fusionner') {
      const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(texte).filter(Boolean) as string[])] : []
      if (ids.length < 2 || ids.length > 100) return refus('Il faut entre 2 et 100 positions à fusionner (ids).', 400)
      const executions = await executionsDuMembre(userId, dansLesPositions(ids))
      const trouvees = new Set(executions.map(positionDe))
      if (ids.some(id => !trouvees.has(id))) return refus('Position introuvable.', 404)
      const plan = planFusion(executions)
      if ('erreur' in plan) return refus(plan.erreur, 400)
      await prisma.tradeImport.updateMany({
        where: { userId, id: { in: executions.map(e => e.id) } },
        data: { positionId: plan.positionId, positionManuelle: true, segmentRef: plan.segmentRef },
      })
      const apres = await executionsDuMembre(userId, { id: { in: executions.map(e => e.id) } })
      return NextResponse.json({ positions: vuePositions(apres) }, { headers: cors })
    }

    const positionId = texte(body.positionId)
    if (!positionId) return refus('positionId manquant.', 400)
    if (!['separer', 'lier', 'delier'].includes(action)) return refus('Action inconnue : fusionner, separer, lier ou delier.', 400)
    const executions = await executionsDuMembre(userId, dansLesPositions([positionId]))
    if (executions.length === 0) return refus('Position introuvable.', 404)
    const ids = executions.map(e => e.id)

    if (action === 'separer') {
      // Un segment ne se lie qu'à une position : la plus ancienne exécution le garde.
      for (const e of executions) e.positionId = e.id
      const liens = liensAHarmoniser(executions)
      await prisma.$transaction(executions.map(e => prisma.tradeImport.updateMany({
        where: { userId, id: e.id },
        data: { positionId: e.id, positionManuelle: true, ...(liens.has(e.id) ? { segmentRef: liens.get(e.id) } : {}) },
      })))
    } else if (action === 'lier') {
      const segmentRef = texte(body.segmentRef)
      if (!segmentRef) return refus('segmentRef manquant.', 400)
      const segments = await segmentsDuMembre(userId)
      if (!segments.some(s => s.segmentRef === segmentRef)) return refus('Segment du Carnet introuvable.', 404)
      const ailleurs = await prisma.tradeImport.findFirst({
        where: { userId, segmentRef, id: { notIn: ids } },
        select: { id: true, positionId: true },
      })
      if (ailleurs) {
        return NextResponse.json(
          { error: 'Ce trade du Carnet est déjà lié à une autre position : délie-la d\'abord.', positionId: positionDe(ailleurs) },
          { status: 409, headers: cors },
        )
      }
      await prisma.tradeImport.updateMany({ where: { userId, id: { in: ids } }, data: { segmentRef } })
    } else {
      await prisma.tradeImport.updateMany({ where: { userId, id: { in: ids } }, data: { segmentRef: null } })
    }

    const apres = await executionsDuMembre(userId, { id: { in: ids } })
    return NextResponse.json({ positions: vuePositions(apres) }, { headers: cors })
  } catch (err) {
    console.error('[pilotage/trades/positions PATCH]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500, headers: cors })
  }
}
