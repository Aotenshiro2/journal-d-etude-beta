// Données d'EXEMPLE de l'écran « Mes trades » (brief J2, 05/11/2026), celles du
// labo LABO-MES-TRADES-V1 : NQ long du mardi 03/11 09:40 (prévu 20 100, stop
// 20 080, TP 20 140, taille 2, partiels 20 120 et 20 140 ; broker 20 100,25 puis
// 20 120,50 et 20 131 sur 3 comptes copiés), un short, un trade sans broker, un
// stop dépassé (fichier sans fuseau : heure incertaine), un trade sans stop, un
// trade d'octobre et deux positions du broker sans note. FICTIF : aucune base.
//
// Passées par le vrai calcul (synthetiser, synthese-trades-pur.ts). Lues par
// scripts/verifier-mes-trades.mjs ; hors du build (rien dans src/ ne l'importe).

import { synthetiser, type Synthese } from '../src/lib/synthese-trades-pur'
import { vuePositions, type Execution } from '../src/lib/positions'

/** Le « maintenant » des exemples : jeudi 5 novembre 2026, 17 h à Paris. */
export const MAINTENANT_EXEMPLE = new Date('2026-11-05T16:00:00.000Z')

const z = (iso: string) => new Date(iso)

function execution(e: Partial<Execution> & Pick<Execution, 'id' | 'entreLe'>): Execution {
  return {
    compteId: 'compte-a', compte: null, symbole: 'NQZ6', direction: 'long', devise: 'USD', sortiLe: null,
    quantite: 1, pnl: 0, frais: 2.1, prixEntree: null, prixSortie: null, stopPrix: null,
    positionId: null, positionManuelle: false, segmentRef: null, fuseau: 'Europe/Paris', ...e,
  }
}

/** Les trois copies du NQ long : deux exécutions par compte (deux sorties partielles). */
function copiesNqLong(): Execution[] {
  const comptes = [['compte-a', 'APEX-001'], ['compte-b', 'APEX-002'], ['compte-c', 'APEX-003']]
  return comptes.flatMap(([compteId, compte], i) => [
    execution({ id: `nq1-${i}-a`, positionId: `nq1-${i}-a`, compteId, compte, entreLe: z('2026-11-03T08:41:12Z'), sortiLe: z('2026-11-03T09:02:40Z'), prixEntree: 20100.25, prixSortie: 20120.5, pnl: 405, segmentRef: 'seg-nq-long' }),
    execution({ id: `nq1-${i}-b`, positionId: `nq1-${i}-a`, compteId, compte, entreLe: z('2026-11-03T08:41:12Z'), sortiLe: z('2026-11-03T09:21:05Z'), prixEntree: 20100.25, prixSortie: 20131, pnl: 615, segmentRef: 'seg-nq-long' }),
  ])
}

export const EXECUTIONS_EXEMPLE: Execution[] = [
  ...copiesNqLong(),
  // Le short NQ de 11:15, sorti au TP.
  execution({ id: 'nq2', positionId: 'nq2', direction: 'short', entreLe: z('2026-11-03T10:16:30Z'), sortiLe: z('2026-11-03T10:48:00Z'), prixEntree: 20159.75, prixSortie: 20121, pnl: 775, segmentRef: 'seg-nq-short' }),
  // ES du lundi 02/11 : stop dépassé ; export sans fuseau (heure affichée stockée comme de l'UTC).
  execution({ id: 'es1', positionId: 'es1', symbole: 'ESZ6', quantite: 2, entreLe: z('2026-11-02T15:32:00Z'), sortiLe: z('2026-11-02T15:52:00Z'), prixEntree: 6850.25, prixSortie: 6843, pnl: -725, stopPrix: 6845, segmentRef: 'seg-es-stop', fuseau: null }),
  // MNQ sans stop tapé.
  execution({ id: 'mnq1', positionId: 'mnq1', symbole: 'MNQZ6', quantite: 3, entreLe: z('2026-11-05T09:06:00Z'), sortiLe: z('2026-11-05T09:31:00Z'), prixEntree: 20301, prixSortie: 20318, pnl: 102, segmentRef: 'seg-mnq' }),
  // Octobre : un NQ au TP.
  execution({ id: 'oct1', positionId: 'oct1', quantite: 2, entreLe: z('2026-10-22T13:46:00Z'), sortiLe: z('2026-10-22T14:20:00Z'), prixEntree: 19850, prixSortie: 19889.5, pnl: 1580, segmentRef: 'seg-oct' }),
  // Deux positions du broker sans note.
  execution({ id: 'libre1', positionId: 'libre1', symbole: 'ESZ6', direction: 'short', entreLe: z('2026-11-04T15:10:00Z'), sortiLe: z('2026-11-04T15:24:00Z'), prixEntree: 6871.5, prixSortie: 6869, pnl: 125 }),
  execution({ id: 'libre2', positionId: 'libre2', entreLe: z('2026-11-02T09:00:00Z'), sortiLe: z('2026-11-02T09:14:00Z'), prixEntree: 20040, prixSortie: 20031.5, pnl: -170 }),
]

