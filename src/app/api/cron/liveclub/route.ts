import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { passageQuotidien } from '@/lib/liveclub/passage'

/**
 * GET /api/cron/liveclub : le passage quotidien du Live Club (29/09), lance
 * par le cron Vercel (vercel.json, 7 h UTC). Pauses, acces broker,
 * desabonnes (SIMULES tant que LIVECLUB_SORTIES_ACTIVES n'est pas '1'),
 * rappel J-3 avant chaque prelevement, sorties abusives de Metricgram
 * (signalees, lien de retour en prive), purge des conversations : toute la
 * logique vit dans
 * src/lib/liveclub/passage.ts.
 *
 * Garde : en-tete Authorization: Bearer <CRON_SECRET>, que Vercel envoie tout
 * seul quand CRON_SECRET est pose sur le projet. Sans la variable, tout est
 * refuse. Le middleware laisse passer un Bearer, c'est ici qu'il est verifie.
 *
 * Reponse : la synthese du passage, en comptes seulement (jamais un email,
 * un nom ou un lien).
 */

export const maxDuration = 300
export const dynamic = 'force-dynamic'

function autorise(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    console.warn('[cron/liveclub] CRON_SECRET absent du projet journal : passage refuse.')
    return false
  }
  const recu = Buffer.from(req.headers.get('authorization') ?? '')
  const attendu = Buffer.from(`Bearer ${secret}`)
  return recu.length === attendu.length && timingSafeEqual(recu, attendu)
}

export async function GET(req: NextRequest) {
  if (!autorise(req)) return NextResponse.json({ ok: false, erreur: 'Unauthorized' }, { status: 401 })
  try {
    const synthese = await passageQuotidien()
    return NextResponse.json(synthese)
  } catch (err) {
    // Filet : passageQuotidien rend ses erreurs dans la synthese.
    console.error(`[cron/liveclub] passage interrompu : ${(err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 200)}`)
    return NextResponse.json({ ok: false, erreur: 'Passage interrompu, voir les logs.' }, { status: 500 })
  }
}
