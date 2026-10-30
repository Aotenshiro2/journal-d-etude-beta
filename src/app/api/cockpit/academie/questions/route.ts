import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { lireDemandeCockpit, listerQuestions, questionsDesComptes } from '@/lib/academie/questions-entree'
import { relationAbsente } from '@/lib/liveclub/pur'

/**
 * POST /api/cockpit/academie/questions : les reponses aux QUESTIONS D'ENTREE
 * de l'academie (30/10/2026, src/lib/academie/questions-entree.ts, migration
 * 20261031170000_academie_questions_entree.sql).
 *
 * academie_questions_entree est une table SERVEUR fermee (RLS forcee, aucun
 * droit pour anon ni authenticated) : le cockpit la lit par cette route,
 * reservee a cockpit_allowlist, comme /api/cockpit/academie/billets. Jeton de
 * session du cockpit en Bearer.
 *
 * { action: 'membre', user_ids: [uuid, ...] }   les comptes d'une personne (fiche membre)
 * { action: 'lister', depuis?: ISO, limite?: 1..1000 }   toutes les reponses, les plus recentes d'abord
 *   200 { ok: true, reponses: [{ user_id, version, questions: [q1, q2], reponses: [r1|null, r2|null],
 *         passe, repondu_le }] }
 * 400 { error } ; 401 ; 403 hors allowlist ;
 * 503 { error, code: 'migration' } table absente, ou { error } base indisponible.
 *
 * Logs : l'action et un nombre de lignes. Jamais une reponse, un email ni un identifiant complet.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  // Reponses personnelles : jamais en cache.
  const headers: Record<string, string> = { ...corsHeaders(req), 'Cache-Control': 'no-store' }
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  // Le garde reel : l'allowlist du cockpit (projet Supabase partage avec un site public).
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers })

  const corps: unknown = await req.json().catch(() => ({}))
  const demande = lireDemandeCockpit(corps)
  if ('erreur' in demande) return NextResponse.json({ error: demande.erreur }, { status: 400, headers })

  try {
    const reponses = demande.action === 'membre'
      ? await questionsDesComptes(prisma, demande.userIds)
      : await listerQuestions(prisma, demande.depuis, demande.limite)
    console.info(`[cockpit/academie/questions] ${demande.action} : ${reponses.length} ligne(s)`)
    return NextResponse.json({ ok: true, reponses }, { headers })
  } catch (err) {
    if (relationAbsente(err)) {
      return NextResponse.json(
        { error: "Migration des questions d'entrée pas encore appliquée (20261031170000).", code: 'migration' },
        { status: 503, headers },
      )
    }
    // Jamais le message brut.
    console.error(`[cockpit/academie/questions] ${demande.action} : echec (${err instanceof Error ? err.name : 'erreur'})`)
    return NextResponse.json({ error: 'La base est illisible pour le moment.' }, { status: 503, headers })
  }
}
