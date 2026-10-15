// Le suivi de l'academie (15/10/2026) : progression par lecon et journal des
// lectures (tables academie_progression et academie_lectures, migration
// 20261015210000). Plan, section 7 : le serveur note lui-meme, sans geste de
// l'eleve, chaque connexion, chaque lecon ouverte, le temps reellement
// regarde (signaux du lecteur), le temps passe sur un texte ; le clic « vu »
// reste possible, a part.
//
// Les calculs sont dans pur.ts (appliquerSignal) ; ici, la base seulement.
// Jamais d'email ni de jeton : l'uuid du compte, l'IP et un appareil court.

import { prisma } from '@/lib/db'
import { appliquerSignal, type EtatSuivi, type IssueSignal, type Signal, type TypeLecon } from './pur'
import {
  SQL_APPLIQUER_SIGNAL, SQL_ETAT_SIGNAL, SQL_NOTER_CONNEXION, SQL_NOTER_LIEN, SQL_PROGRESSION_COMPTE,
} from './requetes'

export type Progression = {
  dernierePositionS: number
  positionMaxS: number
  secondesVues: number
  pourcentage: number | null
  termineeLe: Date | null
  marqueeVueLe: Date | null
}

export type ProgressionLecon = Progression & { leconId: string; derniereVueLe: Date }

type LigneProgression = {
  derniere_position_s: number; position_max_s: number; secondes_vues: number; pourcentage: number | null
  terminee_le: Date | null; marquee_vue_le: Date | null
}

function progressionDeLigne(l: LigneProgression): Progression {
  return {
    dernierePositionS: l.derniere_position_s,
    positionMaxS: l.position_max_s,
    secondesVues: l.secondes_vues,
    pourcentage: l.pourcentage,
    termineeLe: l.terminee_le,
    marqueeVueLe: l.marquee_vue_le,
  }
}

/** Un lien (ou un texte) vient d'etre delivre : progression rafraichie et ligne 'lien' au journal. Jette sur une panne. */
export async function noterLien(
  userId: string, leconId: string, o: { ip: string | null; appareil: string | null },
): Promise<Progression | null> {
  const lignes = await prisma.$queryRawUnsafe<LigneProgression[]>(SQL_NOTER_LIEN, userId, leconId, o.ip, o.appareil)
  return lignes[0] ? progressionDeLigne(lignes[0]) : null
}

/** Une connexion a l'academie (au plus une ligne par 30 minutes). Jette sur une panne. */
export async function noterConnexion(userId: string, o: { ip: string | null; appareil: string | null }): Promise<void> {
  await prisma.$executeRawUnsafe(SQL_NOTER_CONNEXION, userId, o.ip, o.appareil)
}

/** Toute la progression d'un compte, par lecon. */
export async function progressionDuCompte(userId: string): Promise<Map<string, ProgressionLecon>> {
  const lignes = await prisma.$queryRawUnsafe<(LigneProgression & { lecon_id: string; derniere_vue_le: Date })[]>(
    SQL_PROGRESSION_COMPTE, userId,
  )
  return new Map(lignes.map(l => [l.lecon_id, { ...progressionDeLigne(l), leconId: l.lecon_id, derniereVueLe: l.derniere_vue_le }]))
}

export type IssueEnregistrement =
  | { issue: 'sans_lien' }
  | { issue: 'refus'; detail: Exclude<IssueSignal, { maj: unknown }> }
  | { issue: 'course' }
  | { issue: 'ok'; credit: number; progression: Progression }

type LigneEtat = {
  position_max_s: number; derniere_position_s: number; secondes_vues: number; pourcentage: number | null
  terminee_le: Date | null; marquee_vue_le: Date | null; derniere_vue_le: Date; dernier_signal_le: Date | null
  nb_signaux: number; type: TypeLecon; duree_s: number | null; statut: string; maintenant: Date
}

/**
 * Enregistre un signal de la page. 'sans_lien' : aucune progression pour
 * cette lecon (le compte n'a jamais recu de lien, donc jamais eu le droit) ;
 * 'refus' : type, lien trop ancien ou debit (pur.ts) ; 'course' : un signal
 * concurrent est passe avant (verrou optimiste), la page reessaiera.
 * Jette sur une panne de base.
 */
export async function enregistrerSignal(
  userId: string, leconId: string, signal: Signal, o: { ip: string | null; appareil: string | null },
): Promise<IssueEnregistrement> {
  const lignes = await prisma.$queryRawUnsafe<LigneEtat[]>(SQL_ETAT_SIGNAL, userId, leconId)
  const e = lignes[0]
  if (!e) return { issue: 'sans_lien' }
  const etat: EtatSuivi = {
    type: e.type,
    dureeS: e.duree_s,
    positionMaxS: e.position_max_s,
    dernierePositionS: e.derniere_position_s,
    secondesVues: e.secondes_vues,
    pourcentage: e.pourcentage,
    termineeLe: e.terminee_le,
    derniereVueLe: e.derniere_vue_le,
    dernierSignalLe: e.dernier_signal_le,
    nbSignaux: e.nb_signaux,
    maintenant: e.maintenant,
  }
  const issue = appliquerSignal(etat, signal)
  if (!('maj' in issue)) return { issue: 'refus', detail: issue }

  const m = issue.maj
  const ecrites = await prisma.$queryRawUnsafe<LigneProgression[]>(
    SQL_APPLIQUER_SIGNAL,
    userId, leconId, etat.nbSignaux,
    m.positionMaxS, m.dernierePositionS, m.secondesVues, m.pourcentage, m.terminer, m.marque,
    m.journal.evenement, m.journal.secondes, m.journal.positionS,
    o.ip, o.appareil,
  )
  if (!ecrites[0]) return { issue: 'course' }
  return { issue: 'ok', credit: issue.credit, progression: progressionDeLigne(ecrites[0]) }
}
