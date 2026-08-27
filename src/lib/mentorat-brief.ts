// Brief compressé du mode mentorat : le condensé chiffré d'un élève, calculé
// depuis la base (trades, jugements A/B/C, causes, warmups, cooldowns,
// concepts). C'est la pièce que « un prompt copié ne produira jamais » :
// le plan d'évolution (notre IA) le lira, le panel mentorat l'affichera,
// et l'extension pourra le joindre à la conversation de l'élève.
// Étape 1 du chantier mentorat (TODO extension, section 8) : calcul pur,
// aucun jeton IA.
import { prisma } from './db'

// Miroirs des types extension (source de vérité : academic.ts, JSONB en base)
interface TradeCooldown { emotion?: string; error?: string; lesson?: string; doneAt?: number }
interface TradeSegment { id: string; startedAt: number; closedAt?: number; outcome?: 'gain' | 'perte' | 'be'; cooldown?: TradeCooldown }
interface NoteWarmup { id?: string; startedAt?: number; emotionLevel?: number }

type Grade = 'A' | 'B' | 'C'
type Cause = 'technique' | 'connaissance' | 'emotionnel'

export interface MentoratBrief {
  periodDays: number
  generatedAt: string
  trades: {
    total: number
    gain: number
    perte: number
    be: number
    open: number
    graded: number
    grades: Record<Grade, number>
    causes: Record<Cause, number>
    /** grade × résultat : le découplage (un A peut perdre, un C peut gagner) */
    calibration: Record<Grade, { gain: number; perte: number; be: number }>
  }
  warmups: {
    count: number
    avgEmotion: number | null
    /** part des trades notés C après un warmup à émotion > 60, vs ≤ 60 */
    cShareAfterHighEmotion: number | null
    cShareAfterLowEmotion: number | null
  }
  cooldowns: { count: number; topErrors: { text: string; count: number }[] }
  noteGrades: Record<Grade, number>
  concepts: { name: string; count: number }[]
  monthly: { month: string; A: number; B: number; C: number }[]
  reviewBacklog: number
  /** Le brief en texte, prêt à joindre à une conversation IA (~15 lignes) */
  text: string
}

const GRADES: Grade[] = ['A', 'B', 'C']
const CAUSE_LABEL: Record<Cause, string> = {
  technique: 'technique et exécution',
  connaissance: 'connaissance',
  emotionnel: 'mental et émotionnel',
}

function isGrade(g: unknown): g is Grade { return g === 'A' || g === 'B' || g === 'C' }
function isCause(c: unknown): c is Cause { return c === 'technique' || c === 'connaissance' || c === 'emotionnel' }

