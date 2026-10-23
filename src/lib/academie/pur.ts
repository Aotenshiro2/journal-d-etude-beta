// Fonctions PURES de l'academie (15/10/2026) : la regle d'acces, le calcul
// du suivi, la lecture des corps de requete et deux petits utilitaires. Aucune
// base, aucun reseau, aucun alias d'import (seulement node:net) : c'est voulu,
// scripts/verifier-academie.mjs les teste avec Node seul (suppression des
// types de Node 22), comme src/lib/liveclub/pur.ts.
//
// Plan : D:\6_Societe\Pilotage\Academie\PLAN-ACADEMIE.md, sections 4.3 (la
// regle d'acces, une seule fonction) et 7 (le suivi, la preuve de
// consommation). Le serveur decide, jamais la page.

import { isIP } from 'node:net'

// ---------------------------------------------------------------------------
// Les mots
// ---------------------------------------------------------------------------

/** Offres reconnues par leur slug (donnees de depart de la migration 20261015210000). */
export const OFFRE_COMPTE_GRATUIT = 'compte-gratuit'
export const OFFRE_LIVE_CLUB = 'live-club'
/** Module de la page d'essai (15/10) : il garde la decision B en secours, voir FaitsCompte.secoursEssai. */
export const MODULE_ESSAI = 'essai'

export type SourceAcces = 'stripe' | 'paypal' | 'migration_skool' | 'liveclub' | 'offert'
export type Usage = 'interne' | 'externe_libre' | 'externe_compte' | 'externe_payant'
export type TypeLecon = 'video' | 'texte' | 'pdf'

/**
 * Pourquoi un contenu est ouvert. Dans l'ordre d'affichage (ORDRE_RAISONS) :
 * admin (profiles.role), etm (cockpit_statut_etm), achat (acces stripe ou
 * paypal), skool (acces migration_skool), offert (acces offert par
 * l'equipe), liveclub (Live Club actif : paquet du moment ou paquet
 * d'entree), essai (secours de la decision B sur le module d'essai), compte
 * (tout compte : offre compte gratuit, usage externe_compte ou
 * externe_libre), apercu (lecon d'apercu).
 */
export type Raison = 'admin' | 'etm' | 'achat' | 'skool' | 'offert' | 'liveclub' | 'essai' | 'compte' | 'apercu'

export const ORDRE_RAISONS: readonly Raison[] = [
  'admin', 'etm', 'achat', 'skool', 'offert', 'liveclub', 'essai', 'compte', 'apercu',
]

/**
 * Le droit Live Club du compte. 'non_lu' : pas demande, parce qu'il ne pouvait
 * rien changer (admin, ETM, ou aucun contenu qui en depende). 'inconnu' : une
 * source illisible (Stripe en panne ou trop lent) et aucun 'oui' ailleurs.
 */
export type EtatLiveClub = 'oui' | 'non' | 'inconnu' | 'non_lu'

/** Ce qu'une ouverture couvre : tout le catalogue, un module entier, ou une section. */
export type Cible =
  | { tout: true }
  | { tout: false; moduleId: string; sectionId: string | null }

export type Ouverture = {
  cible: Cible
  raison: Raison
  /** Ne compte que si le droit Live Club est actif (paquet d'entree, plan 4.3). */
  siLiveClub: boolean
}

/**
 * Une ligne de la requete SQL_ACCES (requetes.ts) :
 * - 'acces' : un acces actif du compte (par user_id ou email verifie), une
 *   ligne par contenu de son offre (moduleId vide = offre sans contenu) ;
 * - 'base' : les contenus des offres compte gratuit et Live Club ;
 * - 'essai' : le module d'essai (moduleId), pour le secours de la decision B.
 */
export type LigneAcces = {
  origine: 'acces' | 'base' | 'essai'
  source: string | null
  slug: string | null
  ouvreTout: boolean
  moduleId: string | null
  sectionId: string | null
}

export type FaitsCompte = {
  admin: boolean
  etm: boolean
  liveClub: EtatLiveClub
  /**
   * Decision B du 06/10 (page d'essai : tout membre payant), lue sans Stripe :
   * rang Skool vip ou premium, abonnement en cours vu par le cockpit, acces
   * mentorat manuel. N'ouvre QUE le module d'essai, jusqu'a ce que le
   * transvasage pose les vrais acces (migration_skool). A retirer ensuite.
   */
  secoursEssai: boolean
  lignes: LigneAcces[]
}

export type Droits = {
  admin: boolean
  etm: boolean
  liveClub: EtatLiveClub
  ouvertures: Ouverture[]
  /** Une source illisible pouvait ouvrir quelque chose : un 'ferme' peut etre faux. */
  incomplet: boolean
}

export type Ouvert = 'ouvert' | 'ferme' | 'inconnu'
export type Resultat = { acces: Ouvert; raisons: Raison[] }
export type ResultatModule = { acces: 'entier' | 'partiel' | 'ferme' | 'inconnu'; raisons: Raison[] }

const RAISON_DE_SOURCE: Readonly<Record<SourceAcces, Raison>> = {
  stripe: 'achat',
  paypal: 'achat',
  migration_skool: 'skool',
  offert: 'offert',
  liveclub: 'liveclub',
}

function estSource(s: unknown): s is SourceAcces {
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(RAISON_DE_SOURCE, s)
}

// ---------------------------------------------------------------------------
// La regle d'acces (plan 4.3)
// ---------------------------------------------------------------------------

/**
 * L'union des droits d'un compte, sans le catalogue : chaque ouverture dit ce
 * qu'elle couvre et pourquoi. ouvertureLecon, ouvertureSection et
 * ouvertureModule l'appliquent ensuite a un contenu.
 */
