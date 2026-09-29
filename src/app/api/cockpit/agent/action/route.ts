import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { validerAction, executerAction, RefusAction } from '@/lib/stripe-actions'

// Execution d'une action Stripe proposee par l'agent du cockpit — APRES le
// clic de confirmation de Brice ou Melanie. Le modele ne passe jamais par
// ici. Depuis le 29/09 seul compte le carte_id recu avec la carte (l'action
// que le front envoie encore est ignoree) : l'action executee est celle que le
// serveur a memorisee a la proposition (cockpit_agent_cartes), revalidee
// strictement avant tout appel.
//
// USAGE UNIQUE : la carte est consommee par UN update atomique AVANT
// l'execution. Deux requetes pour la meme carte (double clic, second onglet,
// nouvel essai apres une coupure reseau) : la premiere pose consommee_le et
// execute, la seconde ne recupere aucune ligne et repond 409 sans rien faire.
// Contrepartie assumee : une execution en panne perd la carte, il faut la
// redemander a l'agent. On ne rejoue jamais seul un geste parti a moitie.

// 120 s comme /api/cockpit/liveclub/acces : une carte « acces broker » peut
// porter 50 adresses, chacune avec Stripe, la base et Resend.
export const maxDuration = 120

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
  const carteId = typeof body?.carte_id === 'string' ? body.carte_id.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(carteId)) {
    // Un front d'avant le 29/09 n'envoie pas de carte_id : on n'execute rien.
    return NextResponse.json(
      { error: 'Carte sans identifiant : recharge le cockpit et redemande l\'action à l\'agent.' },
      { status: 400, headers: cors },
    )
  }

  const consommee = await prisma.$queryRaw<{ action: unknown }[]>`
    update public.cockpit_agent_cartes
    set consommee_le = now()
    where carte_id = ${carteId}::uuid and user_id = ${userId}::uuid and consommee_le is null
    returning action`
  if (consommee.length === 0) {
    return NextResponse.json(
      { error: 'Cette action n\'est plus en attente : elle a déjà été confirmée une fois, rien n\'a été refait. Regarde le résultat avant de la redemander à l\'agent.' },
      { status: 409, headers: cors },
    )
  }

  const action = validerAction(consommee[0].action)
  if (typeof action === 'string') {
    return NextResponse.json({ error: action }, { status: 400, headers: cors })
  }

  try {
    const resultat = await executerAction(action, `agent:${userId}`)
    // Trace en clair dans les logs Vercel : qui a confirme quoi, quand.
    // Acces broker : le nombre d'adresses, jamais les adresses.
    console.log(`[cockpit/agent/action] ${userId} ${action.type} ${action.compte}`,
      action.type === 'acces_broker' ? { emails: (action.params.emails as string[]).length } : action.params)
    return NextResponse.json({ resultat }, { headers: cors })
  } catch (err) {
    // Refus par une regle (exempte, admin, deja dehors) : rien n'a ete fait.
    // 409 et pas 200, sinon la fenetre du cockpit le coche comme execute.
    if (err instanceof RefusAction) {
      return NextResponse.json({ error: `Rien n'a été fait. ${err.message}` }, { status: 409, headers: cors })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "L'action a échoué" },
      { status: 502, headers: cors },
    )
  }
}