export async function buildMentoratBrief(userId: string, periodDays = 90): Promise<MentoratBrief> {
  const since = Date.now() - periodDays * 86_400_000
  const sinceDate = new Date(since)

  const [notes, annotations, reviewBacklog] = await Promise.all([
    // Les trades/warmups vivent en JSONB sur les notes : on prend toutes les
    // notes de l'utilisateur (volume faible) et on filtre par date de trade,
    // pas par date de note (une note peut vivre plus longtemps que sa séance).
    prisma.note.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, trades: true, warmups: true, concepts: true, lastModifiedAt: true },
    }),
    prisma.annotation.findMany({
      where: { userId, createdAt: { gte: sinceDate } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.annotation.count({
      where: { userId, reviewedAt: null, reviewDueAt: { lte: new Date() } },
    }),
  ])

  // ── Trades de la période ──
  interface TradeWithNote extends TradeSegment { noteId: string }
  const trades: TradeWithNote[] = []
  for (const n of notes) {
    const list = Array.isArray(n.trades) ? (n.trades as unknown as TradeSegment[]) : []
    for (const t of list) {
      if (t && typeof t.startedAt === 'number' && t.startedAt >= since) trades.push({ ...t, noteId: n.id })
    }
  }

  // Dernier jugement par trade (les re-jugements sont un historique : le
  // dernier fait foi, annotations déjà triées par createdAt croissant)
  const tradeAnnotation = new Map<string, { grade: Grade; cause: Cause | null; createdAt: Date }>()
  const noteAnnotation = new Map<string, Grade>()
  for (const a of annotations) {
    if (!isGrade(a.grade)) continue
    if (a.tradeRef) {
      tradeAnnotation.set(a.tradeRef, { grade: a.grade, cause: isCause(a.causeCategory) ? a.causeCategory : null, createdAt: a.createdAt })
    } else if (a.noteId && !a.messageRef) {
      noteAnnotation.set(a.noteId, a.grade)
    }
  }

  const counts = { gain: 0, perte: 0, be: 0, open: 0 }
  const grades: Record<Grade, number> = { A: 0, B: 0, C: 0 }
  const causes: Record<Cause, number> = { technique: 0, connaissance: 0, emotionnel: 0 }
  const calibration: Record<Grade, { gain: number; perte: number; be: number }> = {
    A: { gain: 0, perte: 0, be: 0 }, B: { gain: 0, perte: 0, be: 0 }, C: { gain: 0, perte: 0, be: 0 },
  }
  const monthlyMap = new Map<string, Record<Grade, number>>()

  for (const t of trades) {
    if (t.outcome) counts[t.outcome]++
    else counts.open++
    const ann = tradeAnnotation.get(t.id)
    if (ann) {
      grades[ann.grade]++
      if (ann.cause) causes[ann.cause]++
      if (t.outcome) calibration[ann.grade][t.outcome]++
      const month = new Date(t.startedAt).toISOString().slice(0, 7)
      const m = monthlyMap.get(month) ?? { A: 0, B: 0, C: 0 }
      m[ann.grade]++
      monthlyMap.set(month, m)
    }
  }
  const graded = grades.A + grades.B + grades.C

  // ── Warmups : émotion au départ × qualité des trades qui suivent ──
  const warmupsAll: { noteId: string; startedAt: number; emotionLevel: number }[] = []
  for (const n of notes) {
    const list = Array.isArray(n.warmups) ? (n.warmups as unknown as NoteWarmup[]) : []
    for (const w of list) {
      if (w && typeof w.startedAt === 'number' && w.startedAt >= since && typeof w.emotionLevel === 'number') {
        warmupsAll.push({ noteId: n.id, startedAt: w.startedAt, emotionLevel: w.emotionLevel })
      }
    }
  }
  const avgEmotion = warmupsAll.length
    ? Math.round(warmupsAll.reduce((s, w) => s + w.emotionLevel, 0) / warmupsAll.length)
    : null

  // Pour chaque trade noté : le warmup précédent le plus proche DANS LA MÊME
  // note (même séance). Buckets émotion > 60 vs ≤ 60 → part de C dans chaque.
  const bucket = { high: { c: 0, total: 0 }, low: { c: 0, total: 0 } }
  for (const t of trades) {
    const ann = tradeAnnotation.get(t.id)
    if (!ann) continue
    const prior = warmupsAll
      .filter(w => w.noteId === t.noteId && w.startedAt <= t.startedAt)
      .sort((a, b) => b.startedAt - a.startedAt)[0]
    if (!prior) continue
    const b = prior.emotionLevel > 60 ? bucket.high : bucket.low
    b.total++
    if (ann.grade === 'C') b.c++
  }
  const share = (b: { c: number; total: number }) => (b.total >= 3 ? Math.round((b.c / b.total) * 100) : null)

  // ── Cooldowns : les erreurs qui reviennent ──
  const errorFreq = new Map<string, { text: string; count: number }>()
  let cooldownCount = 0
  for (const t of trades) {
    const err = t.cooldown?.error?.trim()
    if (t.cooldown && (t.cooldown.error || t.cooldown.lesson || t.cooldown.emotion)) cooldownCount++
    if (!err) continue
    const key = err.toLowerCase().replace(/\s+/g, ' ')
    const entry = errorFreq.get(key) ?? { text: err, count: 0 }
    entry.count++
    errorFreq.set(key, entry)
  }
  const topErrors = [...errorFreq.values()].sort((a, b) => b.count - a.count).slice(0, 3)

  // ── Notes de journée/réflexion jugées au niveau note ──
  const noteGrades: Record<Grade, number> = { A: 0, B: 0, C: 0 }
  for (const g of noteAnnotation.values()) noteGrades[g]++

  // ── Concepts les plus journalisés (notes actives sur la période) ──
  const conceptFreq = new Map<string, number>()
  for (const n of notes) {
    if (n.lastModifiedAt.getTime() < since) continue
    for (const c of n.concepts ?? []) {
      const name = c.trim()
      if (name) conceptFreq.set(name, (conceptFreq.get(name) ?? 0) + 1)
    }
  }
  const concepts = [...conceptFreq.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const monthly = [...monthlyMap.entries()]
    .map(([month, m]) => ({ month, ...m }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const brief: MentoratBrief = {
    periodDays,
    generatedAt: new Date().toISOString(),
    trades: { total: trades.length, ...counts, graded, grades, causes, calibration },
    warmups: {
      count: warmupsAll.length,
      avgEmotion,
      cShareAfterHighEmotion: share(bucket.high),
      cShareAfterLowEmotion: share(bucket.low),
    },
    cooldowns: { count: cooldownCount, topErrors },
    noteGrades,
    concepts,
    monthly,
    reviewBacklog,
    text: '',
  }
  brief.text = renderBriefText(brief)
  return brief
}

/**
 * Le brief en français, ~15 lignes, prêt à joindre à une conversation IA.
 * Chaque ligne n'existe que si la donnée existe : pas de « 0 partout » qui
 * noierait le signal. Règle produit : des FAITS chiffrés, jamais de verdict,
 * le jugement reste à l'IA qui le lit (et à Brice qui valide).
 */
function renderBriefText(b: MentoratBrief): string {
  const L: string[] = []
  const t = b.trades
  L.push(`Brief de l’élève, ${b.periodDays} derniers jours.`)

  if (t.total === 0) {
    L.push('Aucun trade enregistré sur la période.')
  } else {
    const parts = [`${t.gain} gains`, `${t.perte} pertes`, `${t.be} BE`]
    if (t.open) parts.push(`${t.open} sans résultat saisi`)
    L.push(`Trades : ${t.total} au total (${parts.join(', ')}).`)
    if (t.graded > 0) {
      L.push(`Jugements : ${t.graded} trades notés sur ${t.total} : ${t.grades.A} A, ${t.grades.B} B, ${t.grades.C} C.`)
      const causesTotal = t.causes.technique + t.causes.connaissance + t.causes.emotionnel
      if (causesTotal > 0) {
        const cs = (Object.keys(CAUSE_LABEL) as Cause[])
          .filter(c => t.causes[c] > 0)
          .map(c => `${CAUSE_LABEL[c]} ${t.causes[c]}`)
        L.push(`Causes posées sur les erreurs : ${cs.join(', ')}.`)
      }
      const aPerdants = t.calibration.A.perte
      const cGagnants = t.calibration.C.gain
      if (aPerdants || cGagnants) {
        const cal: string[] = []
        if (aPerdants) cal.push(`${aPerdants} A perdant${aPerdants > 1 ? 's' : ''} (bien joués, mauvais résultat)`)
        if (cGagnants) cal.push(`${cGagnants} gain${cGagnants > 1 ? 's' : ''} noté${cGagnants > 1 ? 's' : ''} C (résultat qui récompense une mauvaise décision)`)
        L.push(`Calibration : ${cal.join(' ; ')}.`)
      }
    } else {
      L.push(`Aucun trade noté A/B/C sur la période (${t.total} trades non jugés).`)
    }
  }

  if (b.warmups.count > 0) {
    let line = `Warmups : ${b.warmups.count} sur la période, émotion moyenne au départ ${b.warmups.avgEmotion}/100.`
    if (b.warmups.cShareAfterHighEmotion !== null && b.warmups.cShareAfterLowEmotion !== null) {
      line += ` Après un warmup au-dessus de 60 : ${b.warmups.cShareAfterHighEmotion} % de trades C, contre ${b.warmups.cShareAfterLowEmotion} % sinon.`
    }
    L.push(line)
  }

  if (b.cooldowns.topErrors.length > 0) {
    const errs = b.cooldowns.topErrors.map(e => (e.count > 1 ? `« ${e.text} » (×${e.count})` : `« ${e.text} »`))
    L.push(`Erreurs consignées aux cooldowns : ${errs.join(', ')}.`)
  }

  const ng = b.noteGrades
  if (ng.A + ng.B + ng.C > 0) {
    L.push(`Journées/réflexions jugées : ${ng.A} A, ${ng.B} B, ${ng.C} C.`)
  }

  if (b.monthly.length > 1) {
    const prog = b.monthly.map(m => `${m.month} : ${m.A}A/${m.B}B/${m.C}C`).join(' · ')
    L.push(`Progression mensuelle des jugements : ${prog}.`)
  }

  if (b.concepts.length > 0) {
    L.push(`Concepts les plus journalisés : ${b.concepts.map(c => `${c.name} (${c.count})`).join(', ')}.`)
  }

  if (b.reviewBacklog > 0) {
    L.push(`Relectures en retard : ${b.reviewBacklog} jugement${b.reviewBacklog > 1 ? 's' : ''} dont l’échéance est passée.`)
  }

  L.push('Rappel de lecture : A/B/C note la qualité de la décision, jamais le résultat.')
  return L.join('\n')
}
