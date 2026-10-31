// Les abonnements aux emails d'un compte (31/10/2026, decision de Brice) :
// la logique, sans base ni reseau. Le serveur (kit-abonnements.ts) lui donne
// un client Kit (kit.ts) et un depot (kit-abonnements-depot.ts) ; le
// verificateur lui donne des faux (scripts/verifier-kit-abonnements.mjs).
//
// Les regles :
// - Tout vaut pour l'adresse des communications du compte
//   (aok_email_communications : l'adresse cochee dans Mon espace, sinon la
//   principale).
// - Le compte est lie a UN abonne Kit (profile_kit). Quand l'adresse des
//   communications change, l'abonne suit : meme abonne, nouvelle adresse,
//   tags gardes (PUT de l'adresse chez Kit).
// - Si la nouvelle adresse est deja un AUTRE abonne Kit (Kit refuse deux
//   abonnes a la meme adresse) : on garde celui-la, on lui recopie l'etat des
//   choix de l'ancien, on lie le compte a lui et on desinscrit l'ancien (pas
//   de doublon : un seul abonne recoit nos emails).
// - « Tout desactiver » retire les tags des choix, sans jamais desinscrire de
//   Kit : on revient en un clic.
// - Un abonne desinscrit (lien de desinscription d'un email) le reste : l'API
//   ne le reabonne pas. Ses choix s'enregistrent quand meme, la carte lui dit
//   que rien ne part tant qu'il ne s'est pas reinscrit.
// - Chaque choix change par le membre laisse une ligne dans le journal des
//   consentements (preuve, surtout pour les promos).

import type { AbonneKit, ClientKit } from './kit'
import type { ChoixKit } from './kit-choix'

export type EtatKit = 'absent' | 'actif' | 'desinscrit' | 'inactif'
export type Resynchro = 'non' | 'lie' | 'adresse' | 'fusion'
export type SourceConsentement = 'mon_espace' | 'changement_adresse'

export type LigneConsentement = { type: string; tag: number; valeur: boolean; source: SourceConsentement; kitId: number }

/** Ce que les abonnements lisent et ecrivent en base. */
export type DepotAbonnements = {
  /** aok_email_communications : l'adresse ou nous ecrivons au membre, ou null. */
  adresse(userId: string): Promise<string | null>
  prenom(userId: string): Promise<string | null>
  /** L'id de l'abonne Kit lie au compte, ou null. */
  lien(userId: string): Promise<number | null>
  /** Lie (ou relie) le compte a cet abonne. false : il est deja lie a un AUTRE compte. */
  lier(userId: string, kitId: number): Promise<boolean>
  delier(userId: string): Promise<void>
  consentir(userId: string, lignes: LigneConsentement[]): Promise<void>
}

export type Dependances = { kit: ClientKit; depot: DepotAbonnements; choix: readonly ChoixKit[] }

export type ChoixAffiche = { cle: string; libelle: string; detail: string; actif: boolean }

export type Abonnements = {
  adresse: string | null
  etat: EtatKit
  choix: ChoixAffiche[]
  resynchro: Resynchro
}

export type IssueAbonnements =
  | { ok: true; abonnements: Abonnements }
  | { ok: false; erreur: 'demande' | 'adresse' | 'conflit' }

/** L'etat d'un abonne Kit tel que la carte le montre. */
export function etatDe(a: AbonneKit | null): EtatKit {
  if (!a) return 'absent'
  if (a.etat === 'active') return 'actif'
  if (a.etat === 'inactive') return 'inactif'
  return 'desinscrit' // cancelled, bounced, complained : Kit n'envoie plus rien
}

const meme = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Le corps de POST /api/compte/abonnements : { choix: { <cle>: boolean } }.
 * Seules les cles connues, seulement des booleens, au moins une. Une cle
 * absente ne change pas.
 */
export function lireDemande(corps: unknown, choix: readonly ChoixKit[]): Record<string, boolean> | null {
  if (!corps || typeof corps !== 'object') return null
  const brut = (corps as { choix?: unknown }).choix
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return null
  const connues = new Set(choix.map(c => c.cle))
  const demande: Record<string, boolean> = {}
  for (const [cle, valeur] of Object.entries(brut as Record<string, unknown>)) {
    if (!connues.has(cle) || typeof valeur !== 'boolean') return null
    demande[cle] = valeur
  }
  return Object.keys(demande).length ? demande : null
}

/** Les choix affiches, d'apres les tags de l'abonne. */
export function choixAffiches(choix: readonly ChoixKit[], tags: Iterable<number>): ChoixAffiche[] {
  const poses = new Set(tags)
  return choix.map(c => ({ cle: c.cle, libelle: c.libelle, detail: c.detail, actif: poses.has(c.tag) }))
}

/** Les ids de tags que l'inscription pose d'office. */
export const tagsInscription = (choix: readonly ChoixKit[]) => choix.filter(c => c.inscription).map(c => c.tag)

type Relie =
  | { ok: true; adresse: string | null; abonne: AbonneKit | null; resynchro: Resynchro }
  | { ok: false; erreur: 'conflit' }

/**
 * Relie le compte a l'abonne Kit de son adresse des communications, et fait
 * suivre l'abonne quand l'adresse a change. Ne cree jamais d'abonne (seul un
 * choix du membre le fait).
 */