export function preparerDroits(f: FaitsCompte): Droits {
  const ouvertures: Ouverture[] = []
  const tout: Cible = { tout: true }
  if (f.admin) ouvertures.push({ cible: tout, raison: 'admin', siLiveClub: false })
  if (f.etm) ouvertures.push({ cible: tout, raison: 'etm', siLiveClub: false })

  for (const l of f.lignes) {
    let raison: Raison | null = null
    let siLiveClub = false
    if (l.origine === 'acces') {
      if (!estSource(l.source)) continue
      raison = RAISON_DE_SOURCE[l.source]
      siLiveClub = l.source === 'liveclub'
    } else if (l.origine === 'base') {
      if (l.slug === OFFRE_COMPTE_GRATUIT) raison = 'compte'
      else if (l.slug === OFFRE_LIVE_CLUB) { raison = 'liveclub'; siLiveClub = true }
    } else if (l.origine === 'essai') {
      if (f.secoursEssai) raison = 'essai'
    }
    if (!raison) continue
    if (l.ouvreTout && l.origine !== 'essai') {
      ouvertures.push({ cible: tout, raison, siLiveClub })
    } else if (l.moduleId) {
      ouvertures.push({
        cible: { tout: false, moduleId: l.moduleId, sectionId: l.origine === 'essai' ? null : l.sectionId },
        raison,
        siLiveClub,
      })
    }
  }

  const incomplet = f.liveClub === 'inconnu' && ouvertures.some(o => o.siLiveClub)
  return { admin: f.admin, etm: f.etm, liveClub: f.liveClub, ouvertures, incomplet }
}

type Niveau = 'module' | 'section' | 'lecon'

function couvre(c: Cible, moduleId: string, sectionId: string | null, niveau: Niveau): boolean {
  if (c.tout) return true
  if (c.moduleId !== moduleId) return false
  if (c.sectionId === null) return true
  // Une section ouverte n'ouvre pas le module entier, ni une lecon hors section.
  return niveau !== 'module' && sectionId !== null && c.sectionId === sectionId
}

export function trierRaisons(raisons: Iterable<Raison>): Raison[] {
  const vues = new Set(raisons)
  return ORDRE_RAISONS.filter(r => vues.has(r))
}

function evaluer(d: Droits, moduleId: string, sectionId: string | null, niveau: Niveau): { sures: Set<Raison>; possibles: Set<Raison> } {
  const sures = new Set<Raison>()
  const possibles = new Set<Raison>()
  for (const o of d.ouvertures) {
    if (!couvre(o.cible, moduleId, sectionId, niveau)) continue
    if (!o.siLiveClub || d.liveClub === 'oui') sures.add(o.raison)
    else if (d.liveClub === 'inconnu') possibles.add(o.raison)
  }
  return { sures, possibles }
}

function conclure(sures: Set<Raison>, possibles: Set<Raison>): Resultat {
  if (sures.size) return { acces: 'ouvert', raisons: trierRaisons(sures) }
  if (possibles.size) return { acces: 'inconnu', raisons: trierRaisons(possibles) }
  return { acces: 'ferme', raisons: [] }
}

export type LeconPourDroit = { moduleId: string; sectionId: string | null; usage: string; apercu: boolean }

/**
 * Une lecon est ouverte si son module ou sa section est ouvert, ou si elle
 * est d'usage externe (compte ou libre), ou d'apercu. 'inconnu' : seule une
 * source illisible (Live Club) pouvait l'ouvrir. Ne regarde PAS le statut
 * (publie, brouillon) : c'est le travail de la route.
 */
export function ouvertureLecon(d: Droits, l: LeconPourDroit): Resultat {
  const { sures, possibles } = evaluer(d, l.moduleId, l.sectionId, 'lecon')
  if (l.usage === 'externe_compte' || l.usage === 'externe_libre') sures.add('compte')
  if (l.apercu) sures.add('apercu')
  return conclure(sures, possibles)
}

export function ouvertureSection(d: Droits, s: { id: string; moduleId: string }): Resultat {
  const { sures, possibles } = evaluer(d, s.moduleId, s.id, 'section')
  return conclure(sures, possibles)
}

/**
 * Le module : 'entier' s'il est ouvert en entier (ou si toutes ses lecons
 * publiees le sont), 'partiel' si une partie l'est, 'inconnu' si seule une
 * source illisible pouvait l'ouvrir, 'ferme' sinon. lecons = le resultat de
 * ouvertureLecon pour ses lecons PUBLIEES.
 */
export function ouvertureModule(d: Droits, moduleId: string, lecons: readonly Resultat[]): ResultatModule {
  const { sures, possibles } = evaluer(d, moduleId, null, 'module')
  if (sures.size) return { acces: 'entier', raisons: trierRaisons(sures) }
  const ouvertes = lecons.filter(r => r.acces === 'ouvert')
  const raisonsLecons = trierRaisons(ouvertes.flatMap(r => r.raisons))
  if (lecons.length > 0 && ouvertes.length === lecons.length) return { acces: 'entier', raisons: raisonsLecons }
  if (ouvertes.length > 0) return { acces: 'partiel', raisons: raisonsLecons }
  if (possibles.size || lecons.some(r => r.acces === 'inconnu')) {
    return { acces: 'inconnu', raisons: trierRaisons([...possibles, ...lecons.flatMap(r => r.raisons)]) }
  }
  return { acces: 'ferme', raisons: [] }
}

/**
 * Le Live Club peut-il changer quelque chose pour ce compte ? Sinon, inutile
 * de le demander a Stripe (admin et ETM ont deja tout, et un compte sans
 * paquet d'entree ni offre Live Club garnie n'a rien a y gagner).
 */
