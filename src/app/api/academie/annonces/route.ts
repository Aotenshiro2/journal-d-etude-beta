import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { lireAnnonces, lireVues, noterAnnoncesVues, resumer } from '@/lib/academie/annonces'
import { publierBilletsEchus } from '@/lib/academie/billets'
import { viderCacheCatalogue } from '@/lib/academie/catalogue'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * /api/academie/annonces : la page « Annonces » de l'academie (13/11/2026,
 * src/lib/academie/annonces.ts, migration 20261113160000_academie_annonces.sql).
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>. Tout compte
 * connecte, gratuit compris. Lecture seule pour les membres : on repond dans
 * le salon des questions, pas ici.
 *
 * GET : publie d'abord les billets programmes dont l'heure est passee (comme la
 *   route du billet du jour), puis rend
 *   200 { ok: true, annonces: [{ id, titre, contenu (Markdown), publie_le, origine: 'cockpit' | 'skool',
 *         categorie, epingle, non_lue, lien, video, ressources }], non_lues, derniere, dernieres }
 *   les plus recentes d'abord ; une annonce Skool n'est jamais non lue.
 * GET ?resume=1 : { ok: true, non_lues, derniere: { id, titre, publie_le, non_lue, origine } | null, dernieres: [3 au plus] }
 *   (la barre de navigation et l'accueil : pas de texte).
 * POST { vues: [id, ...] } (100 au plus) : le compte a vu ces annonces (page ouverte) ;
 *   plus de point, et le pop-up du billet du jour ne revient pas.
 *   200 { ok: true, notees } ; 400 'vues'
 * 401 'jeton' ; 503 'indisponible' (base ou Supabase Auth illisible).
 * Tables absentes : GET rend une liste vide ; colonnes du 13/11 absentes : billets du cockpit seulement.
 *
 * Logs : compte tronque. Jamais le texte.
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
    console.warn(`[academie/annonces] verification du jeton impossible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  return userId ?? refus('jeton', 401)
}

export async function GET(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)
  const userId = await compte(req, refus)
  if (typeof userId !== 'string') return userId
  const resume = req.nextUrl.searchParams.get('resume') === '1'

  try {
    if (await publierBilletsEchus(prisma) > 0) viderCacheCatalogue()
  } catch (err) {
    if (!relationAbsente(err)) console.warn(`[academie/annonces] publication des billets echus impossible : ${messageErreur(err)}`)
  }

  let annonces
  try {
    annonces = await lireAnnonces(prisma, userId)
  } catch (err) {
    if (relationAbsente(err)) {
      return NextResponse.json(resume ? { ok: true, non_lues: 0, derniere: null, dernieres: [] } : { ok: true, annonces: [], non_lues: 0, derniere: null, dernieres: [] }, { headers })
    }
    console.warn(`[academie/annonces] lecture impossible compte=${tronquer(userId)} : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  const r = resumer(annonces)
  return NextResponse.json(resume ? { ok: true, ...r } : { ok: true, annonces, ...r }, { headers })
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)
  const userId = await compte(req, refus)
  if (typeof userId !== 'string') return userId

  const vues = lireVues(await req.json().catch(() => ({})))
  if (!vues) return refus('vues', 400)
  try {
    const notees = await noterAnnoncesVues(prisma, vues, userId)
    return NextResponse.json({ ok: true, notees }, { headers })
  } catch (err) {
    console.warn(`[academie/annonces] vues NON notees compte=${tronquer(userId)} n=${vues.length} : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
}
