import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

// Carte A/B/C-game : la réflexion vivante de l'élève (aGame/bGame/cGame + focus).
// 1 ligne par user → upsert par userId. Les données agrégées (comptes, causes,
// cooldowns) sont calculées côté page ; ici on ne persiste que le texte réfléchi.
const FIELDS = ['aGame', 'bGame', 'cGame', 'focus'] as const

async function uid() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function PATCH(req: NextRequest) {
  const userId = await uid()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const data: Record<string, string> = {}
  for (const f of FIELDS) {
    if (typeof body[f] === 'string') data[f] = body[f]
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'rien à mettre à jour' }, { status: 400 })
  const row = await prisma.abcGame.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  })
  return NextResponse.json(row)
}
