import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { acteurCockpit, ajoutRetrait, jourParis, lireGeste, noteAccorder } from '@/lib/academie/gestes-cockpit-pur'
import { SQL_GESTE_ACCORDER, SQL_GESTE_RETIRER } from '@/lib/academie/requetes'

/**
 * POST /api/cockpit/academie : accorder ou retirer un acces a l'academie a la
 * main, depuis l'espace Academie du cockpit (Brice, 18/10/2026 : « piloter
 * les ACCES aux membres en fonction de leurs PRODUITS » ; plan academie,
 * section 12, V1 point 6).
 *
 * academie_acces est une table SERVEUR (RLS forcee, aucune policy
 * d'ecriture) : le cockpit la lit (migration 20261018220000) mais ne l'ecrit
 * jamais en direct. L'ecriture passe par cette route, reservee a
 * cockpit_allowlist, comme /api/cockpit/mentorat.
 *
 * - accorder { email, offre (slug), fin? (YYYY-MM-DD, inclus), raison } :
 *   pose un acces source 'offert', pose_par cockpit:<uuid>. droitsAcademie le
 *   lit tel quel des que l'eleve se connecte avec cet email verifie.
 *   Idempotent (un acces actif de la meme offre n'est pas double).
 * - retirer { acces_id, raison } : pose retire_le / retire_par et ajoute la
 *   raison a la note. N'importe quelle source (un achat rembourse, un acces
 *   Skool a fermer) : l'ecran demande confirmation. Ne coupe PAS un droit lu
 *   a sa source (Live Club actif, ETM, equipe) : ceux-la ne vivent pas dans
 *   academie_acces.
 */

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

type LigneAccorder = {
  offre_connue: number; deja_id: string | null; acces_id: string | null; debut: Date | null; fin: Date | null
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  // Le garde reel : l'allowlist du cockpit, par uuid (le projet Supabase est
  // partage avec un site public : etre authentifie ne prouve rien).
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) {
    return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers })
  }

  const corps = await req.json().catch(() => ({}))
  const geste = lireGeste(corps, jourParis(new Date()))
  if ('erreur' in geste) return NextResponse.json({ error: geste.erreur }, { status: 400, headers })

  const acteur = acteurCockpit(userId)
  try {
    if (geste.action === 'accorder') {
      const [r] = await prisma.$queryRawUnsafe<LigneAccorder[]>(
        SQL_GESTE_ACCORDER, geste.email, geste.offre, geste.fin, acteur, noteAccorder(geste.raison),
      )
      if (!r || r.offre_connue === 0) {
        return NextResponse.json({ error: 'Offre inconnue.' }, { status: 400, headers })
      }
      if (r.deja_id) return NextResponse.json({ ok: true, deja: true, acces_id: r.deja_id }, { headers })
      return NextResponse.json({ ok: true, acces_id: r.acces_id, debut: r.debut, fin: r.fin }, { headers })
    }

    const lignes = await prisma.$queryRawUnsafe<{ acces_id: string; retire_le: Date }[]>(
      SQL_GESTE_RETIRER, geste.accesId, acteur, ajoutRetrait(geste.raison),
    )
    if (lignes.length === 0) {
      return NextResponse.json({ error: 'Accès inconnu ou déjà retiré : relis la liste.' }, { status: 409, headers })
    }
    return NextResponse.json({ ok: true, acces_id: lignes[0].acces_id, retire_le: lignes[0].retire_le }, { headers })
  } catch (err) {
    // Jamais le message brut : il peut reprendre la requete (et donc l'email).
    const nom = err instanceof Error ? err.name : 'erreur'
    console.error(`[cockpit/academie] ${geste.action} : echec (${nom})`)
    return NextResponse.json({ error: "La base a refusé l'écriture." }, { status: 500, headers })
  }
}
