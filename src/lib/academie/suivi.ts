// Le suivi de l'academie (15/10/2026) : progression par lecon et journal des
// lectures (tables academie_progression et academie_lectures, migration
// 20261015210000). Plan, section 7 : le serveur note lui-meme, sans geste de
// l'eleve, chaque connexion, chaque lecon ouverte, le temps reellement
// regarde (signaux du lecteur), le temps passe sur un texte ; le clic « vu »
// reste possible, a part.
//
// Etats d'une lecon (Brice, 15/10 ; migration 20261016110000) : non_vu,
// ouvert, en_cours, vu (etatLecon, pur.ts), deduits de la progression ;
// chaque Progression rendue ici porte deja son etat.
//
// Les calculs sont dans pur.ts (appliquerSignal) ; ici, la base seulement.
// Jamais d'email ni de jeton : l'uuid du compte, l'IP et un appareil court.

import { prisma } from '@/lib/db'
import {
  appliquerSignal, colonneAbsente, etatLecon, type EtatLecon, type EtatSuivi, type IssueSignal, type Signal, type TypeLecon,
  type VuPar,
} from './pur'
import {
  SQL_APPLIQUER_SIGNAL, SQL_APPLIQUER_SIGNAL_PROFONDEUR, SQL_ETAT_SIGNAL, SQL_ETAT_SIGNAL_PROFONDEUR, SQL_NOTER_CONNEXION,
  SQL_NOTER_LIEN, SQL_NOTER_RESSOURCE, SQL_PROGRESSION_COMPTE,
} from './requetes'

export type Progression = {
  dernierePositionS: number
  positionMaxS: number
  secondesVues: number
  pourcentage: number | null
  termineeLe: Date | null
  marqueeVueLe: Date | null
  vuLe: Date | null
  vuPar: VuPar | null
  /** Une ligne existe, donc jamais non_vu ici : ouvert, en_cours ou vu. */
  etat: EtatLecon
}

export type ProgressionLecon = Progression & { leconId: string; derniereVueLe: Date }

type LigneProgression = {
  derniere_position_s: number; position_max_s: number; secondes_vues: number; pourcentage: number | null
  terminee_le: Date | null; marquee_vue_le: Date | null; vu_le: Date | null; vu_par: VuPar | null
}

function progressionDeLigne(l: LigneProgression): Progression {
  return {
    dernierePositionS: l.derniere_position_s,
    positionMaxS: l.position_max_s,
    secondesVues: l.secondes_vues,
    pourcentage: l.pourcentage,
    termineeLe: l.terminee_le,
    marqueeVueLe: l.marquee_vue_le,
    vuLe: l.vu_le,
    vuPar: l.vu_par,
    etat: etatLecon({ secondesVues: l.secondes_vues, vuLe: l.vu_le }),
  }
}

/** Un lien (ou un texte) vient d'etre delivre : progression rafraichie et ligne 'lien' au journal. Jette sur une panne. */
export async function noterLien(
  userId: string, leconId: string, o: { ip: string | null; appareil: string | null },
): Promise<Progression | null> {
  const lignes = await prisma.$queryRawUnsafe<LigneProgression[]>(SQL_NOTER_LIEN, userId, leconId, o.ip, o.appareil)
  return lignes[0] ? progressionDeLigne(lignes[0]) : null
}

/** Une piece jointe protegee delivree : ligne 'ressource' au journal (fichier compris). Jette sur une panne. */
export async function noterRessource(
  userId: string, leconId: string, fichier: string, o: { ip: string | null; appareil: string | null },
): Promise<void> {
  await prisma.$executeRawUnsafe(SQL_NOTER_RESSOURCE, userId, leconId, fichier, o.ip, o.appareil)
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
  terminee_le: Date | null; marquee_vue_le: Date | null; vu_le: Date | null; derniere_vue_le: Date; dernier_signal_le: Date | null
  nb_signaux: number; type: TypeLecon; duree_s: number | null; statut: string; maintenant: Date
  /** SQL_ETAT_SIGNAL_PROFONDEUR seulement. */
  profondeur_max?: number; mots?: number | null
}

// Lecon ecrite lue = bas atteint ET temps actif (05/11/2026) : la colonne
// profondeur_max vient de la migration 20261105233000. Tant qu'elle n'est pas
// appliquee, Postgres repond 42703 : on lit et on ecrit sans elle (profondeur
// ignoree, ancienne regle du texte) et on ne la redemande pas avant 10 min,
// pour ne pas payer une requete en echec a chaque signal.
const REESSAI_PROFONDEUR_MS = 10 * 60_000
let sansProfondeurJusqua = 0

async function lireEtatSignal(userId: string, leconId: string): Promise<{ ligne: LigneEtat | undefined; profondeur: boolean }> {
  if (Date.now() >= sansProfondeurJusqua) {
    try {
      const lignes = await prisma.$queryRawUnsafe<LigneEtat[]>(SQL_ETAT_SIGNAL_PROFONDEUR, userId, leconId)
      return { ligne: lignes[0], profondeur: true }
    } catch (err) {
      if (!colonneAbsente(err)) throw err
      sansProfondeurJusqua = Date.now() + REESSAI_PROFONDEUR_MS
      console.warn('[academie/suivi] colonne profondeur_max absente (migration 20261105233000 pas appliquee) : ancienne regle du texte')
    }
  }
  const lignes = await prisma.$queryRawUnsafe<LigneEtat[]>(SQL_ETAT_SIGNAL, userId, leconId)
  return { ligne: lignes[0], profondeur: false }
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
  const { ligne: e, profondeur } = await lireEtatSignal(userId, leconId)
  if (!e) return { issue: 'sans_lien' }
  const etat: EtatSuivi = {
    type: e.type,
    dureeS: e.duree_s,
    positionMaxS: e.position_max_s,
    dernierePositionS: e.derniere_position_s,
    secondesVues: e.secondes_vues,
    pourcentage: e.pourcentage,
    termineeLe: e.terminee_le,
    vuLe: e.vu_le,
    derniereVueLe: e.derniere_vue_le,
    dernierSignalLe: e.dernier_signal_le,
    nbSignaux: e.nb_signaux,
    maintenant: e.maintenant,
    profondeurMax: profondeur ? e.profondeur_max ?? 0 : null,
    mots: profondeur ? e.mots ?? null : null,
  }
  const issue = appliquerSignal(etat, signal)
  if (!('maj' in issue)) return { issue: 'refus', detail: issue }

  const m = issue.maj
  const parametres: unknown[] = [
    userId, leconId, etat.nbSignaux,
    m.positionMaxS, m.dernierePositionS, m.secondesVues, m.pourcentage, m.terminer, m.marque,
    m.journal.evenement, m.journal.secondes, m.journal.positionS,
    o.ip, o.appareil,
    m.vu, m.vuPar,
  ]
  const ecrites = profondeur
    ? await prisma.$queryRawUnsafe<LigneProgression[]>(SQL_APPLIQUER_SIGNAL_PROFONDEUR, ...parametres, m.profondeurMax ?? 0)
    : await prisma.$queryRawUnsafe<LigneProgression[]>(SQL_APPLIQUER_SIGNAL, ...parametres)
  if (!ecrites[0]) return { issue: 'course' }
  return { issue: 'ok', credit: issue.credit, progression: progressionDeLigne(ecrites[0]) }
}
