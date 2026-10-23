// L'edition des textes de l'academie dans l'app, par l'admin (23/10/2026, lot
// D:\6_Societe\Pilotage\Academie\lots\LOT-EDITION-IN-APP-ADMIN.md).
//
// V1 : le titre et le texte (contenu, Markdown) d'une lecon, le titre et le
// resume d'un module. Chaque enregistrement :
//   - pose edite_le, edite_par (l'importeur du catalogue garde alors ces
//     textes, sauf --ecraser-editions) ;
//   - garde l'ancienne valeur de chaque champ qui change dans
//     academie_editions (cible, champ, avant, apres, par, le) ;
//   - ne passe que si la ligne n'a pas bouge depuis que l'editeur l'a lue
//     (version = maj_le) : sinon 'conflit', rien n'est ecrit ;
//   - vide le cache du catalogue de l'instance.
// Le droit (admin seulement) est verifie par la route AVANT d'arriver ici.
//
// Les requetes sont celles de requetes.ts, jouees telles quelles par
// scripts/essayer-migration-edition-academie.mjs (transaction annulee).

import { prisma } from '@/lib/db'
import { viderCacheCatalogue } from './catalogue'
import { planEdition, type CibleEdition, type DemandeEdition, type TextesEdition } from './pur'
import {
  SQL_EDITION_ECRIRE_LECON, SQL_EDITION_ECRIRE_MODULE, SQL_EDITION_LIRE_LECON, SQL_EDITION_LIRE_MODULE,
} from './requetes'

/** Ce que l'editeur montre et renvoie. */
export type TexteEditable = {
  cible: CibleEdition
  id: string
  /** { titre, contenu } pour une lecon, { titre, resume } pour un module. */
  textes: TextesEdition
  editeLe: Date | null
  version: string
  /** Lecon seulement : la base refuse une lecon ecrite publiee sans texte. */
  type?: string | null
  statut?: string | null
}

type LigneLecon = {
  id: string; titre: string; contenu: string | null; type: string; statut: string; edite_le: Date | null; version: string
}
type LigneModule = { id: string; titre: string; resume: string | null; edite_le: Date | null; version: string }
type LigneEcrite = {
  id: string; titre: string; contenu?: string | null; resume?: string | null; edite_le: Date | null; version: string
  historique: number
}

/** Les textes actuels d'une lecon ou d'un module, ou null s'il n'existe pas. Jette sur une panne de base. */
export async function lireTexteEditable(cible: CibleEdition, id: string): Promise<TexteEditable | null> {
  if (cible === 'lecon') {
    const l = (await prisma.$queryRawUnsafe<LigneLecon[]>(SQL_EDITION_LIRE_LECON, id))[0]
    if (!l) return null
    return {
      cible, id: l.id, textes: { titre: l.titre, contenu: l.contenu }, editeLe: l.edite_le, version: l.version,
      type: l.type, statut: l.statut,
    }
  }
  const m = (await prisma.$queryRawUnsafe<LigneModule[]>(SQL_EDITION_LIRE_MODULE, id))[0]
  if (!m) return null
  return { cible, id: m.id, textes: { titre: m.titre, resume: m.resume }, editeLe: m.edite_le, version: m.version }
}

export type IssueEdition =
  | { issue: 'ok'; texte: TexteEditable; modifies: number }
  | { issue: 'introuvable' }
  | { issue: 'conflit' }
  | { issue: 'refus'; erreur: 'contenu' }

/** Enregistre la demande de l'admin userId. Jette sur une panne de base. */
export async function enregistrerEdition(userId: string, demande: DemandeEdition): Promise<IssueEdition> {
  const actuel = await lireTexteEditable(demande.cible, demande.id)
  if (!actuel) return { issue: 'introuvable' }

  const plan = planEdition(actuel, demande)
  if (!plan.ok) return { issue: 'refus', erreur: plan.erreur }
  // Rien ne change : rien a ecrire, ni date, ni historique.
  if (!plan.historique.length) return { issue: 'ok', texte: actuel, modifies: 0 }

  const version = demande.version ?? actuel.version
  const lecon = demande.cible === 'lecon'
  const lignes = await prisma.$queryRawUnsafe<LigneEcrite[]>(
    lecon ? SQL_EDITION_ECRIRE_LECON : SQL_EDITION_ECRIRE_MODULE,
    demande.id, version, plan.valeurs.titre, lecon ? plan.valeurs.contenu : plan.valeurs.resume, userId,
    JSON.stringify(plan.historique),
  )
  const e = lignes[0]
  if (!e) return { issue: 'conflit' }
  viderCacheCatalogue()
  return {
    issue: 'ok',
    texte: {
      ...actuel,
      textes: lecon ? { titre: e.titre, contenu: e.contenu ?? null } : { titre: e.titre, resume: e.resume ?? null },
      editeLe: e.edite_le,
      version: e.version,
    },
    modifies: e.historique,
  }
}

/** La forme JSON rendue a la page (GET et PATCH). */
export function texteVersJson(t: TexteEditable) {
  return {
    cible: t.cible,
    id: t.id,
    ...t.textes,
    edite_le: t.editeLe ? t.editeLe.toISOString() : null,
    version: t.version,
  }
}
