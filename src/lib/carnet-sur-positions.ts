// Le jugement du Carnet sur chaque position (brief A2, 30/10/2026) : fonctions
// PURES, aucune base, aucun import : src/lib/trades-serveur.ts lit (une requête
// Annotation, une lecture des notes du membre), ici on décide.
// scripts/verifier-imports-trades.mjs les charge telles quelles.
//
// Pour la tuile « Le tri » de « Mon edge » (Pilotage) : les trades réels
// croisés avec les jugements A/B/C du Carnet. Une position liée à un segment
// (segmentRef) porte le DERNIER jugement de ce segment (les re-jugements sont
// un historique : le dernier fait foi, comme dans le brief du mentor),
// l'émotion au départ de la séance (le warmup de la note) et le cooldown du
// segment. Rien ne part vers l'IA : c'est l'écran du membre.
//
// Les segments se lisent comme dans correspondances-carnet.ts (id non vide,
// startedAt fini, ordre = place dans Note.trades à partir de 1) : un segment
// qu'on peut lier est un segment qu'on retrouve ici.

export type CauseCarnet = 'technique' | 'connaissance' | 'emotionnel'
export type IssueCarnet = 'gain' | 'perte' | 'be'

/** Ce que Pilotage lit sur une position liée à un segment du Carnet. */
export interface CarnetDePosition {
  /** Le dernier jugement, tel qu'écrit (« A », « B+ », « C- ») ; null si le segment n'est pas jugé. */
  grade: string | null
  cause: CauseCarnet | null
  phrase: string | null
  /** L'instant du jugement retenu (ISO). */
  jugeLe: string | null
  noteId: string
  noteTitle: string | null
  /** Sa place dans Note.trades, à partir de 1 (« Trade 2 » à l'écran). */
  ordre: number
  /** emotionLevel (0 à 100) du warmup de la séance ; null sans warmup ou sans niveau. */
  emotionDepart: number | null
  /** cooldown.error du segment. */
  erreur: string | null
  /** cooldown.lesson du segment. */
  lecon: string | null
  outcome: IssueCarnet | null
  r: number | null
}

/** Une note du membre telle que lue en base : trades et warmups en JSON. */
export interface NoteDuCarnet {
  id: string
  title: string | null
  trades: unknown
  warmups: unknown
}

/** Un jugement (Annotation) tel que lu en base. */
export interface JugementCarnet {
  tradeRef: string | null
  grade: string
  causeCategory: string | null
  phrase: string | null
  createdAt: Date
}

/** Une période d'entrée, bornes en ms : [depuis, jusqu[, null = ouverte. */
export interface PeriodeCarnet {
  depuis: number | null
  jusqu: number | null
}

type Objet = Record<string, unknown>

const objet = (x: unknown): Objet | null => (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Objet) : null)
const texte = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null)
const nombre = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const estCause = (c: unknown): c is CauseCarnet => c === 'technique' || c === 'connaissance' || c === 'emotionnel'
const estIssue = (o: unknown): o is IssueCarnet => o === 'gain' || o === 'perte' || o === 'be'
/** Un jugement compte s'il commence par A, B, C ou D (le D, opt-in, depuis le 24/09), comme dans le brief du mentor. */
const estGrade = (g: unknown): g is string => typeof g === 'string' && /^[ABCD]/.test(g)

/** Un segment lu dans Note.trades, avec ce qu'il faut de sa note. */
interface SegmentLu {
  segmentRef: string
  noteId: string
  noteTitle: string | null
  ordre: number
  startedAt: number
  segment: Objet
  warmups: unknown
}

/** Les segments des notes, par segmentRef (le premier lu l'emporte : un id est unique entre les notes). */
function segmentsLus(notes: NoteDuCarnet[]): Map<string, SegmentLu> {
  const segments = new Map<string, SegmentLu>()
  for (const n of notes) {
    if (!Array.isArray(n.trades)) continue
    n.trades.forEach((brut: unknown, i: number) => {
      const s = objet(brut)
      if (!s || typeof s.id !== 'string' || !s.id || segments.has(s.id)) return
      const startedAt = nombre(s.startedAt)
      if (startedAt === null) return
      segments.set(s.id, { segmentRef: s.id, noteId: n.id, noteTitle: n.title, ordre: i + 1, startedAt, segment: s, warmups: n.warmups })
    })
  }
  return segments
}

