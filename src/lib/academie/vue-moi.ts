// La reponse de /api/academie/moi construite depuis le catalogue, les droits
// et la progression (sortie de la route le 19/10/2026 pour servir aussi
// /api/academie/catalogue, la vue d'un visiteur sans compte). Le contrat est
// decrit en tete de src/app/api/academie/moi/route.ts.

import type { Catalogue, LeconCatalogue, SectionCatalogue } from './catalogue'
import type { Droits } from './pur'
import { etatLecon, ouvertureLecon, ouvertureModule, ouvertureSection, progressionDuModule, type Resultat } from './pur'
import type { ProgressionLecon } from './suivi'

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

export function construire(catalogue: Catalogue, droits: Droits, progression: Map<string, ProgressionLecon>) {
  const sectionsParModule = grouper<SectionCatalogue>(catalogue.sections, s => s.moduleId)
  const leconsParModule = grouper<LeconCatalogue>(catalogue.lecons, l => l.moduleId)
  const resultats = new Map<string, Resultat>()

  const modules = catalogue.modules.map(m => {
    // Module a lien externe (Masterclass, 26/10/2026) : une carte qui envoie vers un autre site de
    // l'ecosysteme. Pas de lecons, pas de cadenas (l'acces se gere la-bas), compte dans aucun pourcentage.
    if (m.lienExterne) {
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
        prix_eur: null,
        lien_externe: m.lienExterne,
        offres: [],
        acces: 'entier' as const,
        raisons: [],
        progression: progressionDuModule([]),
        sections: [],
        lecons: [],
      }
    }
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
      lien_externe: null,
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
