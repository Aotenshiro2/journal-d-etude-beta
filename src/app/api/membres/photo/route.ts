import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/db'

/**
 * GET /api/membres/photo?numero=<n°> : la photo d'un PROFIL PUBLIC, pour la
 * page /membres/<n°> d'aoknowledge.com (lot 2 de Mon espace, 18/10/2026).
 *
 * Pourquoi ici : le bucket avatars-membres est PRIVE (chemin <uuid>/avatar).
 * Le visiteur anonyme n'a aucun droit dessus, et le site n'a pas de cle
 * serveur. Le journal lit le profil par son numero (role postgres), verifie
 * profil_public, et renvoie les octets de l'image : l'uuid du compte ne sort
 * jamais. Profil prive, inconnu ou sans photo : 404, sans dire lequel.
 *
 * Route publique (middleware.ts). Cache court : un profil repasse prive
 * disparait des caches en quelques minutes. Aucun identifiant dans les logs.
 */

export const maxDuration = 10

let client: SupabaseClient | null = null
function stockage(): SupabaseClient | null {
  if (client) return client
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
  const cle = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !cle) return null
  client = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

const absent = () => new NextResponse('introuvable', {
  status: 404,
  headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60', 'Content-Type': 'text/plain; charset=utf-8' },
})

export async function GET(req: NextRequest) {
  const brut = req.nextUrl.searchParams.get('numero') ?? ''
  if (!/^[1-9][0-9]{0,11}$/.test(brut)) return absent()

  const lignes = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `select p.id::text as id from public.profiles p
      where p.client_number = $1::bigint and p.profil_public and p.avatar_maj_le is not null
      limit 1`, brut).catch(() => null)
  if (lignes === null) return new NextResponse('indisponible', { status: 503 })
  const id = lignes[0]?.id
  if (!id) return absent()

  const s = stockage()
  if (!s) {
    console.warn('[membres/photo] cle de service absente')
    return new NextResponse('indisponible', { status: 503 })
  }
  const { data, error } = await s.storage.from('avatars-membres').download(`${id}/avatar`)
  if (error || !data) return absent()
  const type = data.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp'
  return new NextResponse(Buffer.from(await data.arrayBuffer()), {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  })
}
