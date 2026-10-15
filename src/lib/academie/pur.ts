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

// ---------------------------------------------------------------------------
// Ressources, adresse IP, appareil
// ---------------------------------------------------------------------------

export type Ressource = { titre: string; url: string }

/** Les pieces jointes valables (titre et adresse http(s)), 50 au plus. */
export function ressourcesPropres(brut: unknown): Ressource[] {
  if (!Array.isArray(brut)) return []
  const propres: Ressource[] = []
  for (const r of brut) {
    if (!r || typeof r !== 'object') continue
    const { titre, url } = r as Record<string, unknown>
    if (typeof titre !== 'string' || typeof url !== 'string') continue
    if (!/^https?:\/\//i.test(url.trim())) continue
    propres.push({ titre: titre.trim().slice(0, 300), url: url.trim() })
    if (propres.length >= 50) break
  }
  return propres
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