const ms = (iso: string) => Date.parse(iso)

export const NOTES_EXEMPLE = [
  {
    id: 'note-nq-0311', title: 'Séance NQ du mardi 03/11',
    warmups: [{ startedAt: ms('2026-11-03T08:20:00Z'), emotionLevel: 35 }],
    trades: [
      { id: 'seg-nq-long', startedAt: ms('2026-11-03T08:40:00Z'), closedAt: ms('2026-11-03T09:25:00Z'), outcome: 'gain', r: 1.3, instrument: 'NQ',
        prix: { entree: 20100, stop: 20080, tp: 20140, taille: 2, partiels: [{ prix: 20120, taille: 1 }, { prix: 20140, taille: 1 }] },
        cooldown: { emotion: 'Impatience sur le 2e partiel', lesson: "Laisser l'ordre TP travailler" } },
      { id: 'seg-nq-short', startedAt: ms('2026-11-03T10:15:00Z'), closedAt: ms('2026-11-03T10:50:00Z'), outcome: 'gain', instrument: 'NQ',
        prix: { entree: 20160, stop: 20175, tp: 20120, taille: 1 } },
      { id: 'seg-nq-sans', startedAt: ms('2026-11-03T13:02:00Z'), instrument: 'NQ',
        prix: { entree: 20210, stop: 20195, tp: 20240, taille: 1 } },
    ],
  },
  {
    id: 'note-es-0211', title: 'Séance ES du lundi 02/11',
    warmups: [{ startedAt: ms('2026-11-02T14:00:00Z'), emotionLevel: 60 }],
    trades: [
      { id: 'seg-es-stop', startedAt: ms('2026-11-02T14:31:00Z'), closedAt: ms('2026-11-02T14:55:00Z'), outcome: 'perte', instrument: 'ES',
        prix: { entree: 6850, stop: 6845, tp: 6862.5, taille: 2 }, cooldown: { error: 'Stop déplacé à la main' } },
    ],
  },
  {
    id: 'note-mnq-0511', title: 'Séance MNQ du jeudi 05/11',
    warmups: [],
    trades: [
      { id: 'seg-mnq', startedAt: ms('2026-11-05T09:05:00Z'), closedAt: ms('2026-11-05T09:35:00Z'), outcome: 'gain', instrument: 'MNQ',
        prix: { entree: 20300, tp: 20330, taille: 3 } },
    ],
  },
  {
    id: 'note-nq-2210', title: 'Séance NQ du jeudi 22/10',
    warmups: [],
    trades: [
      { id: 'seg-oct', startedAt: ms('2026-10-22T13:45:00Z'), closedAt: ms('2026-10-22T14:25:00Z'), outcome: 'gain', instrument: 'NQ',
        prix: { entree: 19850, stop: 19830, tp: 19890, taille: 2 } },
    ],
  },
]

export const JUGEMENTS_EXEMPLE = [
  { tradeRef: 'seg-nq-long', grade: 'B+', causeCategory: 'emotionnel', phrase: 'Bonne lecture du FVG, sortie précipitée.', createdAt: z('2026-11-03T18:00:00Z') },
  { tradeRef: 'seg-nq-short', grade: 'A', causeCategory: 'technique', phrase: 'Plan suivi du début à la fin.', createdAt: z('2026-11-03T18:02:00Z') },
  { tradeRef: 'seg-nq-sans', grade: 'C', causeCategory: 'connaissance', phrase: 'Entrée sans confirmation.', createdAt: z('2026-11-03T18:04:00Z') },
  { tradeRef: 'seg-es-stop', grade: 'B', causeCategory: 'emotionnel', phrase: 'Stop élargi en cours de route.', createdAt: z('2026-11-02T18:00:00Z') },
]

/** La synthèse d'exemple d'une période ([depuis, jusqu[, instants en ms ; null = sans borne). */
export function syntheseExemple(depuis: number | null, jusqu: number | null = null): Synthese {
  return synthetiser({
    notes: NOTES_EXEMPLE,
    positions: vuePositions(EXECUTIONS_EXEMPLE),
    jugements: JUGEMENTS_EXEMPLE,
    captures: [{ messageId: 'msg-capture-1', tradeRef: 'seg-nq-long', contenu: 'https://exemple.test/capture-nq.png' }],
    periode: { depuis, jusqu },
    executions: EXECUTIONS_EXEMPLE,
  })
}