/**
 * Le dernier jugement de chaque segment : createdAt le plus récent (à égalité,
 * le dernier lu ; la base les rend triés par createdAt). Un jugement de note
 * ou de message (sans tradeRef) ne compte pas.
 */
export function derniersJugements(jugements: JugementCarnet[]): Map<string, JugementCarnet> {
  const derniers = new Map<string, JugementCarnet>()
  for (const j of jugements) {
    if (!j.tradeRef || !estGrade(j.grade)) continue
    const avant = derniers.get(j.tradeRef)
    if (!avant || j.createdAt.getTime() >= avant.createdAt.getTime()) derniers.set(j.tradeRef, j)
  }
  return derniers
}

/**
 * L'émotion au départ de la séance d'un segment : le warmup de la note dont le
 * startedAt précède au plus près celui du segment (même instant compris), et
 * s'il n'y en a aucun avant, le premier warmup de la note. Un warmup sans
 * startedAt (le warmup unique d'avant les séances multiples) s'affiche en haut
 * de la note : il précède tout. null sans warmup, ou si celui retenu n'a pas
 * de niveau : on ne prend pas le niveau d'une autre séance à sa place.
 */
export function emotionAuDepart(warmups: unknown, startedAt: number): number | null {
  if (!Array.isArray(warmups)) return null
  let avant: { t: number; w: Objet } | null = null
  let premier: { t: number; w: Objet } | null = null
  for (const brut of warmups) {
    const w = objet(brut)
    if (!w) continue
    const t = nombre(w.startedAt) ?? -Infinity
    if (t <= startedAt && (!avant || t >= avant.t)) avant = { t, w }
    if (!premier || t < premier.t) premier = { t, w }
  }
  const retenu = avant ?? premier
  return retenu ? nombre(retenu.w.emotionLevel) : null
}

/**
 * Chaque position avec son `carnet` : null quand elle n'a pas de segmentRef ou
 * que le segment n'existe plus (note supprimée, segment retiré). Sinon le
 * dernier jugement (null partout s'il n'y en a pas, le reste rempli), la note,
 * l'émotion au départ, le cooldown, l'issue et le R du segment. L'ordre des
 * positions ne change pas.
 */
export function ajouterCarnet<P extends { segmentRef: string | null }>(
  positions: P[],
  notes: NoteDuCarnet[],
  jugements: JugementCarnet[],
): (P & { carnet: CarnetDePosition | null })[] {
  const segments = segmentsLus(notes)
  const derniers = derniersJugements(jugements)
  return positions.map(p => {
    const s = p.segmentRef ? segments.get(p.segmentRef) : undefined
    if (!s) return { ...p, carnet: null }
    const j = derniers.get(s.segmentRef) ?? null
    const cooldown = objet(s.segment.cooldown) ?? {}
    return {
      ...p,
      carnet: {
        grade: j ? j.grade : null,
        cause: j && estCause(j.causeCategory) ? j.causeCategory : null,
        phrase: j ? texte(j.phrase) : null,
        jugeLe: j ? j.createdAt.toISOString() : null,
        noteId: s.noteId,
        noteTitle: s.noteTitle,
        ordre: s.ordre,
        emotionDepart: emotionAuDepart(s.warmups, s.startedAt),
        erreur: texte(cooldown.error),
        lecon: texte(cooldown.lesson),
        outcome: estIssue(s.segment.outcome) ? s.segment.outcome : null,
        r: nombre(s.segment.r),
      },
    }
  })
}

/**
 * Les segments du Carnet dont le startedAt tombe dans la période et qu'aucune
 * position ne porte : « X trades du Carnet sans trade réel ».
 * @param lies segmentRef portés par les positions du membre (toutes, pas
 *   seulement celles de la période : un segment lié reste lié).
 */
export function compterSegmentsNonLies(notes: NoteDuCarnet[], lies: Iterable<string | null>, periode: PeriodeCarnet): number {
  const pris = new Set(lies)
  let n = 0
  for (const s of segmentsLus(notes).values()) {
    if (pris.has(s.segmentRef)) continue
    if (periode.depuis !== null && s.startedAt < periode.depuis) continue
    if (periode.jusqu !== null && s.startedAt >= periode.jusqu) continue
    n++
  }
  return n
}
