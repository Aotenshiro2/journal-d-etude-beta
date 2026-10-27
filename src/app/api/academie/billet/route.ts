import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { lireBilletDuJour, noterBilletVu, publierBilletsEchus } from '@/lib/academie/billets'
import { configBibliotheque, DUREE_LIEN_S, signerLecture } from '@/lib/academie/bunny'
import { viderCacheCatalogue } from '@/lib/academie/catalogue'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { FENETRE_LIBRE_BILLET_H, finFenetreLibre, lireUuid } from '@/lib/academie/pur'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * /api/academie/billet : le BILLET DU JOUR de l'academie (27/10/2026,
 * src/lib/academie/billets.ts, migration 20261027190000_academie_billets.sql).
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>. Tout compte
 * connecte, gratuit compris : pendant sa fenetre libre (48 h apres la
 * publication), le billet se lit sans autre droit.
 *
 * GET : publie d'abord les billets programmes dont l'heure est passee (pas de
 *   pg_cron : cette route, appelee par chaque accueil de l'academie, fait le
 *   travail ; une panne ici n'empeche pas la lecture), puis rend
 *   200 { ok: true, billet: null }  aucun billet dans sa fenetre
 *   200 { ok: true, billet: { id, titre, contenu (Markdown), publie_le, libre_jusquau, vu,
 *         video: { hebergeur: 'bunny', url, expire_le } | { hebergeur: 'youtube', id } | null,
 *         lecon: { id, slug }, module: { slug, titre } } }
 *   vu : le compte a deja ferme le pop-up (le bandeau, lui, reste jusqu'a la fin de la fenetre).
 * POST { billet } : le compte ferme le pop-up, il ne revient plus (sur aucun appareil).
 *   200 { ok: true } ; 400 'billet' ; 404 'billet' (inconnu)
 * 401 'jeton' ; 503 'indisponible' (base ou Supabase Auth illisible).
 * Tables absentes (migration pas appliquee) : GET rend billet null, POST 503.
 *
 * Logs : compte tronque, id du billet. Jamais le texte, ni l'URL signee.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const METHODES = 'GET, POST, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

async function compte(req: NextRequest, refus: (e: string, s: number) => NextResponse): Promise<string | NextResponse> {
  let userId: string | null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[academie/billet] verification du jeton impossible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  return userId ?? refus('jeton', 401)
}

export async function GET(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)
  const userId = await compte(req, refus)
  if (typeof userId !== 'string') return userId

  try {
    if (await publierBilletsEchus(prisma) > 0) viderCacheCatalogue()
  } catch (err) {
    if (!relationAbsente(err)) console.warn(`[academie/billet] publication des billets echus impossible : ${messageErreur(err)}`)
  }

  let ligne
  try {
    ligne = await lireBilletDuJour(prisma, userId, FENETRE_LIBRE_BILLET_H)
  } catch (err) {
    if (relationAbsente(err)) return NextResponse.json({ ok: true, billet: null }, { headers })
    console.warn(`[academie/billet] lecture impossible compte=${tronquer(userId)} : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!ligne) return NextResponse.json({ ok: true, billet: null }, { headers })

  let video: Record<string, unknown> | null = null
  if (ligne.type === 'video' && ligne.hebergeur === 'bunny' && ligne.bunny_video_id) {
    const lien = signerLecture(ligne.bunny_video_id, DUREE_LIEN_S, { config: configBibliotheque(ligne.bunny_bibliotheque) })
    if (lien) video = { hebergeur: 'bunny', url: lien.url, expire_le: lien.expireLe }
    else console.warn(`[academie/billet] bibliotheque Bunny '${ligne.bunny_bibliotheque}' sans configuration : billet ${ligne.id} sans video`)
  } else if (ligne.youtube_id) {
    video = { hebergeur: 'youtube', id: ligne.youtube_id }
  }

  return NextResponse.json({
    ok: true,
    billet: {
      id: ligne.id,
      titre: ligne.titre,
      contenu: ligne.contenu ?? '',
      publie_le: new Date(ligne.publie_le).toISOString(),
      libre_jusquau: finFenetreLibre(ligne.publie_le)?.toISOString() ?? null,
      vu: ligne.vu === true,
      video,
      lecon: { id: ligne.lecon_id, slug: ligne.lecon_slug },
      module: { slug: ligne.module_slug, titre: ligne.module_titre },
    },
  }, { headers })
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)
  const userId = await compte(req, refus)
  if (typeof userId !== 'string') return userId

  const corps: unknown = await req.json().catch(() => ({}))
  const billet = lireUuid((corps && typeof corps === 'object' ? corps as Record<string, unknown> : {}).billet)
  if (!billet) return refus('billet', 400)
  try {
    if (!(await noterBilletVu(prisma, billet, userId))) return refus('billet', 404)
  } catch (err) {
    console.warn(`[academie/billet] pop-up ferme NON note compte=${tronquer(userId)} billet=${billet} : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  return NextResponse.json({ ok: true }, { headers })
}
