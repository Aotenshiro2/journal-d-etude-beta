import { NextRequest, NextResponse } from 'next/server'
import { droitsAcademie, type DroitsAcademie } from '@/lib/academie/droits'
import { lireCatalogue, type Catalogue } from '@/lib/academie/catalogue'
import { construire } from '@/lib/academie/vue-moi'
import { compteDuJeton, corsAcademie, entetesAcademie, origineDeLaRequete, refusAcademie, tronquer } from '@/lib/academie/http'
import { noterConnexion, progressionDuCompte, type ProgressionLecon } from '@/lib/academie/suivi'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * GET /api/academie/moi : tout ce dont les ecrans de l'academie ont besoin,
 * en un appel (PLAN-ACADEMIE.md, sections 8 et 12, V1 point 4) : l'accueil
 * (« Continuer », « Mes cours », « Tous les cours » verrouilles), la page
 * module et le plan des lecons.
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>.
 * Reponse 200 :
 *   {
 *     ok: true,
 *     compte: { admin, etm, live_club },   live_club : oui, non, inconnu, non_lu (pas demande)
 *     incomplet,                            true = une source illisible (Stripe) : des contenus sont « inconnu »
 *     continuer: { lecon, module, reprise_s, derniere_vue_le, acces, etat } | null,   la derniere lecon ouverte
 *     modules: [{ id, slug, titre, resume, parcours, ordre, statut, auteur, image,
 *                 prix_eur,                 prix du module vendu seul, null = pas vendu seul
 *                 offres: [{ slug, titre, type, prix_eur, portee }],   ce qui l'ouvre (portee : module,
 *                                           sections = une partie, tout = l'offre ouvre tout, ETM)
 *                 acces: entier | partiel | ferme | inconnu, raisons,
 *                 progression: { lecons, vues, en_cours, ouvertes, commencees, pourcentage },
 *                           pourcentage = part des lecons ACCESSIBLES a l'eleve a l'etat 'vu'
 *                           (toutes les publiees s'il n'en a aucune) ; accessibles = leur nombre ;
 *                           commencees = lecons ouvertes au moins une fois (ouvert, en_cours ou vu)
 *                 sections: [{ id, ordre, titre, acces, raisons }],
 *                 lecons: [{ id, slug, section_id, ordre, titre, type, format, duree_s, apercu, statut,
 *                            lisible, acces, raisons,
 *                            etat: non_vu | ouvert | en_cours | vu,
 *                            progression | null }] }]
 *   }
 * etat (Brice, 15/10) : non_vu = jamais ouverte ; ouvert = lien ou contenu
 * delivre, rien de consomme ; en_cours = du temps reellement regarde ou lu ;
 * vu = 60 % regardes, fin de la video, texte lu jusqu'en bas ou clic
 * (progression.vu_par : mesure, fin, texte_fin, eleve).
 * progression = { reprise_s, position_max_s, secondes_vues, pourcentage,
 *   terminee_le, marquee_vue_le, vu_le, vu_par, derniere_vue_le, vue }.
 * Modules publies ou a venir, lecons publiees ou a venir (lisible = false
 * pour ce qui est annonce). JAMAIS d'identifiant Bunny ou Wistia ni de
 * contenu : seule la route de lecture les delivre, apres le droit.
 * 401 'jeton', 503 'indisponible' (base ou Supabase Auth illisible).
 *
 * Note une connexion dans le journal des lectures (au plus une par 30 min).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const METHODES = 'GET, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}


export async function GET(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)

  let userId: string | null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[academie/moi] verification du jeton impossible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!userId) return refus('jeton', 401)

  let droits: DroitsAcademie
  let catalogue: Catalogue
  let progression: Map<string, ProgressionLecon>
  try {
    [droits, catalogue, progression] = await Promise.all([
      droitsAcademie(userId),
      lireCatalogue(),
      progressionDuCompte(userId),
    ])
  } catch (err) {
    console.warn(`[academie/moi] lecture impossible compte=${tronquer(userId)} : ${
      relationAbsente(err) ? 'tables academie absentes' : messageErreur(err)}`)
    return refus('indisponible', 503)
  }

  try {
    await noterConnexion(userId, origineDeLaRequete(req))
  } catch (err) {
    console.warn(`[academie/moi] connexion NON notee compte=${tronquer(userId)} : ${messageErreur(err)}`)
  }

  if (droits.incomplet) {
    console.warn(`[academie/moi] droits incomplets compte=${tronquer(userId)} (${droits.erreurs.join(', ')})`)
  }

  const { modules, continuer } = construire(catalogue, droits, progression)
  return NextResponse.json(
    {
      ok: true,
      compte: { admin: droits.admin, etm: droits.etm, live_club: droits.liveClub },
      incomplet: droits.incomplet,
      continuer,
      modules,
    },
    { headers },
  )
}
