import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { vuePositions } from '@/lib/positions'
import { executionsDuMembre } from '@/lib/trades-serveur'
import { segmentsLus } from '@/lib/carnet-sur-positions'
import { lireBorne, synthetiser } from '@/lib/synthese-trades-pur'
import { IMAGE_TYPES } from '@/lib/utils'

/**
 * La synthèse des trades du membre (brief J1, J4, 05/11/2026), en LECTURE
 * seule : le « prévu » tapé dans le Carnet face à l'« effectif » du broker. Lue
 * par l'écran « Mes trades » (/journal, brief J2) ; des données propres,
 * lisibles par API. Auth getUserId : cookie du journal ou Bearer du Carnet ;
 * CORS comme les routes de Pilotage. Tout est borné au userId du jeton.
 *
 * GET ?depuis=&jusqu= : date (« 2026-10-01 », jour compris) ou instant ISO,
 * sur le startedAt des trades du Carnet et l'entrée des positions sans note.
 * Rend `{ trades, positionsSansNote, resume }` (synthese-trades-pur.ts) :
 * chaque trade du Carnet de la période (Note.trades, notes non supprimées) avec
 * son prévu (prix tapés, rPrevu), son effectif (positions liées par segmentRef,
 * les copies sur plusieurs comptes comprises), les écarts, le ressenti (warmup
 * de la note le plus proche avant le trade, cooldown du trade), le dernier
 * jugement et ses captures (blocs image de la note rattachés au trade, URL
 * http(s) seulement) ; les positions du broker de la période sans trade du
 * Carnet ; le résumé. Brief J2 : chaque trade porte son `ordre` dans la note,
 * et l'effectif ses `sorties` (les exécutions d'un compte : sorties partielles).
 */

const METHODES = 'GET, OPTIONS'

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req, METHODES)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Non connecté.' }, { status: 401, headers: cors })

  const p = req.nextUrl.searchParams
  const depuis = lireBorne(p.get('depuis'), false)
  const jusqu = lireBorne(p.get('jusqu'), true)
  if (Number.isNaN(depuis) || Number.isNaN(jusqu)) {
    return NextResponse.json({ error: 'Date illisible (depuis / jusqu) : « 2026-10-01 » ou un instant ISO.' }, { status: 400, headers: cors })
  }
  const periode = { depuis, jusqu }

  try {
    const [executions, notes] = await Promise.all([
      executionsDuMembre(userId),
      prisma.note.findMany({ where: { userId, deletedAt: null }, select: { id: true, title: true, trades: true, warmups: true } }),
    ])
    // Les jugements et les captures des seuls trades de la période.
    const refs = [...segmentsLus(notes).values()]
      .filter(s => (depuis === null || s.startedAt >= depuis) && (jusqu === null || s.startedAt < jusqu))
      .map(s => s.segmentRef)
    const [jugements, messages] = refs.length === 0 ? [[], []] : await Promise.all([
      prisma.annotation.findMany({
        where: { userId, tradeRef: { in: refs } },
        orderBy: { createdAt: 'asc' },
        select: { tradeRef: true, grade: true, causeCategory: true, phrase: true, createdAt: true },
      }),
      prisma.message.findMany({
        where: { tradeRef: { in: refs }, type: { in: [...IMAGE_TYPES] }, note: { userId, deletedAt: null } },
        orderBy: [{ noteId: 'asc' }, { order: 'asc' }],
        select: { id: true, tradeRef: true, content: true },
      }),
    ])
    const synthese = synthetiser({
      notes,
      positions: vuePositions(executions),
      jugements,
      captures: messages.map(m => ({ messageId: m.id, tradeRef: m.tradeRef, contenu: m.content })),
      periode,
      executions,
    })
    return NextResponse.json(synthese, { headers: cors })
  } catch (err) {
    console.error('[trades/synthese GET]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500, headers: cors })
  }
}
