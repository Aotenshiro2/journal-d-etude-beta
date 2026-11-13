import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/db'
import { noterAnnoncesVues } from '@/lib/academie/annonces'
import { publierBilletsEchus } from '@/lib/academie/billets'
import { viderCacheCatalogue } from '@/lib/academie/catalogue'
import { lireStatut, niveauDuStatut, nomAffiche, vueMessage } from '@/lib/academie/chat-academie'
import {
  annoncesDe, assembler, CLE_META, JOURS_CLOCHE, lireDemandeCloche, lireMarque, MAX_PAR_SOURCE, nouvelleMarque, notifAnnonce,
  notifLecon, notifSalon, SQL_ACCES_ANNUAIRE, SQL_ANNONCES_CLOCHE, SQL_ANNONCES_TOUTES_VUES, SQL_REPONSES_LECONS,
  SQL_REPONSES_SALON, toucheLaMarque, type LigneAnnonceCloche, type LigneReponseLecon, type MarqueCloche, type Notification,
} from '@/lib/academie/cloche'
import { corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { jetonDeLaRequete } from '@/lib/academie/pur'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * /api/academie/cloche : la CLOCHE de l'academie (13/11/2026, FEATURE ;
 * src/lib/academie/cloche.ts). Sans table ni migration.
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>. Tout compte connecte.
 *
 * GET : 200 { ok: true, non_lues, notifications: [{ cle, type: 'annonce' | 'reponse_salon' | 'reponse_lecon',
 *   le, titre, extrait, qui, lien, lue }] } : les JOURS_CLOCHE derniers jours, la plus recente
 *   d'abord, 30 au plus. Une source absente (table pas encore en base) ne compte pas.
 * POST { lues: ['a:<id>' | 'c:<id>' | 'q:<id>', ...] } (50 au plus) : ces notifications sont lues
 *   (annonce : academie_billets_vus ; reponse : la marque du compte).
 * POST { tout: true } : tout marquer lu (les annonces de la fenetre notees vues, la marque posee
 *   a maintenant).
 *   200 { ok: true } ; 400 'demande'.
 * 401 'jeton' ; 503 'indisponible' (base, Supabase Auth).
 *
 * La marque du compte (user_metadata.aok_cloche) est relue FRAICHE par Supabase Auth a chaque
 * appel et ecrite avec le jeton du compte lui-meme (PUT /auth/v1/user), jamais avec une cle de
 * service : le compte ne peut changer que la sienne.
 *
 * Logs : compte tronque, nombres. Jamais le texte d'un message ni d'une reponse.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const METHODES = 'GET, POST, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

type Compte = { id: string; jeton: string; meta: Record<string, unknown> }

/** Le compte du jeton, avec ses metadonnees (lues fraiches). null = refuse ; jette si Supabase Auth est injoignable. */
async function compteDuJeton(req: NextRequest): Promise<Compte | null> {
  const jeton = jetonDeLaRequete(req.headers.get('authorization'))
  if (!jeton) return null
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { data, error } = await supabase.auth.getUser(jeton)
  if (error) {
    if (typeof error.status === 'number' && error.status >= 400 && error.status < 500) return null
    throw error
  }
  const u = data.user
  if (!u) return null
  return { id: u.id, jeton, meta: (u.user_metadata ?? {}) as Record<string, unknown> }
}

/** La marque ecrite avec le jeton du compte (GoTrue fusionne les cles des metadonnees). */
async function ecrireMarque(c: Compte, marque: MarqueCloche): Promise<void> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${c.jeton}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: { [CLE_META]: marque } }),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`auth ${res.status}`)
}

/** Une source dont la table n'est pas encore en base ne compte pas ; le reste remonte. */
async function source<T>(lire: () => Promise<T[]>): Promise<T[]> {
  try {
    return await lire()
  } catch (err) {
    if (relationAbsente(err)) return []
    throw err
  }
}

