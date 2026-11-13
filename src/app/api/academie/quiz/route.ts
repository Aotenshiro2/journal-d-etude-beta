import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { droitsAcademie, type DroitsAcademie } from '@/lib/academie/droits'
import { lireCatalogue, type Catalogue, type ModuleCatalogue } from '@/lib/academie/catalogue'
import { compteDuJeton, corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { ouvertureLecon, ouvertureModule, type Droits, type ResultatModule } from '@/lib/academie/pur'
import {
  CORPS_QUIZ_MAX, MAX_QUIZ_HEURE, corriger, dernierResultat, droitAuQuiz, envoisSurUneHeure, lireDemandeQuiz, lireSlug,
  noterResultat, quizDuModule, quizVisible, vueQuiz,
} from '@/lib/academie/quiz-academie'

/**
 * /api/academie/quiz : le QUIZ DE FIN DE MODULE (13/11/2026, inventaire B9 ; src/lib/academie/quiz-academie.ts,
 * migration 20261113231500_academie_quiz.sql).
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>.
 *
 * GET ?module=<slug>
 *   200 { ok: true, quiz: { version, brouillon, questions: [{ id, question, lecon, choix: [{ id, texte }] }] } | null,
 *         dernier: { version, bonnes, total, fait_le } | null }
 *   quiz null : le module n'a pas de quiz (ou la migration n'est pas appliquee). Un quiz « brouillon » (a relire par
 *   Brice) n'est rendu qu'a l'equipe (admin ou statut equipe), avec brouillon: true. Jamais la bonne reponse.
 *
 * POST { module, version, reponses: { <id de question>: <id de choix> } }
 *   200 { ok: true, bonnes, total, corrections: [{ question, choisie, bonne, juste, explication, lecon }],
 *         enregistre, fait_le }
 *   La correction se fait ici ; le resultat est garde (academie_quiz_resultats) sauf pour un brouillon.
 *
 * Dans l'ordre, comme les autres routes de l'academie : le compte (jeton verifie), le module (publie, au
 * catalogue), le DROIT sur le module (droitsAcademie, meme regle que /moi : ouvert en entier ou en partie, pas
 * seulement par un apercu ou le billet du jour), puis le quiz.
 * 400 'module' | 'version' | 'reponses' | 'longueur' ; 401 'jeton' ; 403 'acces' ; 404 'module' | 'quiz' ;
 * 409 'version' (le quiz a change depuis l'ouverture de la page : la recharger) ; 429 'limite' (30 envois par heure) ;
 * 503 'indisponible' (base, Supabase Auth, Stripe).
 *
 * Logs : compte tronque, module, score. Jamais les reponses.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const METHODES = 'GET, POST, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

type Contexte =
  | { ok: true; userId: string; module: ModuleCatalogue; droits: DroitsAcademie }
  | { ok: false; reponse: NextResponse }

/**
 * L'acces d'un compte a un module, avec la meme regle que /moi (vue-moi.ts, construire) : les lecons PUBLIEES
 * jugees une a une (ouvertureLecon), puis le module (ouvertureModule).
 */
function accesAuModule(catalogue: Pick<Catalogue, 'lecons'>, droits: Droits, moduleId: string): ResultatModule {
  const publiees = catalogue.lecons.filter(l => l.moduleId === moduleId && l.statut === 'publie')
  return ouvertureModule(droits, moduleId, publiees.map(l => ouvertureLecon(droits, l)))
}

/** Le compte, le module et le droit sur le module : ce que GET et POST verifient avant le quiz. */
async function verifier(req: NextRequest, slugBrut: unknown, headers: Record<string, string>): Promise<Contexte> {
  const refus = (erreur: string, status: number) => ({ ok: false as const, reponse: refusAcademie(erreur, status, headers) })

  let userId: string | null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[academie/quiz] verification du jeton impossible : ${codeErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!userId) return refus('jeton', 401)

  const slug = lireSlug(slugBrut)
  if (!slug) return refus('module', 400)

  let catalogue: Catalogue
  let droits: DroitsAcademie
  try {
    [catalogue, droits] = await Promise.all([lireCatalogue(), droitsAcademie(userId)])
  } catch (err) {
    console.warn(`[academie/quiz] catalogue ou droits illisibles compte=${tronquer(userId)} : ${codeErreur(err)}`)
    return refus('indisponible', 503)
  }
  const mod = catalogue.modules.find(m => m.slug === slug && m.statut === 'publie' && !m.lienExterne)
  if (!mod) return refus('module', 404)

  const droit = droitAuQuiz(accesAuModule(catalogue, droits, mod.id))
  if (droit === 'inconnu') {
    console.warn(`[academie/quiz] droit inconnu compte=${tronquer(userId)} module=${slug}`)
    return refus('indisponible', 503)
  }
  if (droit !== 'oui') {
    console.info(`[academie/quiz] refus compte=${tronquer(userId)} module=${slug}`)
    return refus('acces', 403)
  }
  return { ok: true, userId, module: mod, droits }
}

export async function GET(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const ctx = await verifier(req, req.nextUrl.searchParams.get('module'), headers)
  if (!ctx.ok) return ctx.reponse
  const { userId, module: mod, droits } = ctx

  try {
    const quiz = await quizDuModule(prisma, mod.id)
    if (quiz === 'migration' || quiz === null || !quizVisible(quiz, droits)) {
      return NextResponse.json({ ok: true, quiz: null, dernier: null }, { headers })
    }
    const dernier = await dernierResultat(prisma, userId, mod.id)
    return NextResponse.json({ ok: true, quiz: vueQuiz(quiz), dernier }, { headers })
  } catch (err) {
    console.warn(`[academie/quiz] lecture NON faite compte=${tronquer(userId)} module=${mod.slug} : ${codeErreur(err)}`)
    return refusAcademie('indisponible', 503, headers)
  }
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)

  const brut = await req.text().catch(() => '')
  if (brut.length > CORPS_QUIZ_MAX) return refus('longueur', 400)
  let corps: unknown = {}
  try { corps = JSON.parse(brut || '{}') } catch { corps = {} }
  const d = lireDemandeQuiz(corps)
  if (!d.ok) {
    // Le compte d'abord : sans jeton valable, 401 plutot qu'une faute de forme.
    try {
      if (!(await compteDuJeton(req))) return refus('jeton', 401)
    } catch (err) {
      console.warn(`[academie/quiz] verification du jeton impossible : ${codeErreur(err)}`)
      return refus('indisponible', 503)
    }
    return refus(d.erreur, 400)
  }

  const ctx = await verifier(req, d.demande.module, headers)
  if (!ctx.ok) return ctx.reponse
  const { userId, module: mod, droits } = ctx

  try {
    const quiz = await quizDuModule(prisma, mod.id)
    if (quiz === 'migration' || quiz === null || !quizVisible(quiz, droits)) return refus('quiz', 404)
    if (quiz.version !== d.demande.version) return refus('version', 409)

    const resultat = corriger(quiz, d.demande.reponses)
    if (!resultat) return refus('reponses', 400)

    // Un brouillon (relecture par l'equipe) n'est pas garde : il ne compte pour personne.
    let faitLe: string | null = null
    if (quiz.statut === 'publie') {
      if (await envoisSurUneHeure(prisma, userId) >= MAX_QUIZ_HEURE) {
        console.info(`[academie/quiz] limite compte=${tronquer(userId)} module=${mod.slug}`)
        return refus('limite', 429)
      }
      faitLe = await noterResultat(prisma, userId, mod.id, quiz.version, resultat.bonnes, resultat.total, d.demande.reponses)
    }
    console.info(`[academie/quiz] envoi compte=${tronquer(userId)} module=${mod.slug} v${quiz.version} : ${resultat.bonnes}/${resultat.total}${
      quiz.statut === 'publie' ? (faitLe ? '' : ' (non garde : table absente)') : ' (brouillon, non garde)'}`)
    return NextResponse.json({
      ok: true,
      bonnes: resultat.bonnes,
      total: resultat.total,
      corrections: resultat.corrections,
      enregistre: faitLe !== null,
      fait_le: faitLe,
    }, { headers })
  } catch (err) {
    console.warn(`[academie/quiz] envoi NON fait compte=${tronquer(userId)} module=${mod.slug} : ${codeErreur(err)}`)
    return refus('indisponible', 503)
  }
}

/** Le code de l'erreur (Prisma, Postgres) ou son nom : jamais son message. */
function codeErreur(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; meta?: { code?: unknown } }
  const codes = [e.code, e.meta?.code].filter((x): x is string => typeof x === 'string')
  return codes.length ? codes.join('/') : err instanceof Error ? err.name : 'erreur'
}
