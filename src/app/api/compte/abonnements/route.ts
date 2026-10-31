import { NextRequest, NextResponse } from 'next/server'
import { compteDuJeton, entetesAcademie, corsAcademie, refusAcademie } from '@/lib/academie/http'
import { enregistrerAbonnements, lireAbonnements, type IssueServeur } from '@/lib/kit-abonnements'
import { lireDemande } from '@/lib/kit-abonnements-pur'
import { CHOIX_KIT } from '@/lib/kit-choix'

/**
 * /api/compte/abonnements : les emails que le membre recoit de nous (Mon
 * espace, carte « Mes emails », decision de Brice du 31/10/2026). Un choix =
 * un tag Kit (src/lib/kit-choix.ts), sur l'abonne Kit de l'adresse des
 * communications (aok_email_communications). Logique :
 * src/lib/kit-abonnements-pur.ts.
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>. Le compte est
 * TOUJOURS celui du jeton.
 *
 * GET  : l'etat relu chez Kit. Si l'abonne lie porte une autre adresse que
 *        celle des communications, il suit d'abord (resynchronisation) : c'est
 *        aussi ce que le site appelle juste apres un changement d'adresse.
 * POST { choix: { <cle>: boolean } } : cles connues seulement, au moins une,
 *        les autres inchangees. Cree l'abonne s'il manque (et qu'un choix est
 *        coche), pose ou retire les tags, rend l'etat relu. « Tout
 *        desactiver » = toutes les cles a false : aucun choix, jamais de
 *        desinscription de Kit.
 *
 * Reponses : 200 { ok: true, adresse, etat, choix: [{ cle, libelle, detail, actif }], resynchro }
 *   400 'demande'   corps illisible, cle inconnue, valeur non booleenne
 *   401 'jeton'
 *   409 'adresse'   aucune adresse ou ecrire (compte sans email)
 *   409 'conflit'   l'abonne Kit de l'adresse est deja lie a un autre compte
 *   502 'kit'       Kit a refuse ou n'a pas repondu
 *   503 'config' | 'indisponible'
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const METHODES = 'GET, POST, OPTIONS'
const STATUTS: Record<string, number> = { demande: 400, adresse: 409, conflit: 409, kit: 502, config: 503, indisponible: 503 }
const CORPS_MAX = 2000

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

async function compte(req: NextRequest): Promise<string | null | 'indisponible'> {
  try {
    return await compteDuJeton(req)
  } catch (err) {
    console.warn(`[compte/abonnements] verification du jeton impossible : ${err instanceof Error ? err.name : 'erreur'}`)
    return 'indisponible'
  }
}

function reponse(r: IssueServeur, headers: Record<string, string>) {
  if (r.ok) return NextResponse.json({ ok: true, ...r.abonnements }, { headers })
  return refusAcademie(r.erreur, STATUTS[r.erreur] ?? 503, headers)
}

export async function GET(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const userId = await compte(req)
  if (userId === 'indisponible') return refusAcademie('indisponible', 503, headers)
  if (!userId) return refusAcademie('jeton', 401, headers)
  return reponse(await lireAbonnements(userId), headers)
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const userId = await compte(req)
  if (userId === 'indisponible') return refusAcademie('indisponible', 503, headers)
  if (!userId) return refusAcademie('jeton', 401, headers)

  const texte = await req.text().catch(() => '')
  let corps: unknown = null
  if (texte.length <= CORPS_MAX) {
    try { corps = JSON.parse(texte) } catch { corps = null }
  }
  const demande = lireDemande(corps, CHOIX_KIT)
  if (!demande) return refusAcademie('demande', 400, headers)
  return reponse(await enregistrerAbonnements(userId, demande), headers)
}
