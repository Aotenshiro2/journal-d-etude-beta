import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import NoteMapCanvas from '@/components/NoteMapCanvas'
import UserMenu from '@/components/UserMenu'
import ThemeToggle from '@/components/ThemeToggle'
import Link from 'next/link'
import { NoteData, CanvasData } from '@/types'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const notes = await prisma.note.findMany({
    where: { userId: user.id, deletedAt: null },
    orderBy: { lastModifiedAt: 'desc' },
    select: {
      id: true,
      title: true,
      content: true,
      contentHash: true,
      favicon: true,
      sourceUrl: true,
      source: true,
      lastSyncAt: true,
      createdAt: true,
      firstSyncAt: true,
      lastModifiedAt: true,
      userId: true,
    },
  })

  // Get or create the global note-map canvas
  let canvas = await prisma.canvas.findFirst({
    where: { userId: user.id, type: 'note-map', noteId: null },
    include: { nodes: true, edges: true },
  })

  if (!canvas) {
    canvas = await prisma.canvas.create({
      data: { type: 'note-map', userId: user.id },
      include: { nodes: true, edges: true },
    })
  }

  const canvasData: CanvasData = {
    id: canvas.id,
    type: canvas.type,
    userId: canvas.userId,
    noteId: canvas.noteId,
    noteContentHash: canvas.noteContentHash,
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
    nodes: canvas.nodes.map(n => ({
      id: n.id,
      canvasId: n.canvasId,
      messageId: n.messageId,
      noteId: n.noteId,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
    })),
    edges: canvas.edges.map(e => ({
      id: e.id,
      canvasId: e.canvasId,
      fromId: e.fromId,
      toId: e.toId,
      label: e.label,
      style: e.style,
    })),
  }

  return (
    <div className="h-screen bg-[#080808] text-white flex flex-col overflow-hidden">

      {/* ── Minimal header ── */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-white/[0.06] flex-shrink-0 bg-[#0a0a0a]">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-bold text-white tracking-tight">Journal d&apos;Études</span>
          <span className="text-[10px] text-gray-700 border border-white/[0.08] rounded-full px-2 py-0.5 font-medium">
            bêta
          </span>
        </div>
        <nav className="flex items-center gap-4">
          <Link
            href="/study"
            className="text-xs text-gray-600 hover:text-gray-300 transition-colors"
          >
            Vue liste
          </Link>
          <Link
            href="/concepts"
            className="text-xs text-gray-600 hover:text-gray-300 transition-colors"
          >
            Concepts
          </Link>
          <Link
            href="/guide"
            className="text-xs text-gray-600 hover:text-gray-300 transition-colors"
          >
            Guide
          </Link>
          <div className="w-px h-4 bg-white/[0.08]" />
          <ThemeToggle />
          <UserMenu
            user={{ email: user.email ?? '', name: user.user_metadata?.full_name ?? '' }}
          />
        </nav>
      </header>

      {/* ── Canvas (prend tout l'espace disponible) ── */}
      <NoteMapCanvas notes={notes as NoteData[]} canvas={canvasData} />

      {/* ── Bottom hint bar ── */}
      <div className="flex items-center justify-center gap-6 px-6 py-2 border-t border-white/[0.06] bg-[#0a0a0a] flex-shrink-0">
        <span className="text-[11px] text-gray-700">
          Double-clic pour ouvrir une note
        </span>
        <span className="text-[11px] text-gray-800">·</span>
        <span className="text-[11px] text-gray-700">
          Glisse pour repositionner
        </span>
        <span className="text-[11px] text-gray-800">·</span>
        <span className="text-[11px] text-gray-700">
          Connecte les nœuds depuis les poignées bleues
        </span>
      </div>
    </div>
  )
}
