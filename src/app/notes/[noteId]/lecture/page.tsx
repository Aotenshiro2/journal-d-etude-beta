import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import NoteReadingScreen from '@/components/NoteReadingScreen'
import { MessageData } from '@/types'

// L'écran de lecture de la note d'origine — plein cadre, une seule colonne.
//
// Pourquoi une route à part (Brice, 25/07/2026) : au téléphone, la note s'affiche
// dans un panneau de 300 px, soit 80 % d'un écran de 375. Ça passe sur un grand
// iPhone, pas en dessous. Ici on lit, et rien d'autre.
//
// Doctrine : c'est la NOTE D'ORIGINE, en lecture seule. L'exploration (la copie
// de travail) reste sur `/notes/[id]`, accessible d'un bouton depuis cet écran.
export default async function NoteLecturePage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const note = await prisma.note.findFirst({
    where: { id: noteId, userId: user.id },
    include: {
      messages: {
        orderBy: { order: 'asc' },
        include: { tags: { include: { tag: true } } },
      },
      tags: { include: { tag: true } },
      annotations: true,
    },
  })

  if (!note) notFound()

  const folder = note.folderId
    ? await prisma.folder.findFirst({ where: { id: note.folderId, userId: user.id }, select: { name: true } })
    : null

  // Même badge « Relire » que partout ailleurs — le shell l'attend.
  const dueCount = await prisma.canvas.count({
    where: { userId: user.id, type: 'note-study', reviewedAt: null, nodes: { some: {} } },
  })

  const noteWithMessages = {
    ...note,
    messages: note.messages as MessageData[],
    trades: (note.trades as unknown as import('@/types').TradeSegmentData[] | null) ?? undefined,
    folderName: folder?.name ?? null,
  }

  return (
    <NoteReadingScreen
      note={noteWithMessages}
      user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}
      dueCount={dueCount}
    />
  )
}
