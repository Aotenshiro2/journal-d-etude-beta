import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { contexteParis, repartitionPourCockpit } from '@/lib/repartition/serveur'
import { moisValide } from '@/lib/repartition/pur'

/**
 * POST /api/cockpit/repartition : la repartition Brice / Melanie d'un mois,
 * pour l'onglet Revenus du cockpit (08/10/2026). LECTURE seulement.
 *
 * Le calcul (cotes, 70/30, frais, intervenants, commissions recues,
 * depenses, reglements, solde) ne vit qu'une fois, dans
 * src/lib/repartition/pur.ts : l'agent du cockpit (outil
 * repartition_du_mois) et cet ecran lisent le meme resultat, et le cockpit
 * n'embarque aucune regle de partage dans son bundle (servi sans session).
 * Les ECRITURES du cockpit (depenses, taux, intervenants, reglements, statut
 * d'une commission) passent par Supabase, derriere is_cockpit_member() ;
 * l'inscription d'un depot passe par l'agent (carte confirmee).
 *
 * Corps : { mois?: 'YYYY-MM' } (vide = mois en cours, heure de Paris).
 * Reponse : { ok: true, ...repartitionPourCockpit } ou { ok: false, erreur }.
 * Tables pas encore en base : listes vides, nommees dans tables_absentes.
 *
 * Meme garde que /api/cockpit/liveclub/acces : Bearer Supabase +
 * cockpit_allowlist, CORS des origines AOK.
 */

export const maxDuration = 30

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = corsHeaders(req)
  const refus = (erreur: string, status: number) =>
    NextResponse.json({ ok: false, erreur }, { status, headers })

  const userId = await getUserId(req)
  if (!userId) return refus('Unauthorized', 401)

  // Le garde réel : l'allowlist du cockpit, par UUID.
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) return refus('Réservé au cockpit', 403)

  const body = await req.json().catch(() => ({}))
  const brut = typeof body?.mois === 'string' ? body.mois.trim() : ''
  const mois = brut || contexteParis().moisCourant
  if (!moisValide(mois)) return refus('mois : au format AAAA-MM.', 400)

  try {
    const donnees = await repartitionPourCockpit(mois)
    return NextResponse.json({ ok: true, ...donnees }, { headers })
  } catch (err) {
    console.error('[cockpit/repartition]', err instanceof Error ? err.message.split('\n').filter(Boolean).pop() : err)
    return refus('Répartition illisible pour l\'instant (erreur de la base).', 502)
  }
}