export async function relier(d: Dependances, userId: string): Promise<Relie> {
  const adresse = await d.depot.adresse(userId)
  if (!adresse) return { ok: true, adresse: null, abonne: null, resynchro: 'non' }

  const lienId = await d.depot.lien(userId)
  let lie = lienId ? await d.kit.abonne(lienId) : null
  if (lienId && !lie) await d.depot.delier(userId) // supprime chez Kit : on repart de l'adresse
  if (lie && meme(lie.email, adresse)) return { ok: true, adresse, abonne: lie, resynchro: 'non' }

  let parAdresse = await d.kit.abonneParEmail(adresse)

  if (!lie) {
    if (!parAdresse) return { ok: true, adresse, abonne: null, resynchro: 'non' }
    if (!(await d.depot.lier(userId, parAdresse.id))) return { ok: false, erreur: 'conflit' }
    return { ok: true, adresse, abonne: parAdresse, resynchro: 'lie' }
  }

  // L'abonne lie porte une autre adresse : il suit, si personne n'a deja la nouvelle.
  if (!parAdresse) {
    if ((await d.kit.changerEmail(lie.id, adresse)) === 'ok') {
      lie = { ...lie, email: adresse }
      return { ok: true, adresse, abonne: lie, resynchro: 'adresse' }
    }
    // Course : l'adresse vient d'apparaitre chez Kit. On la relit et on fusionne.
    parAdresse = await d.kit.abonneParEmail(adresse)
    if (!parAdresse) return { ok: false, erreur: 'conflit' }
  }
  if (parAdresse.id === lie.id) return { ok: true, adresse, abonne: lie, resynchro: 'non' }

  // Fusion : on garde l'abonne de la nouvelle adresse, avec les choix de l'ancien.
  if (!(await d.depot.lier(userId, parAdresse.id))) return { ok: false, erreur: 'conflit' }
  const ancien = new Set(await d.kit.tagsDe(lie.id))
  const nouveau = new Set(await d.kit.tagsDe(parAdresse.id))
  const lignes: LigneConsentement[] = []
  try {
    for (const c of d.choix) {
      const veut = ancien.has(c.tag)
      if (veut === nouveau.has(c.tag)) continue
      if (veut) await d.kit.poserTag(c.tag, parAdresse.id)
      else await d.kit.retirerTag(c.tag, parAdresse.id)
      lignes.push({ type: c.cle, tag: c.tag, valeur: veut, source: 'changement_adresse', kitId: parAdresse.id })
    }
  } finally {
    if (lignes.length) await d.depot.consentir(userId, lignes)
  }
  await d.kit.desinscrire(lie.id)
  return { ok: true, adresse, abonne: parAdresse, resynchro: 'fusion' }
}

/** GET : l'adresse, l'etat Kit et les choix, relus chez Kit (apres resynchronisation). */
export async function lireAbonnements(d: Dependances, userId: string): Promise<IssueAbonnements> {
  const r = await relier(d, userId)
  if (!r.ok) return r
  const tags = r.abonne ? await d.kit.tagsDe(r.abonne.id) : []
  return { ok: true, abonnements: { adresse: r.adresse, etat: etatDe(r.abonne), choix: choixAffiches(d.choix, tags), resynchro: r.resynchro } }
}

/**
 * POST : applique les choix demandes (cles absentes inchangees). Cree
 * l'abonne s'il manque et qu'au moins un choix est coche. Rend l'etat relu.
 */
export async function enregistrerAbonnements(d: Dependances, userId: string, demande: Record<string, boolean>): Promise<IssueAbonnements> {
  const r = await relier(d, userId)
  if (!r.ok) return r
  if (!r.adresse) return { ok: false, erreur: 'adresse' }

  let abonne = r.abonne
  if (!abonne) {
    if (!d.choix.some(c => demande[c.cle] === true)) {
      return { ok: true, abonnements: { adresse: r.adresse, etat: 'absent', choix: choixAffiches(d.choix, []), resynchro: r.resynchro } }
    }
    abonne = (await d.kit.creerAbonne(r.adresse, await d.depot.prenom(userId))).abonne
    if (!(await d.depot.lier(userId, abonne.id))) return { ok: false, erreur: 'conflit' }
  }

  const poses = new Set(await d.kit.tagsDe(abonne.id))
  const lignes: LigneConsentement[] = []
  try {
    for (const c of d.choix) {
      const veut = demande[c.cle]
      if (typeof veut !== 'boolean' || veut === poses.has(c.tag)) continue
      if (veut) await d.kit.poserTag(c.tag, abonne.id)
      else await d.kit.retirerTag(c.tag, abonne.id)
      if (veut) poses.add(c.tag)
      else poses.delete(c.tag)
      lignes.push({ type: c.cle, tag: c.tag, valeur: veut, source: 'mon_espace', kitId: abonne.id })
    }
  } finally {
    if (lignes.length) await d.depot.consentir(userId, lignes)
  }
  const relus = await d.kit.tagsDe(abonne.id)
  return { ok: true, abonnements: { adresse: r.adresse, etat: etatDe(abonne), choix: choixAffiches(d.choix, relus), resynchro: r.resynchro } }
}
