import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { droitsAcademie, type DroitsAcademie } from '@/lib/academie/droits'
import { lireLeconParId, type LeconComplete } from '@/lib/academie/catalogue'
import { corsAcademie, entetesAcademie, refusAcademie, tronquer } from '@/lib/academie/http'
import { ouvertureLecon } from '@/lib/academie/pur'
import {
  CORPS_MAX, MAX_QUESTIONS_JOUR, SQL_NOTER_PREVENUE, lireDemandeEleve, poseesSur24h, poserQuestion, questionsDeLecon, restantes,
  vuePourMembre,
} from '@/lib/academie/questions-lecons'
import { alerterQuestion } from '@/lib/academie/questions-lecons-envois'
import { compteCompletDuJeton } from '@/lib/compte-membre'
import { relationAbsente } from '@/lib/liveclub/pur'

/**
 * POST /api/academie/questions-lecon : les QUESTIONS SOUS UNE LECON
 * (09/11/2026, src/lib/academie/questions-lecons.ts, migration
 * 20261109090000_academie_questions_lecons.sql).
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>.
 * Corps :
 *   { action: 'lire', lecon }              ce que ce compte voit sous la lecon
 *   { action: 'poser', lecon, question }   une question (texte seul, 1000 caracteres)
 * Dans l'ordre, comme /api/academie/lecture : le compte (jeton verifie), la
 * lecon (publiee, module publie), le DROIT sur la lecon (droitsAcademie +
 * ouvertureLecon : tout compte qui l'ouvre, gratuits compris), puis la table.
 * Un compte ne recoit que les questions publiees et les siennes
 * (questionsPourMembre) ; jamais un identifiant de compte ni un email.
 *
 * 200 { ok: true, questions: [...], restantes, max }                     lire
 * 200 { ok: true, question: {...}, restantes, max, prevenue }            poser
 * 400 'action' | 'lecon' | 'question' | 'vide' | 'longueur' ; 401 'jeton' ;
 * 403 'acces' (pas de droit sur la lecon) ; 404 'lecon' ; 409 'a_venir' ;
 * 429 'limite' (5 questions sur 24 heures) ;
 * 503 'indisponible' (base, Supabase Auth, Stripe, ou migration pas appliquee : code 'migration').
 *
 * Logs : compte tronque, lecon, action, nombre. JAMAIS le texte d'une question ni un email.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const METHODES = 'POST, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (erreur: string, status: number, extra: Record<string, unknown> = {}) => refusAcademie(erreur, status, headers, extra)

  // 1. Le compte (avec son email confirme, pour l'alerte a l'equipe).
  let compte: { id: string; email: string | null } | null
  try {
    compte = await compteCompletDuJeton(req.headers.get('authorization'))
  } catch (err) {
    console.warn(`[academie/questions-lecon] verification du jeton impossible : ${codeErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!compte) return refus('jeton', 401)

  // 2. La demande.
  const brut = await req.text().catch(() => '')
  if (brut.length > CORPS_MAX) return refus('longueur', 400)
  let corps: unknown = {}
  try { corps = JSON.parse(brut || '{}') } catch { corps = {} }
  const d = lireDemandeEleve(corps)
  if ('erreur' in d) return refus(d.erreur, 400)

  // 3. La lecon, lue fraiche.
  let lecon: LeconComplete | null
  try {
    lecon = await lireLeconParId(d.lecon)
  } catch (err) {
    console.warn(`[academie/questions-lecon] lecon illisible : ${codeErreur(err)}`)
    return refus('indisponible', 503)
  }
  const visible = (s: string) => s === 'publie' || s === 'a_venir'
  if (!lecon || !visible(lecon.statut) || !visible(lecon.moduleStatut)) return refus('lecon', 404)
  if (lecon.statut === 'a_venir' || lecon.moduleStatut === 'a_venir') return refus('a_venir', 409)

  // 4. Le droit sur la lecon : la meme regle que la lecture.
  let droits: DroitsAcademie
  try {
    droits = await droitsAcademie(compte.id)
  } catch (err) {
    console.warn(`[academie/questions-lecon] droits illisibles : ${codeErreur(err)}`)
    return refus('indisponible', 503)
  }
  const ouverture = ouvertureLecon(droits, lecon)
  if (ouverture.acces === 'inconnu') {
    console.warn(`[academie/questions-lecon] droit inconnu compte=${tronquer(compte.id)} lecon=${lecon.id}`)
    return refus('indisponible', 503)
  }
  if (ouverture.acces !== 'ouvert') {
    console.info(`[academie/questions-lecon] refus compte=${tronquer(compte.id)} lecon=${lecon.id}`)
    return refus('acces', 403)
  }

  // 5. La table.
  try {
    if (d.action === 'lire') {
      const [liste, posees] = await Promise.all([questionsDeLecon(prisma, lecon.id, compte.id), poseesSur24h(prisma, compte.id)])
      console.info(`[academie/questions-lecon] lire compte=${tronquer(compte.id)} lecon=${lecon.id} : ${liste.length} ligne(s)`)
      return NextResponse.json({ ok: true, questions: liste, restantes: restantes(posees), max: MAX_QUESTIONS_JOUR }, { headers })
    }

    const ligne = await poserQuestion(prisma, compte.id, lecon.id, d.question)
    if (ligne === 'limite') {
      console.info(`[academie/questions-lecon] limite compte=${tronquer(compte.id)} lecon=${lecon.id}`)
      return refus('limite', 429, { restantes: 0, max: MAX_QUESTIONS_JOUR })
    }
    const posees = await poseesSur24h(prisma, compte.id).catch(() => MAX_QUESTIONS_JOUR)

    // L'alerte a l'equipe, au mieux : la question est deja enregistree.
    const livres = await alerterQuestion({ qui: compte.email, moduleTitre: lecon.moduleTitre, leconTitre: lecon.titre, question: d.question })
    if (livres > 0) await prisma.$executeRawUnsafe(SQL_NOTER_PREVENUE, ligne.id).catch(() => 0)

    console.info(`[academie/questions-lecon] posee compte=${tronquer(compte.id)} lecon=${lecon.id}, equipe ${livres > 0 ? 'prevenue' : 'NON prevenue'}`)
    return NextResponse.json({
      ok: true,
      question: vuePourMembre(ligne, compte.id),
      restantes: restantes(posees),
      max: MAX_QUESTIONS_JOUR,
      prevenue: livres > 0,
    }, { headers })
  } catch (err) {
    // Jamais le message brut : il peut reprendre les valeurs de la requete (le texte du membre).
    if (relationAbsente(err)) {
      console.warn('[academie/questions-lecon] table academie_questions_lecons absente (migration 20261109090000)')
      return refus('indisponible', 503, { code: 'migration' })
    }
    console.warn(`[academie/questions-lecon] ${d.action} NON fait compte=${tronquer(compte.id)} lecon=${lecon.id} : ${codeErreur(err)}`)
    return refus('indisponible', 503)
  }
}

/** Le code de l'erreur (Prisma, Postgres) ou son nom : jamais son message. */
function codeErreur(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; meta?: { code?: unknown } }
  const codes = [e.code, e.meta?.code].filter((x): x is string => typeof x === 'string')
  return codes.length ? codes.join('/') : err instanceof Error ? err.name : 'erreur'
}
