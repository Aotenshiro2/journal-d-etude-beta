// Le lien entre un trade importé et un segment de trade du Carnet (brief A,
// 29/10/2026) : fonctions PURES, aucune base, aucun import de valeur.
// scripts/verifier-imports-trades.mjs les charge telles quelles.
//
// Condition de Brice (29/10) : on doit pouvoir attacher un trade déclenché
// dans le Carnet à un vrai trade récupéré. Les segments vivent dans
// Note.trades (JSON, source de vérité côté extension) :
// { id, startedAt (ms), closedAt? (ms), outcome?, r?, cooldown? }.
// La position importée est la vérité (montants, heures, compte) ; le segment
// du Carnet, matière d'apprentissage, s'y greffe par `segmentRef` = son id,
// un UUID unique entre toutes les notes (jamais un numéro d'ordre : « Trade 1 »
// n'est qu'un affichage). Un segment se lie à UNE position au plus.
// Une position et un segment se correspondent quand leurs fenêtres se
// chevauchent ; un segment encore ouvert vaut quatre heures. Un seul candidat,
// libre : on lie. Plusieurs, ou un candidat déjà pris : l'écran choisira.
// Depuis la fiche de compte de Pilotage (05/11/2026), le membre lie aussi une
// position à la main : candidatsPourUnePosition élargit alors à 24 h autour.

/** Un segment du Carnet, tel qu'on le propose à l'écran. Instants en ms, comme dans Note.trades. */
export interface SegmentCarnet {
  segmentRef: string
  noteId: string
  noteTitle: string
  /** Sa place dans Note.trades, à partir de 1 (« Trade 2 » à l'écran). */
  ordre: number
  startedAt: number
  closedAt: number | null
}

/** Ce qu'il faut savoir d'une position pour la rapprocher. */
export interface PositionARapprocher {
  positionId: string
  entreLe: string | Date
  sortiLe: string | Date | null
  segmentRef: string | null
}

/** Durée prêtée à un segment sans clôture. */
export const FENETRE_OUVERTE_MS = 4 * 3_600_000

/** Les segments des notes d'un membre, en ignorant ce qui n'a pas la forme attendue. */
export function segmentsDesNotes(notes: { id: string; title: string; trades: unknown }[]): SegmentCarnet[] {
  const segments: SegmentCarnet[] = []
  for (const n of notes) {
    if (!Array.isArray(n.trades)) continue
    ;(n.trades as Record<string, unknown>[]).forEach((t, i) => {
      if (!t || typeof t.id !== 'string' || !t.id) return
      if (typeof t.startedAt !== 'number' || !Number.isFinite(t.startedAt)) return
      const closedAt = typeof t.closedAt === 'number' && Number.isFinite(t.closedAt) ? t.closedAt : null
      segments.push({ segmentRef: t.id, noteId: n.id, noteTitle: n.title, ordre: i + 1, startedAt: t.startedAt, closedAt })
    })
  }
  return segments
}

/** [début, fin] d'un segment : sa clôture, sinon quatre heures après son début. */
export function fenetreSegment(s: Pick<SegmentCarnet, 'startedAt' | 'closedAt'>): [number, number] {
  const fin = s.closedAt ?? s.startedAt + FENETRE_OUVERTE_MS
  return [s.startedAt, Math.max(s.startedAt, fin)]
}

const instant = (d: string | Date) => (d instanceof Date ? d.getTime() : Date.parse(d))

/** Les segments dont la fenêtre chevauche celle de la position (bornes comprises), du plus ancien au plus récent. */
export function candidatsPourPosition(p: Pick<PositionARapprocher, 'entreLe' | 'sortiLe'>, segments: SegmentCarnet[]): SegmentCarnet[] {
  const debut = instant(p.entreLe)
  const fin = p.sortiLe ? Math.max(debut, instant(p.sortiLe)) : debut
  return segments
    .filter(s => {
      const [a, b] = fenetreSegment(s)
      return a <= fin && debut <= b
    })
    .sort((x, y) => x.startedAt - y.startedAt)
}

/**
 * Pour des positions fraîchement importées : celles qui se lient d'elles-mêmes
 * (un seul candidat, lié à aucune autre position) et celles pour lesquelles
 * l'écran devra choisir. Une position déjà liée est laissée telle quelle ;
 * aucun candidat = rien. Les positions sont vues de la plus ancienne à la plus
 * récente : si deux d'entre elles n'ont que le même segment, la première le prend.
 * @param dejaLies segmentRef déjà portés par d'autres positions du membre.
 */
