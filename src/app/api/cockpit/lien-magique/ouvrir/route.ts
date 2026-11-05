import { NextRequest, NextResponse } from 'next/server'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { lireCorps } from '@/lib/emails-confirmation-pur'
import { ouvrirLienCockpit } from '@/lib/cockpit-lien-magique'

/**
 * POST /api/cockpit/lien-magique/ouvrir : ouvrir un lien de connexion au
 * cockpit (05/11). Route PUBLIQUE (meme prefixe que /api/cockpit/lien-magique
 * dans middleware.ts) : la page /auth/lien du cockpit l'appelle au clic sur
 * « Ouvrir le Cockpit ».
 *
 * Corps : { lien } (le jeton de 43 caracteres du lien recu par email).
 * Le jeton est consomme (une seule ouverture, 15 minutes), le compte relu
 * (toujours dans cockpit_allowlist, adresse toujours verifiee), puis le
 * serveur genere le jeton Supabase (generateLink 'recovery', qui ne cree
 * jamais de compte) et rend son token_hash. Le cockpit appelle
 * verifyOtp({ token_hash, type }) : la session s'ouvre dans CE navigateur,
 * quel que soit l'appareil qui a demande le lien.
 *
 * Reponses :
 *   200 { ok: true, token_hash, type: 'recovery' }
 *   400 'lien'                     jeton illisible
 *   404 'inconnu'                  aucun lien de ce jeton
 *   410 'expire' | 'utilise'
 *   403 'refuse'                   compte sorti de l'allowlist, ou adresse plus verifiee
 *   502 'generation'               Supabase n'a pas rendu de jeton (ou un jeton pour un autre compte)
 *   503 'config' | 'indisponible' | 'coupe' (COCKPIT_LIEN_MAGIQUE=off)
 * Jamais le jeton ni le token_hash dans un log. Cache-Control: no-store.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = { ...corsHeaders(req), 'Cache-Control': 'no-store' }
  const corps = lireCorps(await req.text().catch(() => ''))
  const r = await ouvrirLienCockpit(corps?.lien)
  return NextResponse.json(r.corps, { status: r.status, headers })
}