export function liveClubUtile(f: Omit<FaitsCompte, 'liveClub'>): boolean {
  if (f.admin || f.etm) return false
  return f.lignes.some(l =>
    (l.origine === 'acces' && l.source === 'liveclub' && (l.ouvreTout || l.moduleId !== null))
    || (l.origine === 'base' && l.slug === OFFRE_LIVE_CLUB && (l.ouvreTout || l.moduleId !== null)))
}

/**
 * Le droit Live Club a partir de ses sources, dans l'ordre : acces broker ou
 * acces manuel du cockpit (lus en base), puis Stripe MelTrade par email. Un
 * 'oui' tranche ; un 'non' demande que tout ait ete lu sans erreur.
 */
export function conclureLiveClub(o: { brokerOuManuel: boolean; stripe: readonly ('oui' | 'non' | 'inconnu')[] }): 'oui' | 'non' | 'inconnu' {
  if (o.brokerOuManuel) return 'oui'
  if (o.stripe.includes('oui')) return 'oui'
  if (o.stripe.includes('inconnu')) return 'inconnu'
  return 'non'
}

// ---------------------------------------------------------------------------
// Cache court (par instance)
// ---------------------------------------------------------------------------

/**
 * Cache memoire borne, avec une duree par entree. Vit dans l'instance (chaque
 * instance Vercel a le sien, un redemarrage le vide), comme celui du Carnet
 * Premium dans entitlements.ts.
 */
export class CacheCourt<V> {
  // Pas de « parameter properties » : la suppression des types de Node 22
  // (scripts/verifier-academie.mjs) ne sait pas les transformer.
  private readonly entrees = new Map<string, { valeur: V; expire: number }>()
  private readonly max: number
  private readonly horloge: () => number

  constructor(max: number, horloge: () => number = Date.now) {
    this.max = max
    this.horloge = horloge
  }

  lire(cle: string): V | undefined {
    const e = this.entrees.get(cle)
    if (!e) return undefined
    if (e.expire <= this.horloge()) {
      this.entrees.delete(cle)
      return undefined
    }
    return e.valeur
  }

  ecrire(cle: string, valeur: V, dureeMs: number): void {
    const maintenant = this.horloge()
    this.entrees.delete(cle) // reinseree en fin : l'ordre de la Map reste l'age
    if (this.entrees.size >= this.max) {
      for (const [k, v] of this.entrees) if (v.expire <= maintenant) this.entrees.delete(k)
    }
    while (this.entrees.size >= this.max) {
      const plusAncienne = this.entrees.keys().next().value
      if (plusAncienne === undefined) break
      this.entrees.delete(plusAncienne)
    }
    this.entrees.set(cle, { valeur, expire: maintenant + dureeMs })
  }

  /** Oublie une entree (un achat vient de changer les droits, 19/10/2026). */
  oublier(cle: string): void {
    this.entrees.delete(cle)
  }

  get taille(): number {
    return this.entrees.size
  }
}

// ---------------------------------------------------------------------------
// Corps des requetes
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Un uuid en minuscules, ou null. */
export function lireUuid(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null
  const v = valeur.trim().toLowerCase()
  return UUID_RE.test(v) ? v : null
}

/**
 * POST /api/academie/lecture : { lecon } (id de lecon) ou { video } (guid
 * Bunny, la page d'essai du 15/10). lecon l'emporte si les deux sont la.
 */
export function lireDemandeLecture(corps: unknown): { lecon: string } | { video: string } | null {
  const c = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>
  if (c.lecon !== undefined) {
    const lecon = lireUuid(c.lecon)
    return lecon ? { lecon } : null
  }
  const video = lireUuid(c.video)
  return video ? { video } : null
}

/**
 * Les signaux de la page. Videos : lecture (toutes les 30 s), pause, fin (la
 * video est arrivee au bout). Textes et PDF : texte (temps visible), texte_fin
 * (lu jusqu'en bas). Toutes : vu (le clic de l'eleve ; vu: false, ou
 * l'evenement 'non_vu' du corps, le retire).
 */
export type EvenementSignal = 'lecture' | 'pause' | 'fin' | 'texte' | 'texte_fin' | 'vu'
const EVENEMENTS: readonly EvenementSignal[] = ['lecture', 'pause', 'fin', 'texte', 'texte_fin', 'vu']

export type Signal = {
  evenement: EvenementSignal
  /** Position du lecteur (s), videos seulement. */
  positionS: number | null
  /**
   * Secondes REELLEMENT jouees (video) ou visibles (texte) depuis le dernier
   * signal accepte, mesurees par la page (sauts exclus). Le serveur les borne.
   */
  secondes: number | null
  /** 'vu' : true pose la marque, false la retire (decochage). */
  vu: boolean
}

function entierBorne(v: unknown, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null
  return Math.min(Math.floor(v), max)
}

/**
 * POST /api/academie/suivi : { lecon, evenement, position_s?, secondes?, vu? }.
 * evenement 'non_vu' = { evenement: 'vu', vu: false } (le decochage).
 */
export function lireSignal(corps: unknown): { lecon: string; signal: Signal } | null {
  const c = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>
  const lecon = lireUuid(c.lecon)
  const decoche = c.evenement === 'non_vu'
  const evenement = decoche ? 'vu' : EVENEMENTS.find(e => e === c.evenement)
  if (!lecon || !evenement) return null
  return {
    lecon,
    signal: {
      evenement,
      positionS: entierBorne(c.position_s, 86400),
      secondes: entierBorne(c.secondes, 86400),
      vu: !decoche && c.vu !== false,
    },
  }
}

