import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import CanvasShell from '@/components/CanvasShell'
import ConceptsEmergence, { ConceptStat } from '@/components/ConceptsEmergence'

// Toujours frais : les concepts émergent à mesure que tu tagues et juges.
export const dynamic = 'force-dynamic'

// « Observer les concepts » — le premier écran d'émergence (masterclass edge) :
// les contextes/variantes qui reviennent dans tes notes, et, à mesure que tu juges
// A/B/C, ceux qui te mènent vers du A ou du C. « Pas ceux que tu penses, ceux que
// tes notes confirment. »
export default async function ConceptsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')
  const userId = user.id

  const [tags, annotations] = await Promise.all([
    prisma.tag.findMany({
      where: { userId },
      include: {
        notes: { select: { noteId: true } },
        messages: { select: { message: { select: { id: true, noteId: true } } } },
      },
    }),
    prisma.annotation.findMany({ where: { userId }, select: { grade: true, noteId: true } }),
  ])

  // noteId → ensemble des tags présents sur cette note (via tag de note OU tag de bloc)
  const noteIdsByTag = new Map<string, Set<string>>()
  const tagsByNote = new Map<string, Set<string>>()
  for (const t of tags) {
    const noteIds = new Set<string>()
    for (const n of t.notes) noteIds.add(n.noteId)
    for (const m of t.messages) if (m.message.noteId) noteIds.add(m.message.noteId)
    noteIdsByTag.set(t.id, noteIds)
    for (const nid of noteIds) {
      if (!tagsByNote.has(nid)) tagsByNote.set(nid, new Set())
      tagsByNote.get(nid)!.add(t.id)
    }
  }
  const nameById = new Map(tags.map(t => [t.id, { name: t.name, color: t.color }]))

  const stats: ConceptStat[] = tags.map(t => {
    const noteIds = noteIdsByTag.get(t.id) ?? new Set<string>()
    const grades = { A: 0, B: 0, C: 0 } as Record<string, number>
    for (const a of annotations) if (a.noteId && noteIds.has(a.noteId) && grades[a.grade] !== undefined) grades[a.grade]++
    // Co-occurrence : autres concepts partageant une note
    const co = new Map<string, number>()
    for (const nid of noteIds) {
      for (const other of tagsByNote.get(nid) ?? []) {
        if (other !== t.id) co.set(other, (co.get(other) ?? 0) + 1)
      }
    }
    const related = [...co.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id, shared]) => ({ name: nameById.get(id)?.name ?? '?', color: nameById.get(id)?.color ?? '#888', shared }))
    return {
      id: t.id, name: t.name, color: t.color, category: t.category ?? null,
      noteCount: noteIds.size, blockCount: t.messages.length,
      grades, related,
    }
  })
  // Les plus récurrents en tête (usage = notes + blocs)
  stats.sort((a, b) => (b.noteCount + b.blockCount) - (a.noteCount + a.blockCount))

  const totalJudged = annotations.length

  return (
    <CanvasShell user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}>
      <ConceptsEmergence concepts={stats} totalJudged={totalJudged} />
    </CanvasShell>
  )
}
