// L'EFFACEMENT D'UNE PERSONNE, cote besoins des membres : les regles pures
// (finitions du 06/11/2026). Serveur : effacer.ts. Inventaire qui fait foi :
// docs/EFFACEMENT-DONNEES.md (section 5.3).
//
// cockpit_effacer emporte les demandes qui ont un fil (cle etrangere en
// cascade sur SupportThread), pas les demandes sans fil (bouton des outils,
// saisie de l'equipe), ni les votes, ni les captures du bucket prive. La
// fonction besoins_effacer (migration 20261106180000, UN seul ordre SQL) les
// efface et rend les chemins des captures que plus aucune demande ne nomme.

import { cheminCaptureValide } from './bouton-pur'

export const MIGRATION_BESOINS_EFFACEMENT = '20261106180000_besoins_effacement.sql'

/**
 * Les cibles COMPLETES d'une personne (cockpit_effacement_cibles), lues AVANT
 * cockpit_effacer : au niveau 3 il supprime les comptes AOK, les emails des
 * fiches et les rattachements qui les retrouvent.
 */
export type CiblesBesoins = { telegram: number[]; comptes: string[]; emails: string[]; membres: string[] }

/** Ce que l'etape des besoins a fait (rien de nominatif : des nombres, et des chemins d'objets a retirer a la main). */
export type IssueBesoins =
  | { etat: 'fait'; demandes: number; votes: number; captures: number; capturesRestees: string[] }
  | { etat: 'absente' }
  | { etat: 'panne' }

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type Ids = { telegram: readonly unknown[]; membres: readonly unknown[]; emails: readonly unknown[] }

/** La cible donnee et la cible complete, reunies et nettoyees (aucune valeur que la base refuserait). */
export function ciblesBesoins(cible: Ids, completes: Ids & { comptes: readonly unknown[] }): CiblesBesoins {
  const uniques = <T>(l: T[]) => [...new Set(l)]
  const uuids = (l: readonly unknown[]) => uniques(l.map((x) => String(x).trim().toLowerCase())).filter((x) => RE_UUID.test(x))
  return {
    telegram: uniques([...cible.telegram, ...completes.telegram].map(Number)).filter((x) => Number.isSafeInteger(x) && x > 0),
    comptes: uuids(completes.comptes),
    emails: uniques([...cible.emails, ...completes.emails].map((x) => String(x).trim().toLowerCase()))
      .filter((x) => x.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(x)),
    membres: uuids([...cible.membres, ...completes.membres]),
  }
}

export function cibleBesoinsVide(c: CiblesBesoins): boolean {
  return !c.telegram.length && !c.comptes.length && !c.emails.length && !c.membres.length
}

/**
 * Le JSON rendu par besoins_effacer, ou null s'il est illisible. Un chemin
 * qui n'a pas la forme du bucket (AAAA-MM/<sha256>.<ext>) est ecarte : on ne
 * retire jamais un autre objet.
 */
export function lireBesoinsEffaces(brut: unknown): { demandes: number; votes: number; captures: string[] } | null {
  let o: unknown = brut
  if (typeof brut === 'string') {
    try { o = JSON.parse(brut) } catch { return null }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const r = o as Record<string, unknown>
  const entier = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null)
  const demandes = entier(r.demandes)
  const votes = entier(r.votes)
  if (demandes === null || votes === null || !Array.isArray(r.captures)) return null
  return { demandes, votes, captures: [...new Set(r.captures.filter(cheminCaptureValide))] }
}

/** La fonction n'existe pas encore (migration pas appliquee). */
export function fonctionBesoinsAbsente(message: string): boolean {
  return /42883|function public\.besoins_effacer\([^)]*\) does not exist/i.test(message)
}

/**
 * Les lignes du resultat pour l'equipe, placees avant le recapitulatif a
 * transmettre a la personne (rien quand il n'y avait rien). Jamais un nom, un
 * email ni un identifiant : des nombres, et les chemins des captures que le
 * stockage n'a pas retirees (derives des octets de l'image, pas de la personne).
 */
export function lignesBesoins(b: IssueBesoins | null | undefined): string[] {
  if (!b) return []
  const quoi = 'ses besoins notés (demandes sans fil, saisies de l\'équipe, votes, captures)'
  if (b.etat === 'absente') {
    return [`ATTENTION : la migration ${MIGRATION_BESOINS_EFFACEMENT} n'est pas appliquée, ${quoi} ne sont pas effacés : à reprendre à la main.`]
  }
  if (b.etat === 'panne') return [`ATTENTION : ${quoi} n'ont pas pu être effacés : à reprendre à la main.`]
  const l: string[] = []
  if (b.demandes || b.votes || b.captures) {
    l.push(`Besoins notés : ${b.demandes} demande(s) et ${b.votes} vote(s) effacés`
      + `${b.captures ? `, ${b.captures} capture(s) retirée(s) du stockage` : ''}.`)
  }
  if (b.capturesRestees.length) {
    l.push(`ATTENTION : ${b.capturesRestees.length} capture(s) pas retirée(s) du bucket privé besoins-captures (stockage en panne), `
      + `à retirer à la main : ${b.capturesRestees.join(', ')}.`)
  }
  return l
}