// ---------------------------------------------------------------------------
// Le suivi (plan section 7)
// ---------------------------------------------------------------------------

/** Ecart minimal entre deux signaux d'un compte sur une lecon (debit). fin, texte_fin et vu sont ponctuels. */
export const ECART_MIN_S: Readonly<Record<EvenementSignal, number>> = {
  lecture: 20, pause: 20, texte: 20, fin: 3, texte_fin: 3, vu: 3,
}
/** Vitesse de lecture la plus haute du lecteur : 2x. */
export const VITESSE_MAX = 2
/** Tolerance (horloges, reseau). */
export const MARGE_S = 5
/** Au-dela, l'ecart entre deux signaux ne prouve plus rien (pause, onglet en veille). */
export const INTERVALLE_MAX_S = 120
/** Un signal n'est accepte que si un lien a ete delivre pour cette lecon depuis moins de 24 h. */
export const FRAICHEUR_LIEN_H = 24
/**
 * Une video passe « vue » quand 60 % de sa duree a ete REELLEMENT regardee
 * (Brice, 15/10 ; 90 % avant). C'est aussi le seuil de la preuve terminee_le.
 */
export const SEUIL_VU = 0.6

/**
 * Les quatre etats d'une lecon pour un eleve (Brice, 15/10) :
 * - non_vu : jamais ouverte (aucune ligne de progression) ;
 * - ouvert : ouverte (lien ou contenu delivre), rien de consomme ;
 * - en_cours : du temps reellement regarde ou lu, pas encore vue ;
 * - vu : posee par 60 % regardes, la fin de la video, un texte lu jusqu'en
 *   bas, ou le clic de l'eleve ; le decochage la ramene a en_cours ou ouvert.
 */
export type EtatLecon = 'non_vu' | 'ouvert' | 'en_cours' | 'vu'

/** La voie qui a pose « vu » (colonne vu_par). */
export type VuPar = 'mesure' | 'fin' | 'texte_fin' | 'eleve'

export function etatLecon(p: { secondesVues: number; vuLe: Date | null } | null | undefined): EtatLecon {
  if (!p) return 'non_vu'
  if (p.vuLe) return 'vu'
  return p.secondesVues > 0 ? 'en_cours' : 'ouvert'
}

export type EtatSuivi = {
  type: TypeLecon
  dureeS: number | null
  positionMaxS: number
  dernierePositionS: number
  secondesVues: number
  pourcentage: number | null
  termineeLe: Date | null
  /** Etat « vu » actuel (vide = pas vue). */
  vuLe: Date | null
  derniereVueLe: Date
  dernierSignalLe: Date | null
  nbSignaux: number
  /** L'heure de la base, lue avec l'etat. */
  maintenant: Date
}

export type MiseAJourSuivi = {
  positionMaxS: number
  dernierePositionS: number
  secondesVues: number
  pourcentage: number | null
  /** Le seuil mesure (60 % reellement regardes) est atteint pour la premiere fois : terminee_le (preuve). */
  terminer: boolean
  /** Le clic de l'eleve (marquee_vue_le). */
  marque: 'poser' | 'retirer' | null
  /** L'etat « vu » (vu_le, vu_par). null = inchange. */
  vu: 'poser' | 'retirer' | null
  vuPar: VuPar | null
  /** Ce qui part dans academie_lectures. */
  journal: { evenement: string; secondes: number | null; positionS: number | null }
}

export type IssueSignal =
  | { refus: 'type' }
  | { refus: 'lien' }
  | { refus: 'debit'; reessayerDansS: number }
  | { maj: MiseAJourSuivi; credit: number }

/**
 * Applique un signal de la page a l'etat d'une progression. Le temps credite
 * est celui que la page declare (secondes), ou a defaut l'avance de la
 * position, BORNE par le temps ecoule depuis le signal precedent (ou depuis
 * le lien) : au plus 2x ce temps pour une video, 1x pour un texte, plus 5 s.
 * Une avance rapide ne compte donc pas comme du visionnage.
 *
 * « vu » se pose tout seul quand une video franchit 60 % de temps reellement
 * regarde (un franchissement : apres un decochage, plus de visionnage ne la
 * recoche pas), sur 'fin' et sur 'texte_fin' ; et par le clic. Le decochage
 * retire vu et le clic ; terminee_le (preuve) et le journal restent.
 */
