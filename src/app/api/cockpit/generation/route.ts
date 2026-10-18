import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { lireDemandeGeneration } from '@/lib/generation-pur'
import { genererPost } from '@/lib/generation'

/**
 * POST /api/cockpit/generation : l'ecran Generation de l'onglet Creation du
 * cockpit (19/10/2026). Ecrit un brouillon de post dans la voix de Brice ou
 * de Mel, a partir d'une idee (sens idee) ou d'une capture (sens capture,
 * image en base64, jamais stockee), le range dans cockpit_generations et le
 * rend. Regenerer et retoucher passent par la meme route (parent_id, et
 * consigne pour une retouche). Rien n'est publie : le brouillon se
 * copie-colle, la note (publie tel quel, retouche, jete) s'ecrit depuis
 * l'ecran (grant update de la table).
 *
 * Garde : jeton Supabase en Bearer + allowlist du cockpit par UUID, comme
 * /api/cockpit/creation. Etre authentifie ne prouve rien.
 */

export const maxDuration = 300

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) {
    return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers })
  }

  const demande = lireDemandeGeneration(await req.json().catch(() => null))
  if (typeof demande === 'string') return NextResponse.json({ error: demande }, { status: 400, headers })

  const r = await genererPost(demande, userId, 'cockpit')
  if (!r.ok) return NextResponse.json({ error: r.erreur }, { status: r.status, headers })
  return NextResponse.json(
    { ok: true, id: r.id, contenu: r.contenu, envoyees: r.envoyees, cout_micros: r.cout_micros },
    { headers },
  )
}
