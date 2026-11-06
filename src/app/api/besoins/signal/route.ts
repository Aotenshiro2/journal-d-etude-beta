import { NextRequest, NextResponse } from 'next/server'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { getUserId } from '@/lib/api-auth'
import { recevoirSignal } from '@/lib/besoins/signaux'

export const dynamic = 'force-dynamic'

/**
 * POST /api/besoins/signal : un signal de friction d'un de nos outils
 * (besoins des membres, suite du 06/11/2026, choix de Brice « Refus +
 * impasses »). Contrat : besoins-contrat-api.md. Corps : { app, cle, contexte? }.
 *
 * Session FACULTATIVE (Bearer, ou cookie du journal) : sans session, la
 * personne est une empreinte du jour (HMAC), jamais l'adresse IP. La liste des
 * cles est fermee (src/lib/besoins/signaux-pur.ts) : une cle du serveur (bot.*,
 * site.info_absente) est refusee ici. Contexte borne et normalise par cle.
 * Cadence : une fois par heure et par cle, 30 par jour et par personne. Le
 * seuil (3 personnes en 7 jours) s'evalue a l'arrivee du signal.
 * Reponses : 200 { ok: true } (ecrit ou ignore) ; 400 ; 503.
 * Publique dans middleware.ts (chemin exact) : la route ne lit rien pour personne.
 */

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const r = await recevoirSignal(req, () => getUserId(req))
  return NextResponse.json(r.corps, { status: r.status, headers: corsHeaders(req) })
}
