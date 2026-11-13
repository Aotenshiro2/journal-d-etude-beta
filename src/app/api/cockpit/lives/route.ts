import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { libellesEquipe } from '@/lib/coaching/base'
import {
  SQL_ARRETER_SERIE, SQL_CREER_LIVE, SQL_CREER_SERIE, SQL_ENTRE, SQL_MODIFIER_LIVE, SQL_MODIFIER_SERIE, SQL_SERIES,
  SQL_SUPPRIMER_LIVE, SQL_SUPPRIMER_SERIE, TEXTE_ERREUR, fenetreCockpit, lireDemandeEquipe, migrationAbsente, requeteDate,
  valeursLive, valeursSerie, vueLiveCockpit, vueSerieCockpit,
  type LigneLive, type LiveCockpit, type SerieLue,
} from '@/lib/academie/lives'

/**
 * POST /api/cockpit/lives : le calendrier des lives, cote equipe (13/11/2026,
 * src/lib/academie/lives.ts, migration du workspace 20261113200000_academie_lives.sql).
 * Ecran : l'onglet Lives de l'espace Academie du cockpit.
 *
 * Reservee a cockpit_allowlist (projet Supabase partage avec un site public),
 * jeton de session du cockpit en Bearer, comme /api/cockpit/coaching.
 *
 *   { action: 'lister' }   les series et les lives de 3 jours en arriere a 8 semaines devant
 *   { action: 'creer_serie', serie }   { action: 'modifier_serie', id, serie }
 *   { action: 'arreter_serie', id, fin }   plus aucune date apres fin (les exceptions restent)
 *   { action: 'supprimer_serie', id }   la serie et ses exceptions (une erreur de saisie)
 *   { action: 'creer_live', live }   { action: 'modifier_live', id, live }   { action: 'supprimer_live', id }
 *   Sur UNE date (cible = { id } d'un ponctuel, ou { serie_id, date_serie } d'une serie) :
 *   { action: 'lien', cible, lien | null }   le lien colle au dernier moment (null : retire ;
 *                                             une date de serie reprend alors le lien de la serie)
 *   { action: 'annuler', cible }   { action: 'retablir', cible }
 *   { action: 'deplacer', cible, debut | null, duree_min? }   null : l'horaire de la serie
 *   { action: 'texte_date', cible, titre?, description? }   le titre ou la description de cette date
 * Les gestes rendent { ok: true } : l'ecran relit (« recharger a l'action »).
 * 400 { error } ; 401 ; 403 hors allowlist ; 404 introuvable (ou date qui n'est pas une date de la serie) ;
 * 503 { error, code: 'migration' } tables absentes, ou { error } base indisponible.
 *
 * Logs : action et identifiants tronques. Jamais un lien, un titre ni un nom.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

const court = (id: string) => id.slice(0, 8)

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = { ...corsHeaders(req), 'Cache-Control': 'no-store' }
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  let allow: { ok: number }[]
  try {
    allow = await prisma.$queryRaw<{ ok: number }[]>`
      select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  } catch {
    return NextResponse.json({ error: 'Base indisponible.' }, { status: 503, headers })
  }
  if (allow.length === 0) return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers })

  const maintenant = Date.now()
  const corps: unknown = await req.json().catch(() => ({}))
  const d = lireDemandeEquipe(corps, maintenant)
  if ('erreur' in d) return NextResponse.json({ error: TEXTE_ERREUR[d.erreur] }, { status: 400, headers })
  const par = `cockpit:${userId}`
  const introuvable = (m: string) => NextResponse.json({ error: m }, { status: 404, headers })
  const fait = () => NextResponse.json({ ok: true }, { headers })
  const un = async (sql: string, valeurs: unknown[]) => (await prisma.$queryRawUnsafe<{ id: string }[]>(sql, ...valeurs))[0]?.id ?? null

  try {
    switch (d.action) {
      case 'lister': {
        const { du, au } = fenetreCockpit(maintenant)
        const [series, lignes, libelles] = await Promise.all([
          prisma.$queryRawUnsafe<SerieLue[]>(SQL_SERIES),
          prisma.$queryRawUnsafe<LigneLive[]>(SQL_ENTRE, du, au),
          libellesEquipe(prisma),
        ])
        const lives = lignes.map(vueLiveCockpit).filter((l): l is LiveCockpit => l !== null)
        console.info(`[cockpit/lives] lister : ${series.length} serie(s), ${lives.length} live(s)`)
        return NextResponse.json({
          ok: true,
          maintenant: new Date(maintenant).toISOString(),
          series: series.map(s => vueSerieCockpit(s, libelles)),
          lives,
        }, { headers })
      }
      case 'creer_serie': {
        const id = await un(SQL_CREER_SERIE, valeursSerie(d.serie, par))
        console.info(`[cockpit/lives] creer_serie ${id ? court(id) : '?'}`)
        return fait()
      }
      case 'modifier_serie': {
        const id = await un(SQL_MODIFIER_SERIE, [...valeursSerie(d.serie, par), d.id])
        if (!id) return introuvable('Série introuvable.')
        console.info(`[cockpit/lives] modifier_serie ${court(d.id)}`)
        return fait()
      }
      case 'arreter_serie': {
        const id = await un(SQL_ARRETER_SERIE, [d.id, d.fin, par])
        if (!id) return introuvable('Série introuvable.')
        console.info(`[cockpit/lives] arreter_serie ${court(d.id)}`)
        return fait()
      }
      case 'supprimer_serie': {
        const id = await un(SQL_SUPPRIMER_SERIE, [d.id])
        if (!id) return introuvable('Série introuvable.')
        console.info(`[cockpit/lives] supprimer_serie ${court(d.id)}`)
        return fait()
      }
      case 'creer_live': {
        const id = await un(SQL_CREER_LIVE, valeursLive(d.live, par))
        console.info(`[cockpit/lives] creer_live ${id ? court(id) : '?'}`)
        return fait()
      }
      case 'modifier_live': {
        const id = await un(SQL_MODIFIER_LIVE, [...valeursLive(d.live, par), d.id])
        if (!id) return introuvable('Live introuvable.')
        console.info(`[cockpit/lives] modifier_live ${court(d.id)}`)
        return fait()
      }
      case 'supprimer_live': {
        const id = await un(SQL_SUPPRIMER_LIVE, [d.id])
        if (!id) return introuvable("Live introuvable (une date de série s'annule, elle ne se supprime pas).")
        console.info(`[cockpit/lives] supprimer_live ${court(d.id)}`)
        return fait()
      }
      case 'lien':
      case 'annuler':
      case 'retablir':
      case 'deplacer':
      case 'texte_date': {
        const { sql, valeurs } = requeteDate(d, par)
        const id = await un(sql, valeurs)
        if (!id) return introuvable('serie_id' in d.cible ? "Cette date n'est pas une date de la série." : 'Live introuvable.')
        const cible = 'serie_id' in d.cible ? `${court(d.cible.serie_id)}:${d.cible.date_serie}` : court(d.cible.id)
        console.info(`[cockpit/lives] ${d.action} ${cible}${d.action === 'lien' ? (d.lien ? ' (pose)' : ' (retire)') : ''}`)
        return fait()
      }
    }
  } catch (err) {
    if (migrationAbsente(err)) {
      return NextResponse.json({ error: 'Migration 20261113200000_academie_lives pas appliquée.', code: 'migration' }, { status: 503, headers })
    }
    const m = err instanceof Error ? err.message : String(err)
    // Une contrainte de la base (cas que la lecture du corps aurait du arreter) : 400, sans le detail.
    if (/23514|23502|check constraint|violates/i.test(m)) {
      console.warn(`[cockpit/lives] ${d.action} refuse par une contrainte`)
      return NextResponse.json({ error: 'Valeur refusée par la base.' }, { status: 400, headers })
    }
    console.error(`[cockpit/lives] ${d.action} : ${m.split('\n')[0].slice(0, 160)}`)
    return NextResponse.json({ error: 'Base indisponible.' }, { status: 503, headers })
  }
}
