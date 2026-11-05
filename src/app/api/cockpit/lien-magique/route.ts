import { NextRequest, NextResponse, after } from 'next/server'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { lireCorps, normaliserEmail } from '@/lib/emails-confirmation-pur'
import { ipDuClient } from '@/lib/academie/pur'
import { demanderLienCockpit } from '@/lib/cockpit-lien-magique'

/**
 * POST /api/cockpit/lien-magique : demander un lien de connexion au COCKPIT
 * (05/11, Brice : toute adresse verifiee du compte doit ouvrir le cockpit, pas
 * seulement l'email de connexion). Route PUBLIQUE (middleware.ts) : la garde
 * est ici et dans cockpit-lien-magique-pur.ts.
 *
 * Corps : { email }. Un lien part a CETTE adresse seulement si elle est
 * l'email de connexion confirme, ou une adresse verified = true de
 * profile_emails, d'un compte de cockpit_allowlist. Jamais de creation de
 * compte, jamais d'envoi a une autre adresse que celle tapee.
 *
 * Reponses :
 *   200 { ok: true, message, minutes }   TOUJOURS la meme, adresse connue ou non
 *   400 'email'                          adresse illisible (format, longueur, caractere interdit)
 *   429 'limite'                         trop de demandes pour cette adresse, cette IP ou au total
 *                                        (vaut pour toute adresse, connue ou non : ne dit rien du compte)
 *   503 'config' | 'indisponible' | 'coupe' (COCKPIT_LIEN_MAGIQUE=off)
 *                                        le cockpit retombe alors sur signInWithOtp
 * L'email et l'alerte de rafale partent APRES la reponse (after) : le temps
 * de reponse ne dit pas non plus si l'adresse est connue.
 * Logs : 8 caracteres du HMAC de l'adresse et de l'IP, l'issue. JAMAIS
 * l'adresse, l'IP ni le lien.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = { ...corsHeaders(req), 'Cache-Control': 'no-store' }

  const corps = lireCorps(await req.text().catch(() => ''))
  const email = normaliserEmail(corps?.email)
  if (!email) return NextResponse.json({ ok: false, erreur: 'email' }, { status: 400, headers })

  const ip = ipDuClient(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'))
  const r = await demanderLienCockpit(email, ip)
  if (r.apres) after(r.apres)
  return NextResponse.json(r.reponse.corps, { status: r.reponse.status, headers })
}