export function proposerLiens(
  positions: PositionARapprocher[],
  segments: SegmentCarnet[],
  dejaLies: Iterable<string>,
): { liens: { positionId: string; segmentRef: string }[]; correspondances: { positionId: string; candidats: SegmentCarnet[] }[] } {
  const pris = new Set(dejaLies)
  const liens: { positionId: string; segmentRef: string }[] = []
  const correspondances: { positionId: string; candidats: SegmentCarnet[] }[] = []
  const ordre = [...positions].sort((a, b) => instant(a.entreLe) - instant(b.entreLe))
  for (const p of ordre) {
    if (p.segmentRef) continue
    const candidats = candidatsPourPosition(p, segments)
    if (candidats.length === 0) continue
    if (candidats.length === 1 && !pris.has(candidats[0].segmentRef)) {
      liens.push({ positionId: p.positionId, segmentRef: candidats[0].segmentRef })
      pris.add(candidats[0].segmentRef)
    } else {
      correspondances.push({ positionId: p.positionId, candidats })
    }
  }
  return { liens, correspondances }
}

/** Un segment proposé pour UNE position (bouton « Lier » de la fiche de compte de Pilotage, 05/11/2026). */
export interface CandidatPourPosition extends SegmentCarnet {
  /** Sa fenêtre chevauche celle de la position. */
  chevauche: boolean
  /** La position qui le porte déjà, ou null. */
  lieA: string | null
}

/** Au-delà du chevauchement, un Carnet lancé un peu tôt ou un peu tard : fenêtre à moins de 24 h de la position. */
export const PROCHE_MS = 24 * 3_600_000
/** Le nombre de candidats rendus pour une position, au plus. */
export const CANDIDATS_MAX = 8

/**
 * Les candidats du Carnet pour une position, quand le membre la lie lui-même :
 * d'abord ceux qui la chevauchent (candidatsPourPosition, du plus ancien au plus
 * récent), puis ceux dont la fenêtre tombe à moins de 24 h d'elle, du plus proche
 * au plus loin (à égalité, le plus ancien d'abord) ; CANDIDATS_MAX au plus. Le
 * segment que CETTE position porte déjà n'y figure pas ; les autres disent qui
 * les porte (`lieA`), l'écran les marque et le PATCH `lier` répondra 409.
 * Un segmentRef en double (une note copiée) ne sort qu'une fois.
 * @param lies segmentRef => positionId qui le porte, pour tout le membre.
 */
export function candidatsPourUnePosition(
  p: PositionARapprocher,
  segments: SegmentCarnet[],
  lies: ReadonlyMap<string, string>,
): CandidatPourPosition[] {
  const debut = instant(p.entreLe)
  const fin = p.sortiLe ? Math.max(debut, instant(p.sortiLe)) : debut
  const vus = new Set<string>()
  const libres = segments.filter(s => {
    if (vus.has(s.segmentRef)) return false
    vus.add(s.segmentRef)
    return s.segmentRef !== p.segmentRef && lies.get(s.segmentRef) !== p.positionId
  })
  const chevauchent = candidatsPourPosition(p, libres)
  const dedans = new Set(chevauchent.map(s => s.segmentRef))
  // L'écart entre deux fenêtres qui ne se chevauchent pas : toujours positif.
  const ecart = (s: SegmentCarnet) => {
    const [a, b] = fenetreSegment(s)
    return Math.max(a - fin, debut - b)
  }
  const proches = libres
    .filter(s => !dedans.has(s.segmentRef))
    .map(s => ({ s, e: ecart(s) }))
    .filter(x => x.e < PROCHE_MS)
    .sort((x, y) => x.e - y.e || x.s.startedAt - y.s.startedAt)
    .map(x => x.s)
  const candidat = (s: SegmentCarnet, chevauche: boolean): CandidatPourPosition => ({ ...s, chevauche, lieA: lies.get(s.segmentRef) ?? null })
  return [...chevauchent.map(s => candidat(s, true)), ...proches.map(s => candidat(s, false))].slice(0, CANDIDATS_MAX)
}
