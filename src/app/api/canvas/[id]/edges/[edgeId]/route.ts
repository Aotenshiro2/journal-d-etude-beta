import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; edgeId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, edgeId } = await params
  const canvas = await prisma.canvas.findFirst({ where: { id, userId: user.id } })
  if (!canvas) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // 0.1.6 — symétrie : délier une note d'un nœud-concept retire LE tag posé
  // par ce lien (jamais les tags posés ailleurs). Lu AVANT suppression.
  const edge = await prisma.canvasEdge.findUnique({
    where: { id: edgeId },
    select: {
      from: { select: { kind: true, tagId: true, noteId: true, messageId: true } },
      to: { select: { kind: true, tagId: true, noteId: true, messageId: true } },
    },
  })
  if (edge) {
    const concept = edge.from.kind === 'concept' && edge.from.tagId ? edge.from
      : edge.to.kind === 'concept' && edge.to.tagId ? edge.to : null
    const content = concept === edge.from ? edge.to : edge.from
    if (concept?.tagId && content) {
      if (content.noteId) await prisma.noteTag.deleteMany({ where: { noteId: content.noteId, tagId: concept.tagId } })
      else if (content.messageId) await prisma.messageTag.deleteMany({ where: { messageId: content.messageId, tagId: concept.tagId } })
    }
  }

  await prisma.canvasEdge.delete({ where: { id: edgeId } })
  return NextResponse.json({ ok: true })
}

// 0.1.6 — nommer un lien (le label vivait déjà en base, l'UI l'expose enfin)
// 0.1.7 — et changer son côté d'accroche (fromHandle / toHandle).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; edgeId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, edgeId } = await params
  const canvas = await prisma.canvas.findFirst({ where: { id, userId: user.id } })
  if (!canvas) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()

  // Mise à jour PARTIELLE : on ne touche qu'aux champs réellement envoyés.
  // Avant, `label` était réécrit à chaque appel, donc un PATCH qui ne veut
  // changer que le côté d'accroche aurait effacé le nom du trait au passage.
  const data: { label?: string | null; fromHandle?: string | null; toHandle?: string | null } = {}
  if ('label' in body) {
    data.label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null
  }
  if ('fromHandle' in body) data.fromHandle = typeof body.fromHandle === 'string' ? body.fromHandle : null
  if ('toHandle' in body) data.toHandle = typeof body.toHandle === 'string' ? body.toHandle : null

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Rien à modifier' }, { status: 400 })
  }

  // Les extrémités (fromId / toId) ne sont volontairement PAS modifiables ici :
  // les déplacer touche aux tags posés par un lien vers un concept et à la
  // contrainte d'unicité. Chantier à part.
  const updated = await prisma.canvasEdge.update({ where: { id: edgeId }, data })
  return NextResponse.json(updated)
}
