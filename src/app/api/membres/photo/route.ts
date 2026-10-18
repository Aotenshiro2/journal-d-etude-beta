import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/db'
import { compteDuJeton, corsAcademie } from '@/lib/academie/http'

/**
 * GET /api/membres/photo?numero=<n°> : la photo d'un PROFIL PUBLIC, pour la
 * page /membres/<n°> d'aoknowledge.com (lot 2 de Mon espace, 18/10/2026).
 *
 * Pourquoi ici : le bucket avatars-membres est PRIVE (chemin <uuid>/avatar).
 * Le visiteur anonyme n'a aucun droit dessus, et le site n'a pas de cle
 * serveur. Le journal lit le profil par son numero (role postgres), verifie
 * sa visibilite, et renvoie les octets de l'image : l'uuid du compte ne sort
 * jamais. Profil prive, inconnu ou sans photo : 404, sans dire lequel.
 *
 * Visibilite en trois etats (Brice, 18/10/2026, migration
 * 20261019010000_profil_visibilite_membres.sql), la meme regle que
 * aok_profil_public :
 *   - web (profil_public, masquer_moteurs = false) : photo publique, cache
 *     partage court (balise <img> directe) ;
 *   - membres (profil_public, masquer_moteurs = true) : jeton Bearer d'un
 *     compte AOK exige (le site appelle avec fetch et la session du
 *     visiteur), reponse jamais mise en cache. Sans jeton valide : le meme 404.
 *
 * Route publique (middleware.ts). Aucun identifiant dans les logs.
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

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, 'GET, OPTIONS') })
}

export async function GET(req: NextRequest) {
  const cors = corsAcademie(req, 'GET, OPTIONS')
  const absent = (prive: boolean) => new NextResponse('introuvable', {
    status: 404,
    headers: {
      ...cors,
      // Une requete avec jeton ne partage jamais son cache.
      'Cache-Control': prive ? 'private, no-store' : 'public, max-age=60, s-maxage=60',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
  const avecJeton = (req.headers.get('authorization') ?? '').startsWith('Bearer ')

  const brut = req.nextUrl.searchParams.get('numero') ?? ''
  if (!/^[1-9][0-9]{0,11}$/.test(brut)) return absent(avecJeton)

  const lignes = await prisma.$queryRawUnsafe<{ id: string; membres: boolean }[]>(
    `select p.id::text as id, p.masquer_moteurs as membres from public.profiles p
      where p.client_number = $1::bigint and p.profil_public and p.avatar_maj_le is not null
      limit 1`, brut).catch(() => null)
  if (lignes === null) return new NextResponse('indisponible', { status: 503, headers: { ...cors, 'Cache-Control': 'no-store' } })
  const ligne = lignes[0]
  if (!ligne) return absent(avecJeton)

  // Profil « membres » : un compte AOK connecte seulement.
  if (ligne.membres) {
    let compte: string | null
    try {
      compte = await compteDuJeton(req)
    } catch {
      return new NextResponse('indisponible', { status: 503, headers: { ...cors, 'Cache-Control': 'no-store' } })
    }
    if (!compte) return absent(true)
  }

  const s = stockage()
  if (!s) {
    console.warn('[membres/photo] cle de service absente')
    return new NextResponse('indisponible', { status: 503, headers: { ...cors, 'Cache-Control': 'no-store' } })
  }
  const { data, error } = await s.storage.from('avatars-membres').download(`${ligne.id}/avatar`)
  if (error || !data) return absent(ligne.membres || avecJeton)
  const type = data.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp'
  return new NextResponse(Buffer.from(await data.arrayBuffer()), {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': type,
      'Cache-Control': ligne.membres ? 'private, no-store' : 'public, max-age=300, s-maxage=300',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  })
}
