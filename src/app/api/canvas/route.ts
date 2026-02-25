import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/canvas
 * Retourne la liste des canvasIds distincts appartenant à l'utilisateur connecté.
 * Utilisé par l'extension pour choisir où poster les notes synquées.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const canvases = await prisma.note.findMany({
      where: { userId: user.id },
      select: { canvasId: true },
      distinct: ['canvasId'],
      orderBy: { createdAt: 'asc' }
    })

    const ids = canvases.map(c => c.canvasId)

    // Garantir que le canvas par défaut est toujours présent
    if (!ids.includes('default-canvas')) ids.unshift('default-canvas')

    return NextResponse.json({ canvases: ids })
  } catch (error) {
    console.error('Error fetching canvases:', error)
    return NextResponse.json({ error: 'Failed to fetch canvases' }, { status: 500 })
  }
}
