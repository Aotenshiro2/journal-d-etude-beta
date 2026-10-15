// Ce que les routes de l'academie partagent (15/10/2026) : le CORS, le compte
// du jeton Bearer, l'identifiant tronque des logs, l'IP et l'appareil.
// Repris tel quel de la route d'essai (api/academie/lecture, 15/10).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { appareilCourt, ipDuClient } from './pur'

// Le site en production et le dev local (Vite, port par defaut). Le CORS
// n'est pas la barriere de securite (le jeton et le droit le sont) : il dit
// seulement quelles pages ont le droit de lire la reponse.
const ORIGINES = new Set([
  'https://aoknowledge.com',
  'https://www.aoknowledge.com',
  'http://localhost:5173',
])

export function corsAcademie(req: NextRequest, methodes = 'POST, OPTIONS'): Record<string, string> {
  const origin = req.headers.get('origin')
  if (!origin || !ORIGINES.has(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': methodes,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

/** Les en-tetes de toute reponse : CORS et jamais de cache (reponse personnelle). */
export function entetesAcademie(req: NextRequest, methodes?: string): Record<string, string> {
  return { ...corsAcademie(req, methodes), 'Cache-Control': 'no-store' }
}

/** { ok: false, erreur } avec le statut et les en-tetes donnes. */
export function refusAcademie(erreur: string, status: number, headers: Record<string, string>, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, erreur, ...extra }, { status, headers })
}

// Un access_token Supabase fait environ 1 ko ; au-dela, ce n'en est pas un.
const MAX_JETON = 4096

/**
 * L'identifiant du compte du jeton Bearer, ou null (absent, mal forme,
 * refuse). Jette si Supabase Auth est injoignable : la route en fait un 503,
 * pas un 401 (ce n'est pas la faute du membre).
 */
export async function compteDuJeton(req: NextRequest): Promise<string | null> {
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
export const tronquer = (id: string) => id.slice(0, 8)

/** L'IP (validee) et l'appareil court de la requete, pour academie_lectures. */
export function origineDeLaRequete(req: NextRequest): { ip: string | null; appareil: string | null } {
  return {
    ip: ipDuClient(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip')),
    appareil: appareilCourt(req.headers.get('user-agent')),
  }
}
