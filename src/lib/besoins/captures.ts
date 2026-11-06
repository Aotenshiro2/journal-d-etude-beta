// LES BESOINS DES MEMBRES, LOT 2 (06/11/2026) : les captures jointes au
// bouton « Il me manque quelque chose », dans le bucket PRIVE besoins-captures
// (migration 20261106150000, aucune policy sur storage.objects).
//
// Doctrine Storage de Brice (incident d'egress de septembre 2026) : prive,
// petit (1,5 Mo au plus, compresse cote client a 1600 px), lu a la demande
// seulement, par une URL signee de 10 minutes que le detail du cockpit
// demande a l'ouverture d'une carte. Aucun affichage public, aucune vignette
// servie en boucle. Le chemin derive de l'empreinte : memes octets = meme
// objet, jamais remplace (upsert faux).
//
// Cle de service (SUPABASE_SERVICE_ROLE_KEY), cote serveur seulement, comme
// les images de Belrive (mcp-gpt/stockage-images.ts).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const BUCKET_CAPTURES = 'besoins-captures'
/** L'URL signee rendue au cockpit : 10 minutes (contrat). */
export const DUREE_URL_CAPTURE_S = 600

let client: SupabaseClient | null = null

function clientStockage(): SupabaseClient {
  if (client) return client
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
  const cle = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !cle) throw new Error('captures des besoins : NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente')
  client = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

function dejaLa(err: unknown): boolean {
  const e = (err ?? {}) as { statusCode?: unknown; status?: unknown; message?: unknown; error?: unknown }
  return e.statusCode === '409' || e.statusCode === 409 || e.status === 409
    || /already exists|duplicate/i.test(String(e.message ?? '')) || /duplicate/i.test(String(e.error ?? ''))
}

/** Range la capture. Jette si le stockage refuse (bucket absent avant la migration, panne) : la route rend 503. */
export async function rangerCapture(chemin: string, octets: Buffer, mime: string): Promise<void> {
  const { error } = await clientStockage().storage.from(BUCKET_CAPTURES).upload(chemin, octets, { contentType: mime, upsert: false, cacheControl: '3600' })
  if (!error || dejaLa(error)) return
  throw new Error(`captures des besoins : envoi refuse (${String((error as { message?: unknown }).message ?? 'erreur').slice(0, 120)})`)
}

/** Une URL signee de 10 minutes, ou null (objet introuvable, stockage en panne). Ne jette pas. */
export async function urlSigneeCapture(chemin: string): Promise<string | null> {
  try {
    const { data, error } = await clientStockage().storage.from(BUCKET_CAPTURES).createSignedUrl(chemin, DUREE_URL_CAPTURE_S)
    return error || !data?.signedUrl ? null : data.signedUrl
  } catch {
    return null
  }
}
