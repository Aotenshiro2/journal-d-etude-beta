import { NextRequest, NextResponse } from 'next/server'
import { baseDuLien, cheminRetourSur, enTetesCors, plancher } from '@/lib/connexion-adresse-pur'
import { lireCorps, normaliserEmail } from '@/lib/emails-confirmation-pur'
import { ipDuClient } from '@/lib/academie/pur'
import { envoyerServeur } from '@/lib/connexion-adresse'

/**
 * POST /api/connexion/envoi : envoie le code de connexion à 6 chiffres et le
 * lien, par Resend (14/11/2026, page de connexion du site, fenêtre d'achat,
 * /acces-club). Route PUBLIQUE (middleware.ts) : la garde est ici, dans
 * connexion-adresse-pur.ts et dans la fonction SQL aok_connexion_envoi
 * (adresse rattachée en secondaire refusée, adresse inconnue sans « creer »
 * refusée, 60 s par adresse, limites par adresse et par IP, plafond de 90
 * emails sur 24 h partagé avec les invitations et les codes d'adresse).
 *
 * Corps : { email, creer?, newsletter?, retour?, origine? }. origine : la page
 * où revient le lien de l'email, sur la liste blanche (ORIGINES), sinon
 * l'origine de la requête. Réponse : TOUJOURS 200 { envoi, secondes? } avec
 *   ok | delai (secondes) | plafond | limite | rattachee | inconnue | invalide
 *   | indisponible (variables, base, Supabase ou Resend : la page passe au repli)
 * Un refus de la base n'appelle ni generateLink ni Resend. Origine hors liste
 * (ou absente) : 403 sans en-tête CORS. Logs : 8 caractères du HMAC de
 * l'adresse et l'issue, jamais l'adresse, l'IP, le code ni le jeton.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export function OPTIONS(req: NextRequest) {
  const cors = enTetesCors(req.headers.get('origin'))
  return new NextResponse(null, { status: cors ? 204 : 403, headers: cors ?? {} })
}

export async function POST(req: NextRequest) {
  const debut = Date.now()
  const origin = req.headers.get('origin')
  const cors = enTetesCors(origin)
  if (!cors) return new NextResponse(null, { status: 403 })
  const headers = { ...cors, 'Cache-Control': 'no-store' }

  const corps = lireCorps(await req.text().catch(() => ''))
  const r = await envoyerServeur({
    email: normaliserEmail(corps?.email),
    ip: ipDuClient(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip')),
    creer: corps?.creer === true,
    newsletter: corps?.newsletter === true,
    retour: cheminRetourSur(corps?.retour),
    base: baseDuLien(corps?.origine, origin),
  })
  await plancher(debut)
  return NextResponse.json(r, { status: 200, headers })
}
