// LES IMAGES DE BELRIVE (25/10/2026) : le bucket PRIVE belrive-images.
//
// Cle de service (SUPABASE_SERVICE_ROLE_KEY), cote serveur seulement : aucune
// policy sur storage.objects pour ce bucket (migration 20261025120000), donc
// ni anon ni un compte connecte n'y lisent. Le chemin est derive de
// l'empreinte (images-pur.ts, cheminStockage) et l'envoi se fait SANS upsert :
// un objet deja la n'est jamais remplace.
// Lecture : une URL signee courte (5 minutes) pour Tab ; le script du PC
// (pousser_docs_belrive.py) telecharge avec la cle de service.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { BUCKET_IMAGES, DUREE_URL_IMAGE_S } from './images-pur'

let client: SupabaseClient | null = null

function clientStockage(): SupabaseClient {
  if (client) return client
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
  const cle = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !cle) throw new Error('stockage des images : NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente')
  client = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

/** Un objet deja present (409 Duplicate) : pour un chemin derive de l'empreinte, c'est le meme fichier. */
function dejaLa(err: unknown): boolean {
  const e = (err ?? {}) as { statusCode?: unknown; status?: unknown; message?: unknown; error?: unknown }
  return e.statusCode === '409' || e.statusCode === 409 || e.status === 409
    || /already exists|duplicate/i.test(String(e.message ?? '')) || /duplicate/i.test(String(e.error ?? ''))
}

/** Envoie l'image. 'envoye' = objet cree maintenant, 'deja' = il existait (memes octets, meme chemin). */
export async function envoyerImage(chemin: string, octets: Buffer, mime: string): Promise<'envoye' | 'deja'> {
  const { error } = await clientStockage().storage.from(BUCKET_IMAGES).upload(chemin, octets, { contentType: mime, upsert: false, cacheControl: '31536000' })
  if (!error) return 'envoye'
  if (dejaLa(error)) return 'deja'
  throw new Error(`stockage des images : envoi refuse (${String((error as { message?: unknown }).message ?? 'erreur').slice(0, 120)})`)
}

/** Retire un objet envoye a l'instant quand la ligne de suivi n'a pas pu etre ecrite. Jamais d'exception. */
export async function retirerImage(chemin: string): Promise<void> {
  try {
    await clientStockage().storage.from(BUCKET_IMAGES).remove([chemin])
  } catch {
    // Un objet orphelin ne gene pas : le prochain depot des memes octets le reprend.
  }
}

/** Une URL signee de l'image, valable 5 minutes. null si l'objet est introuvable. */
export async function urlSigneeImage(chemin: string, nomFichier?: string): Promise<{ url: string; expire_le: string } | null> {
  const { data, error } = await clientStockage().storage.from(BUCKET_IMAGES)
    .createSignedUrl(chemin, DUREE_URL_IMAGE_S, nomFichier ? { download: nomFichier } : undefined)
  if (error || !data?.signedUrl) return null
  return { url: data.signedUrl, expire_le: new Date(Date.now() + DUREE_URL_IMAGE_S * 1000).toISOString() }
}
