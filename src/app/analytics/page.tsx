import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import CanvasShell from '@/components/CanvasShell'
import AnalyticsView, { AnalyticsStats } from '@/components/AnalyticsView'

export const dynamic = 'force-dynamic'

// « Analyser mes données » — les lentilles d'émergence : où je perds (causes),
// calibration (note × résultat), progression (le plancher C qui remonte).
export default async function AnalyticsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')
  const userId = user.id

  const [annotations, notes, dueCount] = await Promise.all([
    prisma.annotation.findMany({ where: { userId }, select: { grade: true, causeCategory: true, tradeRef: true, createdAt: true } }),
    prisma.note.findMany({ where: { userId, deletedAt: null }, select: { trades: true } }),
    // Notes réorganisées mais pas encore relues — même badge « Relire » que l'accueil
    prisma.canvas.count({ where: { userId, type: 'note-study', reviewedAt: null, nodes: { some: {} } } }),
  ])

  // tradeId → résultat (depuis Note.trades)
  const outcomeByTrade = new Map<string, string>()
  for (const n of notes) {
    const ts = Array.isArray(n.trades) ? (n.trades as { id?: string; outcome?: string }[]) : []
    for (const t of ts) if (t?.id && t?.outcome) outcomeByTrade.set(t.id, t.outcome)
  }

  const grades: Record<string, number> = { A: 0, B: 0, C: 0 }
  const causes: Record<string, number> = { technique: 0, connaissance: 0, emotionnel: 0 }
  const calibration: Record<string, Record<string, number>> = {
    A: { gain: 0, perte: 0, be: 0 }, B: { gain: 0, perte: 0, be: 0 }, C: { gain: 0, perte: 0, be: 0 },
  }
  let tradeVerdicts = 0
  const byMonth = new Map<string, { A: number; B: number; C: number }>()

  for (const a of annotations) {
    if (grades[a.grade] !== undefined) grades[a.grade]++
    if (a.causeCategory && causes[a.causeCategory] !== undefined) causes[a.causeCategory]++
    if (a.tradeRef) {
      const oc = outcomeByTrade.get(a.tradeRef)
      if (oc && calibration[a.grade]?.[oc] !== undefined) { calibration[a.grade][oc]++; tradeVerdicts++ }
    }
    const m = new Date(a.createdAt).toISOString().slice(0, 7)
    if (!byMonth.has(m)) byMonth.set(m, { A: 0, B: 0, C: 0 })
    const bucket = byMonth.get(m)!
    if (bucket[a.grade as 'A' | 'B' | 'C'] !== undefined) bucket[a.grade as 'A' | 'B' | 'C']++
  }

  const timeline = [...byMonth.entries()]
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([month, gg]) => ({ month, ...gg }))

  const stats: AnalyticsStats = { total: annotations.length, grades, causes, calibration, tradeVerdicts, timeline }

  return (
    <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }} dueCount={dueCount}>
      <AnalyticsView stats={stats} />
    </CanvasShell>
  )
}
