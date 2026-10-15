import { NextRequest, NextResponse } from 'next/server'
import { compteDuJeton, corsAcademie, entetesAcademie, origineDeLaRequete, refusAcademie, tronquer } from '@/lib/academie/http'
import { lireSignal } from '@/lib/academie/pur'
import { enregistrerSignal, type IssueEnregistrement } from '@/lib/academie/suivi'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * POST /api/academie/suivi : les signaux de la page de lecon (PLAN-ACADEMIE.md,
 * section 7, preuve de consommation). Le serveur note lui-meme ce que l'eleve
 * regarde ou lit ; le clic « vu » est a part et ne remplace pas la mesure.
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>, corps
 *   { lecon, evenement, position_s?, secondes?, vu? }
 *   - evenement 'lecture' (toutes les 30 s pendant la lecture), 'pause',
 *     'fin' : videos ; position_s = position du lecteur ; secondes = temps
 *     REELLEMENT joue depuis le dernier signal accepte (sauts exclus, mesure
 *     par la page avec les evenements timeupdate et seeked de player.js).
 *   - evenement 'texte' : texte ou pdf ; secondes = temps ou la page etait
 *     visible depuis le dernier signal accepte.
 *   - evenement 'vu' : le bouton « marquer comme vu » (vu: false retire la
 *     marque).
 *   La page remet son compteur de secondes a zero seulement sur un 200 : un
 *   signal refuse (429) garde ses secondes pour le suivant.
 *
 * Le temps credite est borne par le temps ecoule cote serveur (2x pour une
 * video, 1x pour un texte, plus 5 s) : une avance rapide ne compte pas
 * (pur.ts, appliquerSignal). Une lecon est terminee a 90 % de sa duree
 * reellement regardee.
 *
 * Reponses :
 *   200 { ok: true, credit_s, progression: { ... } }
 *   400 { ok: false, erreur: 'signal' }     corps illisible, ou evenement d'un autre type de lecon
 *   401 { ok: false, erreur: 'jeton' }
 *   409 { ok: false, erreur: 'lien' }       aucun lien delivre pour cette lecon (ou depuis plus de 24 h) :
 *                                           la page redemande /api/academie/lecture
 *   429 { ok: false, erreur: 'debit', reessayer_dans_s }  un signal par lecon toutes les 20 s
 *                                           (3 s pour 'fin' et 'vu'), ou un signal concurrent
 *   503 { ok: false, erreur: 'indisponible' }
 *
 * Le droit n'est pas recalcule a chaque signal : un signal n'est accepte que
 * pour une lecon dont la route de lecture a delivre le lien (donc verifie le
 * droit) depuis moins de 24 h.
 */

export const maxDuration = 15

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req) })
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req)
  const refus = (erreur: string, status: number, extra?: Record<string, unknown>) =>
    refusAcademie(erreur, status, headers, extra)

  let userId: string | null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[academie/suivi] verification du jeton impossible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!userId) return refus('jeton', 401)

  const lu = lireSignal(await req.json().catch(() => ({})))
  if (!lu) return refus('signal', 400)

  let issue: IssueEnregistrement
  try {
    issue = await enregistrerSignal(userId, lu.lecon, lu.signal, origineDeLaRequete(req))
  } catch (err) {
    console.warn(`[academie/suivi] signal non enregistre compte=${tronquer(userId)} lecon=${lu.lecon} : ${
      relationAbsente(err) ? 'tables academie absentes' : messageErreur(err)}`)
    return refus('indisponible', 503)
  }

  if (issue.issue === 'sans_lien') return refus('lien', 409)
  if (issue.issue === 'course') return refus('debit', 429, { reessayer_dans_s: 5 })
  if (issue.issue === 'refus') {
    const d = issue.detail
    if (d.refus === 'debit') return refus('debit', 429, { reessayer_dans_s: d.reessayerDansS })
    if (d.refus === 'lien') return refus('lien', 409)
    return refus('signal', 400)
  }

  const p = issue.progression
  return NextResponse.json(
    {
      ok: true,
      credit_s: issue.credit,
      progression: {
        derniere_position_s: p.dernierePositionS,
        position_max_s: p.positionMaxS,
        secondes_vues: p.secondesVues,
        pourcentage: p.pourcentage,
        terminee_le: p.termineeLe?.toISOString() ?? null,
        marquee_vue_le: p.marqueeVueLe?.toISOString() ?? null,
      },
    },
    { headers },
  )
}
