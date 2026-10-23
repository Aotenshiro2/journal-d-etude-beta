import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { autoriserArbre, executerGeste, lireArbre, type IssueGeste } from '@/lib/academie/arbre'
import { viderCacheCatalogue } from '@/lib/academie/catalogue'
import { roleAcademie } from '@/lib/academie/droits'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { estAdmin } from '@/lib/academie/pur'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * /api/academie/arbre : l'arbre du catalogue, range par l'admin depuis le
 * cockpit (23/10/2026, lot LOT-ARBRE-CATALOGUE-COCKPIT ; src/lib/academie/arbre.ts,
 * migration 20261023150000_academie_arbre.sql).
 *
 * Appel : Authorization: Bearer <access_token Supabase> (le cockpit et le site
 * partagent le projet). Le droit est verifie ICI (profiles.role = 'admin', la
 * regle de droitsAcademie et de l'edition), jamais seulement par l'ecran.
 * CORS : le site et le cockpit (routes admin seulement).
 *
 * GET : tout le catalogue, brouillons compris (modules, sections, lecons, avec
 *   les identifiants de video et les noms de pieces jointes pour la recherche,
 *   et les marques « modifie dans l'app »).
 * POST { action, ... } : un geste, joue dans une transaction qui verrouille
 *   les modules (un geste a la fois, jamais pendant un import) :
 *   - deplacer_lecons { ids, module, section|null, avant|null }
 *   - deplacer_section { id, avant|null } ; deplacer_module { id, avant|null }
 *   - statut { cible: 'lecon'|'module', ids, statut: 'publie'|'brouillon' }
 *   - creer_section { module, titre }
 *   Chaque element qui change va dans academie_editions (avant / apres) et
 *   porte sa marque (deplace_le, statut_le, origine) : l'importeur la respecte.
 *   Le cache du catalogue est vide.
 *
 * Reponses :
 *   200 GET { ok: true, modules, sections, lecons }
 *   200 POST { ok: true, modifies, renommees, refusees, section?, arbre }
 *       renommees : lecons arrivees dans un module ou leur slug etait pris ;
 *       refusees : lecons qu'on ne peut pas publier (video pas envoyee, texte vide)
 *   400 'demande' | 'titre' | 'cible' (section d'un autre module, « avant » hors du conteneur)
 *   401 'jeton' ; 403 'droit' (pas admin) ; 404 'introuvable'
 *   503 'indisponible' (base, migration 20261023150000 absente, Supabase Auth)
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const METHODES = 'GET, POST, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES, true) })
}

/** Une colonne ou une table de la migration manque encore : 503, pas 500. */
const migrationAbsente = (err: unknown) => relationAbsente(err) || /42703|column .* does not exist/i.test(messageErreur(err))

type Porte = { userId: string; admin: boolean } | NextResponse

async function porte(req: NextRequest, headers: Record<string, string>): Promise<Porte> {
  let userId: string | null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[academie/arbre] verification du jeton impossible : ${messageErreur(err)}`)
    return refusAcademie('indisponible', 503, headers)
  }
  if (!userId) return refusAcademie('jeton', 401, headers)
  try {
    return { userId, admin: estAdmin(await roleAcademie(userId)) }
  } catch (err) {
    console.warn(`[academie/arbre] role illisible compte=${tronquer(userId)} : ${messageErreur(err)}`)
    return refusAcademie('indisponible', 503, headers)
  }
}

export async function GET(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES, true)
  const p = await porte(req, headers)
  if (p instanceof NextResponse) return p
  if (!p.admin) {
    console.warn(`[academie/arbre] lecture refusee (pas admin) compte=${tronquer(p.userId)}`)
    return refusAcademie('droit', 403, headers)
  }
  try {
    return NextResponse.json({ ok: true, ...(await lireArbre(prisma)) }, { headers })
  } catch (err) {
    console.warn(`[academie/arbre] lecture impossible : ${migrationAbsente(err) ? 'migration 20261023150000 absente' : messageErreur(err)}`)
    return refusAcademie('indisponible', 503, headers)
  }
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES, true)
  const p = await porte(req, headers)
  if (p instanceof NextResponse) return p

  const corps = await req.json().catch(() => null)
  const porteGeste = autoriserArbre(p.admin, corps)
  if (!porteGeste.ok) {
    if (porteGeste.status === 403) console.warn(`[academie/arbre] geste refuse (pas admin) compte=${tronquer(p.userId)}`)
    return refusAcademie(porteGeste.erreur, porteGeste.status, headers)
  }
  const geste = porteGeste.geste

  let issue: IssueGeste
  try {
    issue = await prisma.$transaction(tx => executerGeste(tx, p.userId, geste), { timeout: 15_000, maxWait: 5_000 })
  } catch (err) {
    const message = messageErreur(err)
    // Une contrainte de la base (23xxx) que le plan n'a pas vue : la demande, pas le serveur.
    if (/\b23(505|514|503)\b|check constraint|unique constraint|foreign key/i.test(message)) {
      console.warn(`[academie/arbre] ${geste.action} refuse par la base : ${message}`)
      return refusAcademie('cible', 400, headers)
    }
    console.warn(`[academie/arbre] ${geste.action} impossible : ${migrationAbsente(err) ? 'migration 20261023150000 absente' : message}`)
    return refusAcademie('indisponible', 503, headers)
  }

  if (issue.issue === 'introuvable') return refusAcademie('introuvable', 404, headers)
  if (issue.issue === 'cible') return refusAcademie('cible', 400, headers)
  if (issue.modifies > 0) viderCacheCatalogue()
  console.info(`[academie/arbre] ${geste.action} compte=${tronquer(p.userId)} modifies=${issue.modifies} refusees=${issue.refusees.length}`)

  // L'arbre frais, pour que l'ecran reparte de la base.
  let arbre = null
  try {
    arbre = await lireArbre(prisma)
  } catch (err) {
    console.warn(`[academie/arbre] relecture apres ${geste.action} impossible : ${messageErreur(err)}`)
  }
  return NextResponse.json({
    ok: true, modifies: issue.modifies, renommees: issue.renommees, refusees: issue.refusees,
    ...(issue.section ? { section: issue.section } : {}), arbre,
  }, { headers })
}