export function appliquerSignal(etat: EtatSuivi, signal: Signal): IssueSignal {
  const ev = signal.evenement
  const estVideo = etat.type === 'video'
  if ((ev === 'lecture' || ev === 'pause' || ev === 'fin') && !estVideo) return { refus: 'type' }
  if ((ev === 'texte' || ev === 'texte_fin') && estVideo) return { refus: 'type' }

  const maintenant = etat.maintenant.getTime()
  if (ev !== 'vu' && maintenant - etat.derniereVueLe.getTime() > FRAICHEUR_LIEN_H * 3600_000) {
    return { refus: 'lien' }
  }
  if (etat.dernierSignalLe) {
    const ecart = (maintenant - etat.dernierSignalLe.getTime()) / 1000
    if (ecart < ECART_MIN_S[ev]) {
      return { refus: 'debit', reessayerDansS: Math.max(1, Math.ceil(ECART_MIN_S[ev] - ecart)) }
    }
  }

  const duree = etat.dureeS && etat.dureeS > 0 ? etat.dureeS : null
  const positionMaxPossible = duree ?? 86400

  if (ev === 'vu') {
    return {
      credit: 0,
      maj: {
        positionMaxS: etat.positionMaxS,
        dernierePositionS: etat.dernierePositionS,
        secondesVues: etat.secondesVues,
        pourcentage: etat.pourcentage,
        terminer: false,
        marque: signal.vu ? 'poser' : 'retirer',
        vu: signal.vu ? (etat.vuLe ? null : 'poser') : 'retirer',
        vuPar: signal.vu && !etat.vuLe ? 'eleve' : null,
        journal: { evenement: signal.vu ? 'vu' : 'non_vu', secondes: null, positionS: null },
      },
    }
  }

  const depuis = Math.max(etat.dernierSignalLe?.getTime() ?? 0, etat.derniereVueLe.getTime())
  const ecoule = Math.min(Math.max(0, (maintenant - depuis) / 1000), INTERVALLE_MAX_S)

  let position: number | null = null
  let credit: number
  if (estVideo) {
    position = signal.positionS === null ? null : Math.min(signal.positionS, positionMaxPossible)
    const declare = signal.secondes
      ?? (position === null ? 0 : Math.max(0, position - etat.dernierePositionS))
    credit = Math.floor(Math.min(declare, ecoule * VITESSE_MAX + MARGE_S))
  } else {
    credit = Math.floor(Math.min(signal.secondes ?? 0, ecoule + MARGE_S))
  }

  const secondesVues = etat.secondesVues + credit
  const pourcentage = duree ? Math.min(100, Math.floor((secondesVues * 100) / duree)) : etat.pourcentage
  // Le seuil mesure, videos seulement : un texte passe vu par texte_fin ou le clic.
  const seuil = estVideo && duree !== null ? SEUIL_VU * duree : null
  const franchit = seuil !== null && etat.secondesVues < seuil && secondesVues >= seuil
  const terminer = !etat.termineeLe && seuil !== null && secondesVues >= seuil

  let vuPar: VuPar | null = null
  if (ev === 'fin') vuPar = 'fin'
  else if (ev === 'texte_fin') vuPar = 'texte_fin'
  else if (franchit) vuPar = 'mesure'
  const poserVu = vuPar !== null && !etat.vuLe

  return {
    credit,
    maj: {
      positionMaxS: position === null ? etat.positionMaxS : Math.max(etat.positionMaxS, position),
      dernierePositionS: position ?? etat.dernierePositionS,
      secondesVues,
      pourcentage,
      terminer,
      marque: null,
      vu: poserVu ? 'poser' : null,
      vuPar: poserVu ? vuPar : null,
      journal: { evenement: ev, secondes: credit, positionS: position },
    },
  }
}

/** Une lecon comptee comme vue (etat 'vu'). */
export function leconVue(p: { secondesVues: number; vuLe: Date | null } | null | undefined): boolean {
  return etatLecon(p) === 'vu'
}

export type ProgressionModule = {
  /** Lecons publiees. */
  lecons: number
  vues: number
  en_cours: number
  ouvertes: number
  /** Ouvertes au moins une fois (ouvert, en_cours ou vu). */
  commencees: number
  /** Lecons publiees que l'eleve a le droit de voir. */
  accessibles: number
  /** Part des lecons ACCESSIBLES a l'etat 'vu' (toutes les publiees s'il n'en a aucune). */
  pourcentage: number
}

/**
 * La progression d'un module pour /moi, sur ses lecons PUBLIEES (acces de
 * ouvertureLecon, etat de etatLecon). Brice, 15/10 : le pourcentage se compte
 * sur les lecons que l'eleve a le droit de voir ; un membre du Live Club
 * atteint 100 % une fois sa partie finie, le cadenas montre la suite. Sans
 * lecon ouverte, sur toutes.
 */
export function progressionDuModule(lecons: readonly { acces: Ouvert; etat: EtatLecon }[]): ProgressionModule {
  const compter = (e: EtatLecon) => lecons.filter(l => l.etat === e).length
  const accessibles = lecons.filter(l => l.acces === 'ouvert')
  const base = accessibles.length ? accessibles : lecons
  const vuesBase = base.filter(l => l.etat === 'vu').length
  return {
    lecons: lecons.length,
    vues: compter('vu'),
    en_cours: compter('en_cours'),
    ouvertes: compter('ouvert'),
    commencees: lecons.length - compter('non_vu'),
    accessibles: accessibles.length,
    pourcentage: base.length ? Math.round((vuesBase * 100) / base.length) : 0,
  }
}

