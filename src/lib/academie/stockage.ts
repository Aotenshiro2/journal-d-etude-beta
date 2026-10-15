// Les pieces jointes PROTEGEES de l'academie (16/10/2026) : PDF des modules
// payants, dans le bucket Supabase Storage PRIVE « academie-ressources »
// (migration 20261016140000_academie_ressources_protegees.sql ; envoi par
// scripts/envoyer-ressources-academie.mjs).
//
// Le bucket n'a aucune policy sur storage.objects : anon et authenticated n'y
// lisent rien, seul le serveur (cle de service SUPABASE_SERVICE_ROLE_KEY) y
// signe un lien. L'eleve ne recoit qu'une URL signee de 5 minutes, APRES le
// droit (route /api/academie/ressource). Une URL qui circule meurt donc vite.
//
// La cle ne quitte jamais le serveur : ni dans une reponse, ni dans un log.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { BUCKET_RESSOURCES } from './pur'

/** Duree d'une URL signee : 5 minutes, de quoi ouvrir le document (le telechargement commence avant). */
export const DUREE_URL_RESSOURCE_S = 5 * 60

export type UrlRessource =
  | { ok: true; url: string; expireLe: string }
  | { ok: false; erreur: 'config' | 'introuvable' | 'indisponible'; detail?: string }

let client: SupabaseClient | null = null

function clientStockage(): SupabaseClient | null {
  if (client) return client
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
  const cle = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !cle) return null
  client = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

/** Un « objet absent » de Storage (400 avec statusCode 404 dans le corps, ou 404). */
function estIntrouvable(err: unknown): boolean {
  const e = (err ?? {}) as { status?: unknown; statusCode?: unknown; message?: unknown }
  return e.status === 404 || e.statusCode === '404' || e.statusCode === 404
    || /not.?found/i.test(String(e.message ?? ''))
}

/**
 * L'URL signee d'un fichier du bucket prive, valable DUREE_URL_RESSOURCE_S.
 * Ne verifie PAS le droit : c'est le travail de la route, avant cet appel.
 * 'config' : URL de Supabase ou cle de service absente ; 'introuvable' : le
 * fichier n'est pas (encore) dans le bucket ; 'indisponible' : Storage en
 * panne. detail : un message court pour le log, jamais la cle.
 */
export async function urlSigneeRessource(fichier: string, maintenantMs: number = Date.now()): Promise<UrlRessource> {
  const s = clientStockage()
  if (!s) return { ok: false, erreur: 'config' }
  try {
    const { data, error } = await s.storage.from(BUCKET_RESSOURCES).createSignedUrl(fichier, DUREE_URL_RESSOURCE_S)
    if (error || !data?.signedUrl) {
      if (estIntrouvable(error)) return { ok: false, erreur: 'introuvable' }
      return { ok: false, erreur: 'indisponible', detail: error?.name ?? 'reponse vide' }
    }
    return {
      ok: true,
      url: data.signedUrl,
      expireLe: new Date(maintenantMs + DUREE_URL_RESSOURCE_S * 1000).toISOString(),
    }
  } catch (err) {
    return { ok: false, erreur: 'indisponible', detail: err instanceof Error ? err.name : 'erreur' }
  }
}
