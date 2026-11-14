import { NextRequest, NextResponse } from 'next/server'
import { enTetesCors, plancher } from '@/lib/connexion-adresse-pur'
import { lireCorps, normaliserEmail } from '@/lib/emails-confirmation-pur'
import { ipDuClient } from '@/lib/academie/pur'
import { reconnaitreServeur } from '@/lib/connexion-adresse'

/**
 * POST /api/connexion/adresse : ce que l'écosystème sait d'une adresse, pour
 * montrer la bonne porte sur la page de connexion du site (14/11/2026, option 3
 * de Brice). Route PUBLIQUE (middleware.ts) : la garde est ici, dans
 * connexion-adresse-pur.ts et dans la fonction SQL aok_connexion_reconnaitre
 * (limites par IP et par adresse, sur des HMAC).
 *
 * Corps : { email }. Réponse : TOUJOURS 200 { reponse } avec
 *   google | connue | inconnue | rattachee | simple
 * (simple : limite atteinte, adresse illisible, base absente ou lente ; la page
 * envoie alors le code). Même délai minimal pour toutes (PLANCHER_MS).
 * Origine hors liste blanche (ou absente) : 403 sans en-tête CORS, préflight
 * compris. Logs : 8 caractères du HMAC de l'adresse et l'issue, jamais l'adresse
 * ni l'IP.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export function OPTIONS(req: NextRequest) {
  const cors = enTetesCors(req.headers.get('origin'))
  return new NextResponse(null, { status: cors ? 204 : 403, headers: cors ?? {} })
}

export async function POST(req: NextRequest) {
  const debut = Date.now()
  const cors = enTetesCors(req.headers.get('origin'))
  if (!cors) return new NextResponse(null, { status: 403 })
  const headers = { ...cors, 'Cache-Control': 'no-store' }

  const corps = lireCorps(await req.text().catch(() => ''))
  const email = normaliserEmail(corps?.email)
  const ip = ipDuClient(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'))
  const r = await reconnaitreServeur(email, ip)
  await plancher(debut)
  return NextResponse.json(r, { status: 200, headers })
}
