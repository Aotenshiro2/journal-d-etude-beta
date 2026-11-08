import { NextRequest, NextResponse } from 'next/server'
import { ouvrirInvitationServeur } from '@/lib/academie/invitations'

/**
 * GET /api/academie/invitation?j=<jeton> : le lien personnel de l'email d'invitation des membres payants de
 * Skool (passation, 08/11/2026). Route PUBLIQUE (middleware.ts) : le jeton est la preuve.
 *
 * Un clic : jeton hache et retrouve (academie_invitations, non expire), compte cree s'il n'existe pas (email
 * confirme), generateLink 'magiclink', puis 303 vers https://aoknowledge.com/auth/invitation#token_hash=...
 * (fragment), ou la page du site appelle verifyOtp et ouvre l'academie. Le lien reste cliquable jusqu'a
 * expiration (14 jours) : chaque clic genere un nouveau jeton Supabase.
 * Jeton absent, inconnu, expire, adresse d'un autre compte ou panne : 303 vers
 * https://aoknowledge.com/connexion?invitation=invalide|expiree|compte|erreur.
 *
 * HEAD ne fait rien (204) : les antivirus de messagerie sondent souvent les liens par HEAD, et Next.js
 * repondrait sinon avec le GET (compte cree, clic compte).
 * Jamais le jeton dans un log (le masque de Sentry le retire aussi des traces : sentry-masque.ts).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const ENTETES = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

export async function GET(req: NextRequest) {
  const { url } = await ouvrirInvitationServeur(req.nextUrl.searchParams.get('j'))
  return new NextResponse(null, { status: 303, headers: { ...ENTETES, Location: url } })
}

export function HEAD() {
  return new NextResponse(null, { status: 204, headers: ENTETES })
}
