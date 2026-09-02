import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'

/**
 * POST /api/cockpit/mentorat : accorder ou retirer le mode mentorat à la main,
 * depuis la fiche membre du cockpit (demande Brice du 28/08).
 *
 * MentoratGrant est une table Prisma verrouillée (RLS, zéro grant navigateur) :
 * le cockpit ne la touche JAMAIS en direct. L’écriture passe par cette route,
 * réservée à l’allowlist du cockpit, exactement comme /api/support/reply.
 *
 * - accorder : crée un grant { email, note } si aucun n’est actif (idempotent).
 * - retirer  : pose revokedAt sur les grants actifs de cet email. Ça ne coupe
 *   PAS un droit automatique (Live Club actif, tier Skool premium/vip, Carnet
 *   Premium) : ces droits se déduisent ailleurs, cf. src/lib/entitlements.ts.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_NOTE_LEN = 500

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  // Le garde réel : l allowlist du cockpit, par UUID. Être authentifié ne
  // prouve rien, le projet Supabase est partagé avec un site public.
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) {
    return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers })
  }

  const body = await req.json().catch(() => ({}))
  const action = body.action
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const note = typeof body.note === 'string' && body.note.trim()
    ? body.note.trim().slice(0, MAX_NOTE_LEN)
    : null

  if ((action !== 'accorder' && action !== 'retirer') || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: 'action (accorder|retirer) et email valide requis' },
      { status: 400, headers },
    )
  }

  if (action === 'accorder') {
    const existant = await prisma.mentoratGrant.findFirst({
      where: { email, revokedAt: null },
    })
    if (existant) {
      return NextResponse.json({ ok: true, deja: true, grant: existant }, { headers })
    }
    const grant = await prisma.mentoratGrant.create({ data: { email, note } })
    return NextResponse.json({ ok: true, grant }, { headers })
  }

  const { count } = await prisma.mentoratGrant.updateMany({
    where: { email, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return NextResponse.json({ ok: true, retires: count }, { headers })
}