async function reponsesSalon(userId: string, marque: MarqueCloche): Promise<(Notification | null)[]> {
  return source(async () => {
    const a = await prisma.$queryRawUnsafe<{ acces: unknown }[]>(SQL_ACCES_ANNUAIRE, userId)
    const niveau = niveauDuStatut(lireStatut(a[0]?.acces))
    const l = await prisma.$queryRawUnsafe<{ id: string; cree_le: Date; vue: unknown }[]>(
      SQL_REPONSES_SALON, userId, niveau, JOURS_CLOCHE, MAX_PAR_SOURCE)
    return l.map(x => {
      // Une donnee de membre : reduite aux champs prevus, rendue en extrait de texte brut.
      const v = vueMessage(x.vue)
      return v ? notifSalon({ id: v.id, cree_le: v.cree_le, texte: v.texte, qui: nomAffiche(v.auteur) }, marque) : null
    })
  })
}

async function reponsesLecons(userId: string, marque: MarqueCloche): Promise<(Notification | null)[]> {
  return source(async () => {
    const l = await prisma.$queryRawUnsafe<LigneReponseLecon[]>(SQL_REPONSES_LECONS, userId, JOURS_CLOCHE, MAX_PAR_SOURCE)
    return l.map(x => notifLecon(x, marque))
  })
}

async function annonces(userId: string): Promise<(Notification | null)[]> {
  return source(async () => {
    const l = await prisma.$queryRawUnsafe<LigneAnnonceCloche[]>(SQL_ANNONCES_CLOCHE, userId, JOURS_CLOCHE, MAX_PAR_SOURCE)
    return l.map(notifAnnonce)
  })
}

async function compte(req: NextRequest, refus: (e: string, s: number) => NextResponse): Promise<Compte | NextResponse> {
  let c: Compte | null
  try {
    c = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[academie/cloche] verification du jeton impossible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  return c ?? refus('jeton', 401)
}

export async function GET(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)
  const c = await compte(req, refus)
  if (c instanceof NextResponse) return c

  // Comme la page Annonces : un billet programme dont l'heure est passee est publie d'abord.
  try {
    if (await publierBilletsEchus(prisma) > 0) viderCacheCatalogue()
  } catch (err) {
    if (!relationAbsente(err)) console.warn(`[academie/cloche] publication des billets echus impossible : ${messageErreur(err)}`)
  }

  const marque = lireMarque(c.meta[CLE_META])
  try {
    const listes = await Promise.all([annonces(c.id), reponsesSalon(c.id, marque), reponsesLecons(c.id, marque)])
    return NextResponse.json({ ok: true, ...assembler(listes) }, { headers })
  } catch (err) {
    console.warn(`[academie/cloche] lecture impossible compte=${tronquer(c.id)} : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)
  const c = await compte(req, refus)
  if (c instanceof NextResponse) return c

  const brut = await req.text().catch(() => '')
  if (brut.length > 10_000) return refus('demande', 400)
  let corps: unknown = {}
  try { corps = JSON.parse(brut || '{}') } catch { corps = {} }
  const d = lireDemandeCloche(corps)
  if (!d) return refus('demande', 400)

  try {
    // Les annonces : la table de la page Annonces (lue ici = lue la-bas).
    if ('tout' in d) await source(async () => { await prisma.$executeRawUnsafe(SQL_ANNONCES_TOUTES_VUES, c.id, JOURS_CLOCHE); return [] })
    else {
      const ids = annoncesDe(d)
      if (ids.length) await source(async () => { await noterAnnoncesVues(prisma, ids, c.id); return [] })
    }
    // Les reponses : la marque du compte, gardee courte (les reponses encore dans la fenetre).
    if (toucheLaMarque(d)) {
      const marque = lireMarque(c.meta[CLE_META])
      const courantes = 'tout' in d ? [] : (await Promise.all([reponsesSalon(c.id, marque), reponsesLecons(c.id, marque)]))
        .flat().filter((n): n is Notification => n !== null)
      await ecrireMarque(c, nouvelleMarque(marque, d, courantes, new Date().toISOString()))
    }
    return NextResponse.json({ ok: true }, { headers })
  } catch (err) {
    console.warn(`[academie/cloche] lecture NON notee compte=${tronquer(c.id)} : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
}
