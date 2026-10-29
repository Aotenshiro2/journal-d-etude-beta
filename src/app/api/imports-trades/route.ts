import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { parserFichierTrades, separerNouveaux } from '@/lib/imports-trades'
import { appliquerFuseau, fuseauDemande } from '@/lib/fuseau'
import { confirmerImport, supprimerExecutions } from '@/lib/trades-serveur'

/**
 * POST /api/imports-trades — analyse puis import d'un fichier de trades.
 * Body : { csv: string, fichier?: string, fuseau?: string, confirmer?: boolean }
 * - fuseau (IANA, « Europe/Paris », facultatif, 30/10/2026) : les heures
 *   « telles qu'affichées » y sont lues pour en faire de vrais instants ;
 *   inconnu = 400 ; absent = comportement d'avant.
 * - confirmer absent/false → APERÇU seulement : rien n'est écrit. La réponse
 *   dit combien de trades sont lus, combien sont nouveaux, combien déjà
 *   connus (dédup par (source, idExterne)) — la garantie « réimporter le
 *   même fichier n'ajoute rien ».
 * - confirmer: true → insère les nouveaux uniquement (skipDuplicates), sans
 *   compte Pilotage, puis les regroupe en positions et les rapproche du Carnet
 *   comme l'import de Pilotage (29/10/2026) ; la réponse ne change pas.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const csv = typeof body.csv === 'string' ? body.csv : ''
    const fichier = typeof body.fichier === 'string' ? body.fichier.slice(0, 200) : null
    const confirmer = body.confirmer === true
    const fuseau = fuseauDemande(body.fuseau)
    if ('erreur' in fuseau) return NextResponse.json({ error: fuseau.erreur }, { status: 400 })
    if (!csv.trim()) return NextResponse.json({ error: 'Fichier vide.' }, { status: 400 })
    if (csv.length > 5_000_000) return NextResponse.json({ error: 'Fichier trop gros (5 Mo max).' }, { status: 400 })

    const lu = parserFichierTrades(csv, fichier ?? undefined)
    const { format, erreurs } = lu
    const trades = fuseau.fuseau ? appliquerFuseau(lu.trades, fuseau.fuseau) : lu.trades
    if (trades.length === 0) {
      return NextResponse.json({ format, lus: 0, nouveaux: 0, dejaConnus: 0, importes: 0, erreurs, apercu: [] })
    }

    // Qui est déjà en base ? (clé de dédup, bornée à ce membre)
    const existants = await prisma.tradeImport.findMany({
      where: { userId, source: trades[0].source, idExterne: { in: trades.map(t => t.idExterne) } },
      select: { idExterne: true },
    })
    const connus = new Set(existants.map(e => e.idExterne))
    const nouveaux = separerNouveaux(trades, connus)

    let importes = 0
    if (confirmer && nouveaux.length > 0) {
      importes = (await confirmerImport(userId, null, nouveaux, fichier)).importes
    }

    return NextResponse.json({
      format,
      lus: trades.length,
      nouveaux: nouveaux.length,
      dejaConnus: trades.length - nouveaux.length,
      importes,
      erreurs,
      apercu: trades.slice(0, 30).map(t => ({
        symbole: t.symbole,
        direction: t.direction,
        quantite: t.quantite,
        entreLe: t.entreLe.toISOString(),
        pnl: t.pnl,
        devise: t.devise,
        nouveau: !connus.has(t.idExterne),
      })),
    })
  } catch (err) {
    console.error('[API /imports-trades POST]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 })
  }
}

/** GET — l'état des imports du membre : total, par source, derniers trades. */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [total, parSource, recents] = await Promise.all([
    prisma.tradeImport.count({ where: { userId } }),
    prisma.tradeImport.groupBy({ by: ['source'], where: { userId }, _count: { _all: true } }),
    prisma.tradeImport.findMany({
      where: { userId },
      orderBy: { entreLe: 'desc' },
      take: 20,
      select: { symbole: true, direction: true, quantite: true, entreLe: true, pnl: true, devise: true, source: true, fichier: true },
    }),
  ])

  return NextResponse.json({
    total,
    parSource: parSource.map(s => ({ source: s.source, n: s._count._all })),
    recents,
  })
}

/**
 * DELETE — retirer ses imports (fausse manip, fichier de test).
 * Body : { source?: string } — sans source, tout est retiré. Borné au membre.
 */
export async function DELETE(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const source = typeof body.source === 'string' && body.source ? body.source : null
  // Retire, puis regroupe ce qui reste à côté (une exécution retirée pouvait relier deux autres).
  return NextResponse.json({ supprimes: await supprimerExecutions(userId, { source }) })
}
