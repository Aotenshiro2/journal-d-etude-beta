import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aAccesAcademieEssai, type AccesAcademieEssai } from '@/lib/academie/droits'
import { configBunny, DUREE_LIEN_S, signerLecture } from '@/lib/academie/bunny'
import { videoEssai } from '@/lib/academie/essai'
import { messageErreur } from '@/lib/liveclub/pur'

/**
 * POST /api/academie/lecture : le lien de lecture signe d'une video de
 * l'academie (essai du 15/10/2026, page aoknowledge.com/academie/essai).
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>, corps
 * { video: '<guid Bunny>' }.
 * Reponses :
 *   200 { ok: true, url, expire_le, raison }
 *   400 { ok: false, erreur: 'video' }       video absente de la liste d'essai
 *   401 { ok: false, erreur: 'jeton' }       pas de jeton, ou jeton refuse
 *   403 { ok: false, erreur: 'acces' }       compte sans droit (decision B)
 *   503 { ok: false, erreur: 'config' }      variables Bunny absentes
 *   503 { ok: false, erreur: 'indisponible' } base ou Supabase Auth illisible
 *
 * Dans l'ordre : le compte (jeton verifie aupres de Supabase), la video
 * (liste d'essai, src/lib/academie/essai.ts), le droit (aAccesAcademieEssai),
 * puis la signature (src/lib/academie/bunny.ts). Le serveur decide, jamais la
 * page : la page ne fait qu'afficher l'URL rendue.
 *
 * Journal : une ligne console.info par lien delivre ou refuse, avec
 * l'identifiant du compte TRONQUE et le guid de la video. Jamais l'email, le
 * jeton du compte, la cle Bunny ni l'URL signee. Le journal des lectures en
 * base (academie_lectures, section 7 du plan) viendra avec les tables.
 */

export const maxDuration = 30

// Le site en production et le dev local (Vite, port par defaut). Le CORS
// n'est pas la barriere de securite (le jeton et le droit le sont) : il dit
// seulement quelles pages ont le droit de lire la reponse.
const ORIGINES = new Set([
  'https://aoknowledge.com',
  'https://www.aoknowledge.com',
  'http://localhost:5173',
])

function corsAcademie(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin')
  if (!origin || !ORIGINES.has(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

// Preflight : le middleware laisse passer les OPTIONS sur /api/.
export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req) })
}

// Un access_token Supabase fait environ 1 ko ; au-dela, ce n'en est pas un.
const MAX_JETON = 4096

/** L'identifiant du compte du jeton Bearer, ou null (absent, mal forme, refuse). */
async function compteDuJeton(req: NextRequest): Promise<string | null> {
  const entete = req.headers.get('authorization') ?? ''
  if (!entete.startsWith('Bearer ')) return null
  const jeton = entete.slice(7).trim()
  if (!jeton || jeton.length > MAX_JETON) return null
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { data, error } = await supabase.auth.getUser(jeton)
  if (error) {
    // 4xx = jeton refuse (expire, faux, compte supprime) : 401 a la page.
    // Le reste (Supabase injoignable) n'est pas la faute du membre : 503.
    if (typeof error.status === 'number' && error.status >= 400 && error.status < 500) return null
    throw error
  }
  return data.user?.id ?? null
}

/** 8 premiers caracteres de l'uuid : assez pour recouper, pas un identifiant complet. */
const tronquer = (id: string) => id.slice(0, 8)

let configAbsenteSignalee = false

export async function POST(req: NextRequest) {
  const cors = corsAcademie(req)
  // Un lien signe est personnel et date : ni cache du navigateur, ni cache
  // intermediaire.
  const headers = { ...cors, 'Cache-Control': 'no-store' }
  const refus = (erreur: string, status: number) =>
    NextResponse.json({ ok: false, erreur }, { status, headers })

  // 1. Le compte.
  let userId: string | null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[academie/lecture] verification du jeton impossible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!userId) return refus('jeton', 401)

  // 2. La video, dans la liste d'essai.
  const body = await req.json().catch(() => ({}))
  const video = videoEssai(body?.video)
  if (!video) return refus('video', 400)

  // 3. Le droit (decision B : admin ou membre payant, pas le Carnet seul).
  let droit: AccesAcademieEssai
  try {
    droit = await aAccesAcademieEssai(userId)
  } catch (err) {
    console.warn(`[academie/lecture] droits illisibles : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!droit.acces) {
    console.info(`[academie/lecture] refus compte=${tronquer(userId)} video=${video.id}`)
    return refus('acces', 403)
  }

  // 4. La signature.
  const config = configBunny()
  if (!config) {
    if (!configAbsenteSignalee) {
      configAbsenteSignalee = true
      console.warn('[academie/lecture] BUNNY_STREAM_LIBRARY_ID ou BUNNY_STREAM_TOKEN_KEY absente ou mal formee : aucun lien ne peut etre signe.')
    }
    return refus('config', 503)
  }
  const lien = signerLecture(video.id, DUREE_LIEN_S, { config })
  if (!lien) return refus('config', 503)

  console.info(`[academie/lecture] lien compte=${tronquer(userId)} video=${video.id} raison=${droit.raison}`)
  return NextResponse.json(
    { ok: true, url: lien.url, expire_le: lien.expireLe, raison: droit.raison },
    { headers },
  )
}
