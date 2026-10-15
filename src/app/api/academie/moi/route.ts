import { NextRequest, NextResponse } from 'next/server'
import { droitsAcademie, type DroitsAcademie } from '@/lib/academie/droits'
import { lireCatalogue, type Catalogue, type LeconCatalogue, type SectionCatalogue } from '@/lib/academie/catalogue'
import { compteDuJeton, corsAcademie, entetesAcademie, origineDeLaRequete, refusAcademie, tronquer } from '@/lib/academie/http'
import {
  etatLecon, ouvertureLecon, ouvertureModule, ouvertureSection, progressionDuModule, type Resultat,
} from '@/lib/academie/pur'
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

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null

function progressionPublique(p: ProgressionLecon | undefined) {
  if (!p) return null
  return {
    reprise_s: p.dernierePositionS,
    position_max_s: p.positionMaxS,
    secondes_vues: p.secondesVues,
    pourcentage: p.pourcentage,
    terminee_le: iso(p.termineeLe),
    marquee_vue_le: iso(p.marqueeVueLe),
    vu_le: iso(p.vuLe),
    vu_par: p.vuPar,
    derniere_vue_le: iso(p.derniereVueLe),
    vue: p.etat === 'vu',
  }
}

function grouper<T>(elements: readonly T[], cle: (e: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const e of elements) {
    const k = cle(e)
    const liste = m.get(k)
    if (liste) liste.push(e)
    else m.set(k, [e])
  }
  return m
}

function construire(catalogue: Catalogue, droits: DroitsAcademie, progression: Map<string, ProgressionLecon>) {
  const sectionsParModule = grouper<SectionCatalogue>(catalogue.sections, s => s.moduleId)
  const leconsParModule = grouper<LeconCatalogue>(catalogue.lecons, l => l.moduleId)
  const resultats = new Map<string, Resultat>()

  const modules = catalogue.modules.map(m => {
    const lecons = leconsParModule.get(m.id) ?? []
    const jugees = lecons.map(l => {
      const r = ouvertureLecon(droits, l)
      resultats.set(l.id, r)
      return { l, r, lisible: m.statut === 'publie' && l.statut === 'publie' }
    })
    const publiees = jugees.filter(j => j.l.statut === 'publie')
    const acces = ouvertureModule(droits, m.id, publiees.map(j => j.r))
    // Pourcentage sur les lecons que l'eleve a le droit de voir (Brice, 15/10/2026) : un membre du Live Club
    // atteint 100 % une fois sa partie finie, le cadenas montre la suite. Sans lecon ouverte, sur toutes.
    const suivi = progressionDuModule(publiees.map(j => ({ acces: j.r.acces, etat: etatLecon(progression.get(j.l.id)) })))

    return {
      id: m.id,
      slug: m.slug,
      titre: m.titre,
      resume: m.resume,
      parcours: m.parcours,
      ordre: m.ordre,
      statut: m.statut,
      auteur: m.auteur,
      image: m.image,
      prix_eur: m.prixEur,
      offres: (catalogue.offresParModule.get(m.id) ?? []).map(o => ({
        slug: o.slug, titre: o.titre, type: o.type, prix_eur: o.prixEur, portee: o.portee,
      })),
      acces: acces.acces,
      raisons: acces.raisons,
      progression: suivi,
      sections: (sectionsParModule.get(m.id) ?? []).map(s => {
        const r = ouvertureSection(droits, s)
        return { id: s.id, ordre: s.ordre, titre: s.titre, acces: r.acces, raisons: r.raisons }
      }),
      lecons: jugees.map(({ l, r, lisible }) => ({
        id: l.id,
        slug: l.slug,
        section_id: l.sectionId,
        ordre: l.ordre,
        titre: l.titre,
        type: l.type,
        format: l.format,
        duree_s: l.dureeS,
        apercu: l.apercu,
        statut: l.statut,
        lisible,
        acces: r.acces,
        raisons: r.raisons,
        etat: etatLecon(progression.get(l.id)),
        progression: progressionPublique(progression.get(l.id)),
      })),
    }
  })

  // « Continuer » : la derniere lecon ouverte qui est encore au catalogue.
  const leconsParId = new Map(catalogue.lecons.map(l => [l.id, l]))
  const modulesParId = new Map(catalogue.modules.map(m => [m.id, m]))
  let derniere: { p: ProgressionLecon; l: LeconCatalogue } | null = null
  for (const p of progression.values()) {
    const l = leconsParId.get(p.leconId)
    if (!l) continue
    if (!derniere || p.derniereVueLe > derniere.p.derniereVueLe) derniere = { p, l }
  }
  let continuer = null
  if (derniere) {
    const { l } = derniere
    const m = modulesParId.get(l.moduleId)
    continuer = {
      lecon: { id: l.id, slug: l.slug, titre: l.titre, type: l.type, duree_s: l.dureeS },
      module: m ? { id: m.id, slug: m.slug, titre: m.titre } : null,
      reprise_s: derniere.p.dernierePositionS,
      derniere_vue_le: iso(derniere.p.derniereVueLe),
      acces: resultats.get(l.id)?.acces ?? 'ferme',
      etat: derniere.p.etat,
    }
  }

  return { modules, continuer }
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
