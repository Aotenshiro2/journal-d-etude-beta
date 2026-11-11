import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { droitsAcademie, type DroitsAcademie } from '@/lib/academie/droits'
import { lireCatalogue, type Catalogue } from '@/lib/academie/catalogue'
import { construire } from '@/lib/academie/vue-moi'
import { compteDuJeton, corsAcademie, entetesAcademie, origineDeLaRequete, refusAcademie, tronquer } from '@/lib/academie/http'
import { etatQuestions, vueQuestions, type EtatQuestions } from '@/lib/academie/questions-entree'
import { noterConnexion, progressionDuCompte, type ProgressionLecon } from '@/lib/academie/suivi'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'
import { soutienDuCompte, type SoutienDuCompte } from '@/lib/soutien'

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
 *     compte: { admin, etm, equipe, vip, live_club, live_club_source, autres_adresses },   live_club : oui, non, inconnu,
 *                           non_lu (pas demande) ;
 *                           equipe (09/11/2026) : statut equipe AOK (estEquipe), live_club vaut alors 'oui' ;
 *                           etm : statut ETM actif ; vip (10/11/2026) : rang Skool vip d'une fiche du cockpit
 *                           reliee au compte. Deux booleens pour la tete de Mon espace (« Élève ETM »,
 *                           « Membre VIP ») : rien d'autre de la fiche ne part au navigateur ;
 *                           live_club_source (10/11/2026) : exemption, broker ou manuel quand live_club vaut
 *                           'oui' par une source sans Stripe (un ETM ou un VIP y est lu aussi), null sinon ;
 *                           autres_adresses (10/11/2026, restes) : le NOMBRE d'adresses de la fiche du cockpit
 *                           reliee au compte confirmees sur aucun compte du site, pour le rappel « Comptes
 *                           lies » de Mon espace (jamais les adresses) ;
 *                           soutien (11/11/2026, src/lib/soutien.ts) : { carnet, pilotage, aok }, true = un abonnement
 *                           de soutien actif sur l'app (badge « Soutien » de Mon espace), aok = un soutien
 *                           AOKnowledge actif (/soutenir, soutien-aok.ts), null = Stripe illisible,
 *                           null entier = lecture en echec ; jamais un identifiant Stripe
 *     incomplet,                            true = une source illisible (Stripe) : des contenus sont « inconnu »
 *     continuer: { lecon, module, reprise_s, derniere_vue_le, acces, etat } | null,   la derniere lecon ouverte
 *     questions_entree: { poser, version, questions: [texte, texte] },   les questions d'entree (30/10/2026,
 *                           questions-entree.ts) : poser = compte non admin qui n'a ni repondu ni passe
 *                           (faux si la table est absente ou illisible : /moi ne tombe jamais pour elles)
 *     modules: [{ id, slug, titre, resume, parcours, ordre, statut, auteur, image,
 *                 prix_eur,                 prix du module vendu seul, null = pas vendu seul
 *                 lien_externe,             https vers un autre site (Masterclass) ou null ; rempli =
 *                                           ni lecons ni offres, acces 'entier' sans raison (pas de cadenas),
 *                                           progression a zero : le site fait de la carte un lien
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
 *                            progression | null,
 *                            live?: { le, type, organisations, intervenants } }] }]
 *   }
 * live (11/11/2026, Rediffusion des Lives, migration 20261111010000) : la date du live (AAAA-MM-JJ),
 * son type (slug), ses organisations et intervenants (noms affiches). Absent hors des lecons de live
 * et avant la migration.
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

  // Le badge « Soutien » (11/11/2026) : relu chez Stripe en parallele, borne a 4 s, jamais bloquant.
  const soutien: Promise<SoutienDuCompte | null> = soutienDuCompte(userId).catch(() => null)

  // Les questions d'entree : une panne ou la table absente ne fait jamais tomber /moi (rien n'est pose).
  const questions: Promise<EtatQuestions> = etatQuestions(prisma, userId).catch((err: unknown) => {
    if (!relationAbsente(err)) console.warn(`[academie/moi] questions d'entree illisibles compte=${tronquer(userId)} : ${messageErreur(err)}`)
    return 'indisponible' as const
  })

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
      compte: {
        admin: droits.admin, etm: droits.etm, equipe: droits.equipe, vip: droits.vip, live_club: droits.liveClub,
        live_club_source: droits.sourceLiveClub,
        autres_adresses: droits.autresAdresses,
        soutien: await soutien,
      },
      incomplet: droits.incomplet,
      continuer,
      modules,
      questions_entree: vueQuestions(await questions, droits.admin),
    },
    { headers },
  )
}
