import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { compteDuJeton, corsAcademie, entetesAcademie, tronquer } from '@/lib/academie/http'
import { droitsAcademie } from '@/lib/academie/droits'
import {
  SQL_ENTRE, fenetreMembre, lecteurDe, lireDemandeMembre, migrationAbsente, vueMembre,
  type Lecteur, type LigneLive, type LiveMembre,
} from '@/lib/academie/lives'

/**
 * POST /api/academie/lives : le calendrier des lives de l'academie
 * (13/11/2026, src/lib/academie/lives.ts, migration du workspace
 * 20261113200000_academie_lives.sql).
 *
 * Appel : avec ou sans Authorization: Bearer <access_token Supabase du site>.
 * Sans jeton : la liste des 4 semaines qui viennent, aucun lien (etat
 * 'connexion'). Avec un jeton valide : le droit du compte (droitsAcademie et
 * aok_annuaire_acces), et le lien d'un live SEULEMENT s'il y a droit et qu'on
 * est dans la fenetre (30 minutes avant le debut, jusqu'a la fin).
 * Corps : {} ou { action: 'lire' }.
 *
 * 200 { ok: true, lives: LiveMembre[], maintenant, connecte, live_club } ;
 * 400 action ; 401 jeton present mais refuse ; 503 base (code 'migration' si
 * les tables manquent : la page dit « le calendrier arrive bientot »).
 *
 * Lecture a l'ouverture de la page et au clic (« Recharger »), jamais par
 * minuterie. Logs : compte tronque, nombres. Jamais un lien ni un titre.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const METHODES = 'POST, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (erreur: string, status: number, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ ok: false, erreur, ...extra }, { status, headers })

  const brut = await req.text().catch(() => '')
  if (brut.length > 2_000) return refus('action', 400)
  let corps: unknown = null
  try { corps = brut ? JSON.parse(brut) : null } catch { return refus('action', 400) }
  const d = lireDemandeMembre(corps)
  if ('erreur' in d) return refus('action', 400)

  // Le compte : un jeton absent = visiteur ; un jeton present mais refuse = 401 (session expiree).
  let userId: string | null = null
  if (req.headers.get('authorization')) {
    try {
      userId = await compteDuJeton(req)
    } catch {
      console.warn('[academie/lives] verification du jeton impossible')
      return refus('indisponible', 503)
    }
    if (!userId) return refus('jeton', 401)
  }

  const maintenant = Date.now()
  const { du, au } = fenetreMembre(maintenant)
  try {
    const lignesP = prisma.$queryRawUnsafe<LigneLive[]>(SQL_ENTRE, du, au)
    let lecteur: Lecteur = { connecte: false }
    if (userId) {
      const [droits, acces] = await Promise.all([
        droitsAcademie(userId),
        prisma.$queryRawUnsafe<{ statut: string | null }[]>(
          `select public.aok_annuaire_acces($1::uuid) ->> 'statut' as statut`, userId),
      ])
      lecteur = lecteurDe(droits, acces[0]?.statut ?? null)
    }
    const lignes = await lignesP
    const lives = lignes.map(l => vueMembre(l, lecteur, maintenant)).filter((l): l is LiveMembre => l !== null)
    const prets = lives.filter(l => l.etat === 'pret').length
    console.info(`[academie/lives] ${userId ? tronquer(userId) : 'visiteur'} : ${lives.length} live(s), ${prets} lien(s) rendu(s)`)
    return NextResponse.json({
      ok: true,
      lives,
      maintenant: new Date(maintenant).toISOString(),
      connecte: lecteur.connecte,
      live_club: lecteur.connecte ? lecteur.liveClub : null,
    }, { headers })
  } catch (err) {
    if (migrationAbsente(err)) {
      console.warn('[academie/lives] migration 20261113200000 absente')
      return refus('indisponible', 503, { code: 'migration' })
    }
    console.error(`[academie/lives] lecture impossible : ${err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : 'erreur'}`)
    return refus('indisponible', 503)
  }
}
