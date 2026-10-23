import { NextRequest, NextResponse } from 'next/server'
import { roleAcademie } from '@/lib/academie/droits'
import { enregistrerEdition, lireTexteEditable, texteVersJson, type IssueEdition } from '@/lib/academie/edition'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { autoriserEdition, estAdmin, lireCibleEdition } from '@/lib/academie/pur'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * /api/academie/edition : l'admin modifie les textes de l'academie depuis la
 * page (23/10/2026, lot LOT-EDITION-IN-APP-ADMIN ; src/lib/academie/edition.ts).
 * V1 : titre et texte (Markdown) d'une lecon, titre et resume d'un module.
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>. Le droit est
 * verifie ICI (profiles.role = 'admin', la regle de droitsAcademie), jamais
 * seulement par l'ecran.
 *
 * GET ?cible=lecon|module&id=<uuid> : les textes actuels, lus frais (l'editeur
 *   part de la base, pas du catalogue en cache).
 * PATCH { cible: 'lecon', id, version?, titre?, contenu? }
 *     | { cible: 'module', id, version?, titre?, resume? }
 *   version = celle rendue par GET : si la ligne a change depuis (import,
 *   autre onglet), rien n'est ecrit (409). Chaque champ qui change est garde
 *   dans academie_editions (avant, apres, par, le) ; edite_le et edite_par
 *   sont poses (l'importeur garde alors ces textes).
 *
 * Reponses :
 *   200 { ok: true, cible, id, titre, contenu | resume, edite_le, version, modifies? }
 *       modifies (PATCH) = nombre de champs changes (0 : rien a ecrire)
 *   400 { ok: false, erreur: 'demande' | 'titre' | 'contenu' | 'resume' | 'vide' }
 *       'contenu' aussi pour une lecon ecrite publiee qu'on viderait
 *   401 'jeton' ; 403 'droit' (pas admin) ; 404 'introuvable' ; 409 'conflit'
 *   503 'indisponible' (base, migration 20261023120000 absente, Supabase Auth)
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const METHODES = 'GET, PATCH, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

type Porte = { userId: string; role: string | null } | NextResponse

/** Le compte du jeton et son role, ou la reponse de refus. */
async function porte(req: NextRequest, headers: Record<string, string>): Promise<Porte> {
  let userId: string | null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[academie/edition] verification du jeton impossible : ${messageErreur(err)}`)
    return refusAcademie('indisponible', 503, headers)
  }
  if (!userId) return refusAcademie('jeton', 401, headers)
  try {
    return { userId, role: await roleAcademie(userId) }
  } catch (err) {
    console.warn(`[academie/edition] role illisible compte=${tronquer(userId)} : ${messageErreur(err)}`)
    return refusAcademie('indisponible', 503, headers)
  }
}

export async function GET(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const p = await porte(req, headers)
  if (p instanceof NextResponse) return p
  if (!estAdmin(p.role)) {
    console.warn(`[academie/edition] lecture refusee (pas admin) compte=${tronquer(p.userId)}`)
    return refusAcademie('droit', 403, headers)
  }
  const params = req.nextUrl.searchParams
  const cible = lireCibleEdition(params.get('cible'), params.get('id'))
  if (!cible) return refusAcademie('demande', 400, headers)
  try {
    const texte = await lireTexteEditable(cible.cible, cible.id)
    if (!texte) return refusAcademie('introuvable', 404, headers)
    return NextResponse.json({ ok: true, ...texteVersJson(texte) }, { headers })
  } catch (err) {
    console.warn(`[academie/edition] lecture impossible ${cible.cible}=${cible.id} : ${
      relationAbsente(err) ? 'tables academie absentes' : messageErreur(err)}`)
    return refusAcademie('indisponible', 503, headers)
  }
}

export async function PATCH(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const p = await porte(req, headers)
  if (p instanceof NextResponse) return p

  const corps = await req.json().catch(() => null)
  const porteEdition = autoriserEdition(p.role, corps)
  if (!porteEdition.ok) {
    if (porteEdition.status === 403) console.warn(`[academie/edition] modification refusee (pas admin) compte=${tronquer(p.userId)}`)
    return refusAcademie(porteEdition.erreur, porteEdition.status, headers)
  }
  const demande = porteEdition.demande

  let issue: IssueEdition
  try {
    issue = await enregistrerEdition(p.userId, demande)
  } catch (err) {
    const message = messageErreur(err)
    // Une contrainte de la base (23514) que la lecture n'a pas vue : la demande, pas le serveur.
    if (/\b23514\b|check constraint/i.test(message)) return refusAcademie('demande', 400, headers)
    console.warn(`[academie/edition] enregistrement impossible ${demande.cible}=${demande.id} : ${
      relationAbsente(err) ? 'tables academie absentes' : message}`)
    return refusAcademie('indisponible', 503, headers)
  }

  if (issue.issue === 'introuvable') return refusAcademie('introuvable', 404, headers)
  if (issue.issue === 'conflit') return refusAcademie('conflit', 409, headers)
  if (issue.issue === 'refus') return refusAcademie(issue.erreur, 400, headers)

  // Jamais le texte dans les logs : les champs seulement.
  console.info(`[academie/edition] ${demande.cible}=${demande.id} compte=${tronquer(p.userId)} champs=${
    Object.keys(demande.champs).join(',')} modifies=${issue.modifies}`)
  return NextResponse.json({ ok: true, ...texteVersJson(issue.texte), modifies: issue.modifies }, { headers })
}
