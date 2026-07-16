import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import CanvasShell from '@/components/CanvasShell'
import AbcGameBoard, { GameData } from '@/components/AbcGameBoard'

export const dynamic = 'force-dynamic'

// « Carte A/B/C-game » (Tendler) — l'espace de RÉFLEXION sur ses niveaux de jeu, nourri
// par les trades notés A/B/C (les C révèlent le C-game). En la remplissant, l'élève voit
// son chantier du moment (le plancher C à remonter, inchworm). Le warmup, lui, se lance
// dans la note ; ici on réfléchit à ce qu'on y travaille.
export default async function GamePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')
  const userId = user.id

  const [annotations, notes, row, dueCount] = await Promise.all([
    prisma.annotation.findMany({
      where: { userId },
      select: { grade: true, phrase: true, causeCategory: true, tradeRef: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.note.findMany({ where: { userId, deletedAt: null }, select: { trades: true } }),
    prisma.abcGame.findUnique({ where: { userId } }),
    // Notes réorganisées mais pas encore relues — même badge « Relire » que l'accueil
    prisma.canvas.count({ where: { userId, type: 'note-study', reviewedAt: null, nodes: { some: {} } } }),
  ])

  // tradeId → cooldown (émotion / erreur), depuis Note.trades JSON (préservé par la sync)
  type TradeJson = { id?: string; cooldown?: { emotion?: string; error?: string; lesson?: string } }
  const cooldownByTrade = new Map<string, { emotion?: string; error?: string }>()
  for (const n of notes) {
    const ts = Array.isArray(n.trades) ? (n.trades as TradeJson[]) : []
    for (const t of ts) if (t?.id && t.cooldown) cooldownByTrade.set(t.id, t.cooldown)
  }

  const empty = () => ({
    count: 0,
    causes: { technique: 0, connaissance: 0, emotionnel: 0 } as Record<string, number>,
    phrases: [] as string[],
    signals: [] as string[],
  })
  const levels: Record<'A' | 'B' | 'C', ReturnType<typeof empty>> = { A: empty(), B: empty(), C: empty() }

  for (const a of annotations) {
    const lvl = levels[a.grade as 'A' | 'B' | 'C']
    if (!lvl) continue
    lvl.count++
    if (a.causeCategory && lvl.causes[a.causeCategory] !== undefined) lvl.causes[a.causeCategory]++
    if (a.phrase && a.phrase.trim() && lvl.phrases.length < 8) lvl.phrases.push(a.phrase.trim())
    if (a.tradeRef) {
      const cd = cooldownByTrade.get(a.tradeRef)
      if (cd) {
        for (const b of [cd.error, cd.emotion]) {
          if (b && b.trim() && lvl.signals.length < 8) lvl.signals.push(b.trim())
        }
      }
    }
  }

  const data: GameData = {
    levels,
    reflection: {
      aGame: row?.aGame ?? '',
      bGame: row?.bGame ?? '',
      cGame: row?.cGame ?? '',
      focus: row?.focus ?? '',
    },
  }

  return (
    <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }} dueCount={dueCount}>
      <AbcGameBoard data={data} />
    </CanvasShell>
  )
}
