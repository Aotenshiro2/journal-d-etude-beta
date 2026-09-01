import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { buildMentoratBrief, lireCadrage } from '@/lib/mentorat-brief'
import { checkMentoratAccess } from '@/lib/entitlements'

/**
 * GET /api/mentorat/brief?days=90&dossiers=id1,id2 — le brief compressé de l'élève connecté.
 * Étape 1 du mode mentorat : calcul pur depuis la base, aucun jeton IA.
 *
 * Auth : Bearer (extension) ou session SSR (journal), comme les autres routes.
 * ⚠️ Pas encore de gating d'abonnement mentorat : il viendra avec Stripe et
 * le contrôle d'accès par la base (décision Brice 17/07 : l'extension ne
 * décide jamais, le backend vérifie). Pour l'instant la route ne sert que
 * les données de l'utilisateur authentifié : aucune fuite possible.
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Mode mentorat réservé aux membres (Live Club, Skool premium/vip, accès
  // manuel) — vérifié CÔTÉ SERVEUR, l'extension ne décide jamais
  const access = await checkMentoratAccess(userId)
  if (!access.entitled) {
    return NextResponse.json({ error: 'mentorat_requis' }, { status: 403 })
  }

  const raw = Number(req.nextUrl.searchParams.get('days'))
  const days = Number.isFinite(raw) ? Math.min(365, Math.max(7, Math.round(raw))) : 90

  try {
    const dossiers = lireCadrage(req.nextUrl.searchParams.get('dossiers'))
    const brief = await buildMentoratBrief(userId, days, dossiers)
    return NextResponse.json(brief)
  } catch (err) {
    console.error('[mentorat/brief]', err)
    return NextResponse.json({ error: 'Brief indisponible' }, { status: 500 })
  }
}
