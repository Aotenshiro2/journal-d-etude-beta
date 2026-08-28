import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { checkMentoratAccess } from '@/lib/entitlements'

/**
 * GET /api/mentorat/access — l'utilisateur connecté a-t-il le mode mentorat ?
 * { entitled, reason: 'manuel'|'liveclub'|'skool-vip'|'skool-premium'|null }
 * L'extension AFFICHE selon cette réponse ; les routes brief/plan RE-VÉRIFIENT
 * côté serveur (un client bidouillé ne contourne rien).
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await checkMentoratAccess(userId)
  return NextResponse.json({ entitled: access.entitled, reason: access.reason })
}
