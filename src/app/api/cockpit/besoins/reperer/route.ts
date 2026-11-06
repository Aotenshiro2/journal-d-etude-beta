import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { erreurCourte, lireCorpsReperage } from '@/lib/besoins/pur'
import { ErreurPasse } from '@/lib/besoins/moteur'
import { repererBesoinsServeur } from '@/lib/besoins/serveur'

// Un appel lit au plus `max` fils et s'arrete de lancer des appels du modele
// apres BUDGET_MS : Vercel coupe a 60 s.
export const maxDuration = 60
const BUDGET_MS = 40_000

/**
 * POST /api/cockpit/besoins/reperer : la passe de reperage des besoins des
 * membres (lot 1 du 06/11/2026, choix de Brice : option 3, les deux voies).
 * Corps : { essai?: boolean (vrai par defaut), max?: 1..40 (16), apres?: { maj, id } }.
 *
 * Relit les fils SupportThread plus recents que leur curseur, leurs messages
 * du membre posterieurs, les classe avec Haiku (cle du support), regroupe en
 * cartes et enregistre les demandes (texte recopie du fil). Par paquets : la
 * reponse dit ce qui reste (restants) et ou reprendre (suite, a renvoyer en
 * `apres`). Le bouton du cockpit viendra au lot 3.
 *
 * ESSAI (par defaut, `essai: false` pour ecrire) : lit et classe, n'ecrit ni
 * carte, ni demande, ni curseur, ni journal des passes (la depense IA reste
 * tracee dans AiUsage) et rend la liste de ce qui serait enregistre. Avant la
 * migration, l'essai lit tous les fils, sans curseur ni carte existante.
 *
 * Garde : Bearer Supabase + cockpit_allowlist, CORS des origines AOK (comme
 * /api/cockpit/support/traite). La reponse porte des mots de membres :
 * reservee a l'allowlist.
 * Reponses : 200 ResultatPasse ; 401 ; 403 ; 409 une passe tourne deja ;
 * 503 tables absentes (hors essai) ou base illisible ; 502 modele indisponible.
 */

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers })

  const corps = lireCorpsReperage(await req.json().catch(() => ({})))

  try {
    const r = await repererBesoinsServeur({ ...corps, par: userId, budgetMs: BUDGET_MS })
    return NextResponse.json(r, { headers })
  } catch (err) {
    if (err instanceof ErreurPasse) {
      return err.code === 'deja_en_cours'
        ? NextResponse.json({ error: 'Une passe tourne déjà : réessaie dans une minute.' }, { status: 409, headers })
        : NextResponse.json({ error: 'Les tables des besoins ne sont pas encore en place (migration 20261106120000).' }, { status: 503, headers })
    }
    console.error('[cockpit/besoins/reperer]', erreurCourte(err))
    const ia = /anthropic|api key|clé api|overloaded|rate/i.test(err instanceof Error ? err.message : '')
    return ia
      ? NextResponse.json({ error: 'Le service IA est indisponible, réessaie dans une minute.' }, { status: 502, headers })
      : NextResponse.json({ error: 'Base illisible : réessaie dans un instant.' }, { status: 503, headers })
  }
}