// ---------------------------------------------------------------------------
// Catalogue et acces par fichier (scripts d'import et de l'alpha)
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Le champ « offres_sections » d'un fichier de module
 * (scripts/importer-catalogue-academie.mjs) : { "<offre>": ["<cle de
 * section>", ...] }, ou chaque cle est celle d'une section du fichier (comme
 * le champ « section » des lecons). Absent = aucun lien par section. Rend les
 * paires sans doublon ; jette si le champ est mal forme ou si une cle est
 * inconnue (l'import s'arrete, rien n'est ecrit).
 */
export function lireOffresSections(brut: unknown, clesConnues: ReadonlySet<string>): { offre: string; cle: string }[] {
  if (brut === undefined || brut === null) return []
  if (typeof brut !== 'object' || Array.isArray(brut)) {
    throw new Error('offres_sections doit etre un objet { "<offre>": ["<cle de section>", ...] }')
  }
  const paires: { offre: string; cle: string }[] = []
  const vues = new Set<string>()
  for (const [offre, cles] of Object.entries(brut as Record<string, unknown>)) {
    if (!SLUG_RE.test(offre)) throw new Error(`offres_sections : offre mal formee « ${offre} »`)
    if (!Array.isArray(cles)) throw new Error(`offres_sections.${offre} doit etre une liste de cles de section`)
    for (const cle of cles) {
      if (typeof cle !== 'string' || !clesConnues.has(cle)) {
        throw new Error(`offres_sections.${offre} : section inconnue « ${String(cle)} »`)
      }
      const k = `${offre}\u0000${cle}`
      if (vues.has(k)) continue
      vues.add(k)
      paires.push({ offre, cle })
    }
  }
  return paires
}

export type LigneCsvAcces = { numero: number; email: string; offre: string; source: SourceAcces; note: string | null }

const EMAIL_RE = /^[^\s@;,<>]+@[^\s@;,<>]+\.[^\s@;,<>]+$/

/**
 * Le CSV des acces de l'alpha (scripts/donner-acces-academie.mjs) :
 * « email;offre;source;note », une ligne par acces, en-tete facultatif, lignes
 * vides et lignes en « # » ignorees. email en minuscules ; source vide =
 * 'offert' ; note vide = null (1 000 caracteres au plus). Une meme paire
 * email + offre n'est gardee qu'une fois (doublons comptes). Les erreurs
 * donnent le numero de ligne et le motif, JAMAIS l'email.
 */
export function lireCsvAcces(texte: string): {
  lignes: LigneCsvAcces[]
  erreurs: { numero: number; motif: string }[]
  doublons: number
} {
  const lignes: LigneCsvAcces[] = []
  const erreurs: { numero: number; motif: string }[] = []
  const vues = new Set<string>()
  let doublons = 0
  const brutes = texte.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  brutes.forEach((brute, i) => {
    const numero = i + 1 // numero de ligne du fichier
    const ligne = brute.trim()
    if (!ligne || ligne.startsWith('#')) return
    const morceaux = ligne.split(';')
    const [emailBrut = '', offre = '', sourceBrute = ''] = morceaux.slice(0, 3).map(c => c.trim())
    if (emailBrut.toLowerCase() === 'email') return // en-tete
    const email = emailBrut.toLowerCase()
    // La note garde ses propres « ; ».
    const note = morceaux.slice(3).join(';').trim()
    if (email.length < 3 || email.length > 320 || !EMAIL_RE.test(email)) { erreurs.push({ numero, motif: 'email illisible' }); return }
    if (!SLUG_RE.test(offre)) { erreurs.push({ numero, motif: 'offre mal formee' }); return }
    const source = sourceBrute || 'offert'
    if (!estSource(source)) { erreurs.push({ numero, motif: `source inconnue (${source.slice(0, 30)})` }); return }
    if (note.length > 1000) { erreurs.push({ numero, motif: 'note de plus de 1000 caracteres' }); return }
    const cle = `${email}\u0000${offre}`
    if (vues.has(cle)) { doublons++; return }
    vues.add(cle)
    lignes.push({ numero, email, offre, source, note: note || null })
  })
  return { lignes, erreurs, doublons }
}

// ---------------------------------------------------------------------------
// Ressources (pieces jointes), adresse IP, appareil
// ---------------------------------------------------------------------------

/**
 * Le bucket Supabase Storage PRIVE des pieces jointes payantes (migration
 * 20261016140000_academie_ressources_protegees.sql). Aucune policy sur
 * storage.objects : seul le serveur (cle de service) y lit, et l'eleve ne
 * recoit qu'une URL signee de 5 minutes (route /api/academie/ressource).
 */
export const BUCKET_RESSOURCES = 'academie-ressources'

/** Nombre de pieces jointes gardees par lecon. */
export const MAX_RESSOURCES = 50

/**
 * Une piece jointe de lecon (academie_lecons.ressources) :
 * - publique : { titre, url }, adresse http(s) ou chemin du site
 *   (/media/academie/ressources/...), servie telle quelle ;
 * - protegee : { titre, fichier }, chemin dans le bucket prive
 *   (formation-complete/ep-01-pourquoi-se-lancer.pdf), ouverte par une URL
 *   signee apres le droit.
 */
export type Ressource = { titre: string; url: string } | { titre: string; fichier: string }

const FICHIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/

/**
 * Un chemin de fichier du bucket, ou null : segments separes par « / », chacun
 * commencant par une lettre ou un chiffre (donc ni « .. », ni chemin absolu),
 * 300 caracteres au plus.
 */
export function cheminFichierPropre(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null
  const c = valeur.trim()
  return c.length > 0 && c.length <= 300 && FICHIER_RE.test(c) ? c : null
}

/**
 * Une adresse publique, ou null : http(s), ou chemin du site qui commence par
 * un seul « / » (jamais « // » ni « /\ », que le navigateur lirait comme un
 * autre domaine), sans espace ni barre oblique inverse.
 */
function adressePublique(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null
  const u = valeur.trim()
  if (!u || u.length > 2000 || /[\s\\]/.test(u)) return null
  if (/^https?:\/\/[^/]/i.test(u)) return u
  if (/^\/[^/]/.test(u)) return u
  return null
}

/**
 * Les pieces jointes valables, MAX_RESSOURCES au plus, dans l'ordre du
 * catalogue. Un « fichier » l'emporte sur une « url » (protegee d'abord) ; un
 * fichier mal forme ecarte la piece jointe (jamais de repli sur l'url).
 * L'index d'une piece jointe dans CETTE liste est celui que la page envoie a
 * /api/academie/ressource.
 */
export function ressourcesPropres(brut: unknown): Ressource[] {
  if (!Array.isArray(brut)) return []
  const propres: Ressource[] = []
  for (const r of brut) {
    if (!r || typeof r !== 'object') continue
    const { titre, url, fichier } = r as Record<string, unknown>
    if (typeof titre !== 'string' || !titre.trim()) continue
    const t = titre.trim().slice(0, 300)
    if (fichier !== undefined && fichier !== null) {
      const f = cheminFichierPropre(fichier)
      if (!f) continue
      propres.push({ titre: t, fichier: f })
    } else {
      const u = adressePublique(url)
      if (!u) continue
      propres.push({ titre: t, url: u })
    }
    if (propres.length >= MAX_RESSOURCES) break
  }
  return propres
}

/** POST /api/academie/ressource : { lecon_id, index } (lecon accepte aussi). */
export function lireDemandeRessource(corps: unknown): { lecon: string; index: number } | null {
  const c = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>
  const lecon = lireUuid(c.lecon_id ?? c.lecon)
  const index = c.index
  if (!lecon || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= MAX_RESSOURCES) return null
  return { lecon, index }
}

/**
 * Le chemin d'un fichier local dans le bucket : prefixe (segments propres,
 * sans « / » au bord) + nom du fichier sans accents, en minuscules, chaque
 * suite d'autres caracteres remplacee par « - ». null si le prefixe ou le nom
 * ne donne rien de propre. « Épisode 01 - Pourquoi se lancer.PDF » ->
 * « <prefixe>/episode-01-pourquoi-se-lancer.pdf ».
 */
export function cheminDansBucket(prefixe: string, nomLocal: string): string | null {
  const p = prefixe.trim().replace(/^\/+|\/+$/g, '')
  if (!cheminFichierPropre(p)) return null
  const nom = nomLocal.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const point = nom.lastIndexOf('.')
  const base = (point > 0 ? nom.slice(0, point) : nom).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const ext = point > 0 ? nom.slice(point + 1).replace(/[^a-z0-9]/g, '') : ''
  if (!base) return null
  return cheminFichierPropre(`${p}/${base}${ext ? `.${ext}` : ''}`)
}

/** La premiere adresse de x-forwarded-for (ou x-real-ip) si c'est une IP, sinon null. */
export function ipDuClient(forwardedFor: string | null, realIp: string | null): string | null {
  const brute = (forwardedFor ?? '').split(',')[0]?.trim() || (realIp ?? '').trim()
  return brute && isIP(brute) ? brute : null
}

/**
 * L'appareil en quelques mots (« mobile ios safari », « ordinateur windows
 * chrome »), 60 caracteres au plus : assez pour reperer un compte partage,
 * sans garder l'empreinte complete du navigateur.
 */
export function appareilCourt(ua: string | null): string | null {
  const u = (ua ?? '').toLowerCase()
  if (!u) return null
  const forme = /ipad|tablet/.test(u) ? 'tablette' : /mobi|iphone|android/.test(u) ? 'mobile' : 'ordinateur'
  const systeme = /iphone|ipad|ipod/.test(u) ? 'ios'
    : /android/.test(u) ? 'android'
      : /windows/.test(u) ? 'windows'
        : /mac os|macintosh/.test(u) ? 'macos'
          : /cros/.test(u) ? 'chromeos'
            : /linux/.test(u) ? 'linux'
              : 'autre'
  const navigateur = /edg\//.test(u) ? 'edge'
    : /opr\/|opera/.test(u) ? 'opera'
      : /firefox|fxios/.test(u) ? 'firefox'
        : /chrome|crios/.test(u) ? 'chrome'
          : /safari/.test(u) ? 'safari'
            : 'autre'
  return `${forme} ${systeme} ${navigateur}`.slice(0, 60)
}

// ---------------------------------------------------------------------------
// Edition des textes dans l'app par l'admin (23/10/2026, lot
// LOT-EDITION-IN-APP-ADMIN ; route /api/academie/edition, edition.ts)
// ---------------------------------------------------------------------------

/** Le role metier de l'equipe (profiles.role) : la meme regle pour droitsAcademie et pour l'edition. */
export const ROLE_ADMIN = 'admin'

export function estAdmin(role: string | null | undefined): boolean {
  return role === ROLE_ADMIN
}

export type CibleEdition = 'lecon' | 'module'

/** Les longueurs maximales, celles des contraintes de la base (migration 20261015210000). */
export const LIMITES_EDITION = {
  lecon: { titre: 300, contenu: 500_000 },
  module: { titre: 200, resume: 4000 },
} as const

/** Les champs modifiables de chaque cible (V1 : ni videos, ni ressources, ni ordre). */
const CHAMPS_EDITION: Readonly<Record<CibleEdition, readonly ['titre', 'contenu' | 'resume']>> = {
  lecon: ['titre', 'contenu'],
  module: ['titre', 'resume'],
}

/** Les valeurs des champs texte d'une cible : { titre, contenu } ou { titre, resume }. */
export type TextesEdition = Record<string, string | null>

export type DemandeEdition = {
  cible: CibleEdition
  id: string
  /** maj_le lue par l'editeur (GET), ou null : la route prend celle qu'elle vient de lire. */
  version: string | null
  /** Les champs envoyes, deja normalises (titre sur une ligne, texte sans \r, vide = null). */
  champs: TextesEdition
}

export type ErreurDemandeEdition = 'demande' | 'titre' | 'contenu' | 'resume' | 'vide'

// maj_le en texte (« 2026-10-23 08:12:45.123456+00 ») : rien d'autre ne passe.
const VERSION_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/

/** Un titre sur une ligne : blancs et retours a la ligne fondus en une espace. */
function titrePropre(v: string): string {
  return v.replace(/\s+/g, ' ').trim()
}

/** Un texte long : fins de ligne \n, rien que des blancs = null. */
function textePropre(v: string): string | null {
  const t = v.replace(/\r\n?/g, '\n')
  return t.trim() ? t : null
}

/** GET /api/academie/edition?cible=lecon&id=<uuid> : la cible, ou null. */
export function lireCibleEdition(cible: unknown, id: unknown): { cible: CibleEdition; id: string } | null {
  if (cible !== 'lecon' && cible !== 'module') return null
  const u = lireUuid(id)
  return u ? { cible, id: u } : null
}

/**
 * PATCH /api/academie/edition : { cible: 'lecon', id, version?, titre?, contenu? }
 * ou { cible: 'module', id, version?, titre?, resume? }. Refuse toute autre cle,
 * un titre vide ou trop long, un texte trop long, et une demande sans champ.
 */
export function lireDemandeEdition(corps: unknown): { ok: true; demande: DemandeEdition } | { ok: false; erreur: ErreurDemandeEdition } {
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return { ok: false, erreur: 'demande' }
  const c = corps as Record<string, unknown>
  const cible = lireCibleEdition(c.cible, c.id)
  if (!cible) return { ok: false, erreur: 'demande' }
  const permis = CHAMPS_EDITION[cible.cible]
  for (const cle of Object.keys(c)) {
    if (cle !== 'cible' && cle !== 'id' && cle !== 'version' && !(permis as readonly string[]).includes(cle)) {
      return { ok: false, erreur: 'demande' }
    }
  }
  let version: string | null = null
  if (c.version !== undefined && c.version !== null) {
    if (typeof c.version !== 'string' || c.version.length > 40 || !VERSION_RE.test(c.version)) return { ok: false, erreur: 'demande' }
    version = c.version
  }
  const limites: Record<string, number> = LIMITES_EDITION[cible.cible]
  const champs: TextesEdition = {}
  if (c.titre !== undefined) {
    if (typeof c.titre !== 'string') return { ok: false, erreur: 'titre' }
    const t = titrePropre(c.titre)
    if (!t || t.length > limites.titre) return { ok: false, erreur: 'titre' }
    champs.titre = t
  }
  const long = permis[1]
  if (c[long] !== undefined) {
    const v = c[long]
    if (v !== null && typeof v !== 'string') return { ok: false, erreur: long }
    const t = v === null ? null : textePropre(v)
    if (t !== null && t.length > limites[long]) return { ok: false, erreur: long }
    champs[long] = t
  }
  if (!Object.keys(champs).length) return { ok: false, erreur: 'vide' }
  return { ok: true, demande: { cible: cible.cible, id: cible.id, version, champs } }
}

/**
 * La porte de la route : le role d'abord (un non-admin est refuse avant meme
 * de lire sa demande : 403 'droit'), puis la demande (400).
 */
export function autoriserEdition(role: string | null | undefined, corps: unknown):
  | { ok: true; demande: DemandeEdition }
  | { ok: false; status: 403 | 400; erreur: 'droit' | ErreurDemandeEdition } {
  if (!estAdmin(role)) return { ok: false, status: 403, erreur: 'droit' }
  const lu = lireDemandeEdition(corps)
  return lu.ok ? lu : { ok: false, status: 400, erreur: lu.erreur }
}

export type LigneHistoriqueEdition = { champ: string; avant: string | null; apres: string | null }

/** L'historique : une ligne par champ qui change vraiment (null et absent sont pareils). */
export function champsModifies(avant: TextesEdition, apres: TextesEdition): LigneHistoriqueEdition[] {
  const lignes: LigneHistoriqueEdition[] = []
  for (const champ of Object.keys(apres)) {
    const a = avant[champ] ?? null
    const b = apres[champ] ?? null
    if (a !== b) lignes.push({ champ, avant: a, apres: b })
  }
  return lignes
}

/**
 * Ce qu'un enregistrement ecrit : les valeurs actuelles, remplacees par les
 * champs demandes, et l'historique des champs qui changent. Une lecon ecrite
 * publiee garde un texte (contrainte de la base) : 'contenu' sinon.
 */
export function planEdition(
  actuel: { textes: TextesEdition; type?: string | null; statut?: string | null },
  demande: Pick<DemandeEdition, 'champs'>,
): { ok: true; valeurs: TextesEdition; historique: LigneHistoriqueEdition[] } | { ok: false; erreur: 'contenu' } {
  const valeurs: TextesEdition = { ...actuel.textes }
  for (const [champ, v] of Object.entries(demande.champs)) {
    if (champ in valeurs) valeurs[champ] = v
  }
  if ('contenu' in valeurs && valeurs.contenu === null && actuel.type === 'texte' && actuel.statut === 'publie') {
    return { ok: false, erreur: 'contenu' }
  }
  return { ok: true, valeurs, historique: champsModifies(actuel.textes, valeurs) }
}

/**
 * L'importeur du catalogue face a une edition dans l'app : tant que edite_le
 * est rempli en base, il GARDE les textes de la base (garde) ; avec
 * --ecraser-editions (ecraser), il pose ceux du fichier, remet edite_le a vide
 * (effacerEdition) et l'historique note ce qui est ecrase.
 */
export function fusionImport(
  base: { edite: boolean; textes: TextesEdition } | null,
  fichier: TextesEdition,
  ecraser: boolean,
): { valeurs: TextesEdition; garde: boolean; effacerEdition: boolean; historique: LigneHistoriqueEdition[] } {
  if (!base || !base.edite) return { valeurs: { ...fichier }, garde: false, effacerEdition: false, historique: [] }
  if (!ecraser) return { valeurs: { ...base.textes }, garde: true, effacerEdition: false, historique: [] }
  return { valeurs: { ...fichier }, garde: false, effacerEdition: true, historique: champsModifies(base.textes, fichier) }
}
