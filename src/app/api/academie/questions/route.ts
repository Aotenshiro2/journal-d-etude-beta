import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { CORPS_MAX, enregistrerQuestions, lireSaisieQuestions } from '@/lib/academie/questions-entree'
import { relationAbsente } from '@/lib/liveclub/pur'

/**
 * POST /api/academie/questions : les QUESTIONS D'ENTREE de l'academie
 * (30/10/2026, src/lib/academie/questions-entree.ts, migration
 * 20261031170000_academie_questions_entree.sql).
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>. Le site sait
 * s'il faut poser les questions par /api/academie/moi (questions_entree.poser).
 *
 * Corps : { version, reponse_1?, reponse_2?, passe?: true, essai?: true }
 *   reponses facultatives (texte nettoye des caracteres de controle et
 *   invisibles, 2000 caracteres au plus chacune), au moins une si pas passe.
 *   UNE seule fois par compte : une deuxieme ecriture ne remplace pas la premiere.
 *   essai (?questions=essai de Brice) : tout est verifie, rien n'est ecrit.
 * 200 { ok: true, deja: false }   enregistre
 * 200 { ok: true, deja: true }    le compte avait deja repondu ou passe (rien ne change)
 * 200 { ok: true, essai: true }   essai, rien d'ecrit
 * 400 'version' | 'reponse' | 'longueur' | 'vide' ; 401 'jeton' ;
 * 503 'indisponible' (base, Supabase Auth, ou migration pas appliquee).
 *
 * Logs : compte tronque, version, passe ou reponses. JAMAIS le texte d'une reponse.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const METHODES = 'POST, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)

  let userId: string | null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[academie/questions] verification du jeton impossible : ${codeErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!userId) return refus('jeton', 401)

  const brut = await req.text().catch(() => '')
  if (brut.length > CORPS_MAX) return refus('longueur', 400)
  let corps: unknown = {}
  try { corps = JSON.parse(brut || '{}') } catch { corps = {} }

  const saisie = lireSaisieQuestions(corps)
  if ('erreur' in saisie) return refus(saisie.erreur, 400)
  const quoi = saisie.passe ? 'passe' : `reponses=${saisie.reponses.filter(r => r !== null).length}`

  if (saisie.essai) {
    console.info(`[academie/questions] essai compte=${tronquer(userId)} version=${saisie.version} ${quoi} : rien d'ecrit`)
    return NextResponse.json({ ok: true, essai: true }, { headers })
  }

  try {
    const issue = await enregistrerQuestions(prisma, userId, saisie)
    console.info(`[academie/questions] ${issue === 'deja' ? 'deja fait' : 'enregistre'} compte=${tronquer(userId)} version=${saisie.version} ${quoi}`)
    return NextResponse.json({ ok: true, deja: issue === 'deja' }, { headers })
  } catch (err) {
    // Jamais le message brut : il peut reprendre les valeurs de la requete (les reponses).
    console.warn(`[academie/questions] NON enregistre compte=${tronquer(userId)} : ${
      relationAbsente(err) ? 'table academie_questions_entree absente (migration 20261031170000)' : codeErreur(err)}`)
    return refus('indisponible', 503)
  }
}

/** Le code de l'erreur (Prisma, Postgres) ou son nom : jamais son message. */
function codeErreur(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; meta?: { code?: unknown } }
  const codes = [e.code, e.meta?.code].filter((x): x is string => typeof x === 'string')
  return codes.length ? codes.join('/') : err instanceof Error ? err.name : 'erreur'
}
