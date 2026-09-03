import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { validerAction, executerAction } from '@/lib/stripe-actions'

// Execution d'une action Stripe proposee par l'agent du cockpit — APRES le
// clic de confirmation de Brice ou Melanie. Le modele ne passe jamais par
// ici : le front envoie l'action telle qu'affichee sur la carte, et la
// validation stricte est rejouee cote serveur avant tout appel Stripe.

export const maxDuration = 30

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const cors: Record<string, string> = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })

  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) {
    return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers: cors })
  }

  const body = await req.json().catch(() => ({}))
  const action = validerAction(body?.action)
  if (typeof action === 'string') {
    return NextResponse.json({ error: action }, { status: 400, headers: cors })
  }

  try {
    const resultat = await executerAction(action)
    // Trace en clair dans les logs Vercel : qui a confirme quoi, quand.
    console.log(`[cockpit/agent/action] ${userId} ${action.type} ${action.compte}`, action.params)
    return NextResponse.json({ resultat }, { headers: cors })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "L'action a échoué" },
      { status: 502, headers: cors },
    )
  }
}
