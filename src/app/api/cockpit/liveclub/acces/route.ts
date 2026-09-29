import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { accorderAccesBroker, prerequisAccesBroker, MAX_EMAILS_PAR_LOT } from '@/lib/liveclub/acces'

/**
 * POST /api/cockpit/liveclub/acces : le formulaire « Accorder 6 mois » du
 * cockpit (acces broker RaiseFx, 29/09). Melanie colle des emails, chacun
 * recoit 6 mois d'acces au Live Club a partir d'aujourd'hui, UNE SEULE FOIS
 * (non renouvelable), et un email de support@ avec son lien personnel vers
 * le bot. La logique vit dans src/lib/liveclub/acces.ts, partagee avec la
 * carte de l'agent du cockpit (action 'acces_broker').
 *
 * Corps : { emails: string[] (1 a 50), note?: string }.
 * Reponse : { ok: true, resultats: ResultatAccesBroker[] } (un par email,
 * dans l'ordre, doublons du lot retires), ou { ok: false, erreur }.
 *
 * Meme garde que /api/cockpit/liveclub/membre : Bearer Supabase +
 * cockpit_allowlist, CORS des origines AOK. Jamais une adresse dans un log.
 */

// 50 emails, chacun : lecture en base, recherche Stripe, insert, jeton, Resend.
export const maxDuration = 120

const MAX_LONGUEUR_EMAIL = 254
const MAX_NOTE = 500

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
  const brut = body?.emails
  if (!Array.isArray(brut) || brut.length === 0) {
    return refus('emails : une liste de 1 à 50 adresses est attendue.', 400)
  }
  if (brut.length > MAX_EMAILS_PAR_LOT) {
    return refus(`${MAX_EMAILS_PAR_LOT} emails au plus par envoi : découpe la liste.`, 400)
  }
  if (brut.some(e => typeof e !== 'string' || e.length > MAX_LONGUEUR_EMAIL)) {
    return refus('emails : chaque élément doit être une adresse (texte).', 400)
  }
  const noteBrute = body?.note
  if (noteBrute != null && typeof noteBrute !== 'string') return refus('note : texte attendu.', 400)
  const note = typeof noteBrute === 'string' ? noteBrute.trim().slice(0, MAX_NOTE) || null : null

  // Configuration d'abord : sans Resend, l'acces partirait sans email et
  // serait brule (non renouvelable).
  const manque = prerequisAccesBroker()
  if (manque) return refus(manque, 503)

  let resultats
  try {
    resultats = await accorderAccesBroker(brut as string[], { acteur: `cockpit:${userId}`, note })
  } catch (err) {
    // accorderAccesBroker ne jette que sur un lot vide ou trop gros (deja
    // filtres) : un filet, sans donnee personnelle dans le message.
    return refus(err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'Échec du lot.', 500)
  }

  // Trace Vercel : qui, combien, quelles issues. Jamais les adresses.
  const compte: Record<string, number> = {}
  for (const r of resultats) compte[r.resultat] = (compte[r.resultat] ?? 0) + 1
  console.log(`[cockpit/liveclub/acces] ${userId} lot de ${resultats.length} : `
    + Object.entries(compte).map(([k, n]) => `${k}=${n}`).join(' '))

  return NextResponse.json({ ok: true, resultats }, { headers })
}
