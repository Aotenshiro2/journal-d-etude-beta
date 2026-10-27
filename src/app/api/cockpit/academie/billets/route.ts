import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { enregistrerBillet, lireSaisieBillet, listerBillets, publierBilletsEchus } from '@/lib/academie/billets'
import { viderCacheCatalogue } from '@/lib/academie/catalogue'
import { FENETRE_LIBRE_BILLET_H } from '@/lib/academie/pur'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * POST /api/cockpit/academie/billets : les BILLETS DU JOUR, ecrits par Brice
 * dans le cockpit (espace Annonces, onglet « Billets », 27/10/2026 ;
 * src/lib/academie/billets.ts, migration 20261027190000_academie_billets.sql).
 *
 * academie_lecons et academie_billets sont des tables SERVEUR (RLS forcee) :
 * le cockpit les ecrit par cette route, reservee a cockpit_allowlist, comme
 * /api/cockpit/academie. Jeton de session du cockpit en Bearer.
 *
 * { action: 'lister' }
 *   200 { ok: true, fenetre_h, billets: [...] } (publie d'abord les billets echus)
 * { action: 'enregistrer', id?, titre, contenu, publie_le? (ISO, vide = maintenant), video? }
 *   video : guid Bunny (bibliotheque formation) ou lien YouTube, vide = aucune.
 *   Cree la lecon dans la section Billets des Chroniques (brouillon) et le billet,
 *   ou modifie titre, texte, video et (tant qu'il n'est pas publie) la date.
 *   Puis publie ce qui est echu : un billet « maintenant » part tout de suite
 *   (lecon publiee, pop-up inscrit dans cockpit_annonces_envoyees).
 *   200 { ok: true, id, billets: [...] }
 * 400 { error } saisie refusee (message en clair) ; 401 ; 403 hors allowlist ;
 * 404 billet inconnu ; 409 date d'un billet deja publie, ou billet retire ;
 * 503 migration absente ou base indisponible.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

const FENETRE_MS = FENETRE_LIBRE_BILLET_H * 3600 * 1000

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  // Le garde reel : l'allowlist du cockpit (projet Supabase partage avec un site public).
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers })

  const corps: unknown = await req.json().catch(() => ({}))
  const action = (corps && typeof corps === 'object' ? (corps as Record<string, unknown>).action : null)

  const liste = async () => {
    if (await publierBilletsEchus(prisma) > 0) viderCacheCatalogue()
    return listerBillets(prisma, Date.now(), FENETRE_MS)
  }

  try {
    if (action === 'lister') {
      return NextResponse.json({ ok: true, fenetre_h: FENETRE_LIBRE_BILLET_H, billets: await liste() }, { headers })
    }
    if (action !== 'enregistrer') return NextResponse.json({ error: 'Action inconnue.' }, { status: 400, headers })

    const saisie = lireSaisieBillet(corps)
    if ('erreur' in saisie) return NextResponse.json({ error: saisie.erreur }, { status: 400, headers })

    const issue = await prisma.$transaction(tx => enregistrerBillet(tx, userId, saisie, new Date()), { timeout: 15_000, maxWait: 5_000 })
    if (issue.issue === 'section') {
      return NextResponse.json({ error: 'Section « Billets » des Chroniques introuvable dans le catalogue.' }, { status: 503, headers })
    }
    if (issue.issue === 'introuvable') return NextResponse.json({ error: 'Billet inconnu : relis la liste.' }, { status: 404, headers })
    if (issue.issue === 'retire') return NextResponse.json({ error: 'Ce billet est retiré.' }, { status: 409, headers })
    if (issue.issue === 'date_figee') {
      return NextResponse.json({ error: 'Ce billet est déjà publié : sa date ne change plus (le pop-up est parti).' }, { status: 409, headers })
    }
    viderCacheCatalogue()
    console.info(`[cockpit/academie/billets] ${issue.cree ? 'cree' : 'modifie'} billet=${issue.id} lecon=${issue.leconId}`)
    return NextResponse.json({ ok: true, id: issue.id, fenetre_h: FENETRE_LIBRE_BILLET_H, billets: await liste() }, { headers })
  } catch (err) {
    if (relationAbsente(err)) {
      return NextResponse.json({ error: 'Migration des billets pas encore appliquée (20261027190000).' }, { status: 503, headers })
    }
    // Jamais le message brut dans la reponse.
    console.error(`[cockpit/academie/billets] ${String(action)} : echec (${messageErreur(err)})`)
    return NextResponse.json({ error: "La base a refusé l'écriture." }, { status: 503, headers })
  }
}
